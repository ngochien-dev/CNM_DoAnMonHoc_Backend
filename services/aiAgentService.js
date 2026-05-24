const docClient = require('../awsConfig');
const { ScanCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const fetch = require('node-fetch');

/**
 * AI Agent Service — thực thi các tool function cho Gemini Function Calling.
 * Không xử lý phòng E2EE (tin nhắn mã hóa đầu cuối).
 */
class AIAgentService {

    /**
     * Tool: Tóm tắt hội thoại
     * Fetch N tin nhắn gần nhất từ một room và format cho AI tổng hợp.
     */
    async summarizeConversation({ roomId, messageCount = 20, sinceMinutes }) {
        try {
            let allItems = [];
            let lastKey = undefined;

            // Hỗ trợ cả 2 thứ tự username trong DM room ID
            let filterExpression = "roomId = :r";
            let expressionValues = { ":r": roomId };

            if (roomId.startsWith('dm_')) {
                const parts = roomId.replace('dm_', '').split('_');
                if (parts.length === 2) {
                    const altRoomId = `dm_${parts[1]}_${parts[0]}`;
                    if (altRoomId !== roomId) {
                        filterExpression = "roomId = :r1 OR roomId = :r2";
                        expressionValues = { ":r1": roomId, ":r2": altRoomId };
                    }
                }
            }

            // Thêm filter loại bỏ tin nhắn đã thu hồi
            filterExpression = `(${filterExpression}) AND (attribute_not_exists(isRevoked) OR isRevoked = :false)`;
            expressionValues[":false"] = false;

            do {
                const data = await docClient.send(new ScanCommand({
                    TableName: 'Messages',
                    FilterExpression: filterExpression,
                    ExpressionAttributeValues: expressionValues,
                    ExclusiveStartKey: lastKey,
                }));
                allItems = allItems.concat(data.Items || []);
                lastKey = data.LastEvaluatedKey;
            } while (lastKey);

            // Sort theo thời gian mới nhất
            allItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            // Lọc theo thời gian nếu có
            if (sinceMinutes) {
                const cutoff = new Date(Date.now() - sinceMinutes * 60 * 1000);
                allItems = allItems.filter(m => new Date(m.createdAt) >= cutoff);
            }

            // Lấy N tin nhắn gần nhất
            const recentMessages = allItems.slice(0, Math.min(messageCount, 50));

            // Format thành dạng text cho AI
            const formatted = recentMessages.reverse().map(m => {
                const time = new Date(m.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                const date = new Date(m.createdAt).toLocaleDateString('vi-VN');
                let content = m.text || '';
                if (m.fileType === 'image') content = '[Hình ảnh]';
                else if (m.fileType === 'video') content = '[Video]';
                else if (m.fileType === 'audio') content = '[Tin nhắn thoại]';
                else if (m.fileData && !m.text) content = `[File: ${m.fileName || 'tệp đính kèm'}]`;
                if (m.pollData) content = `[Bình chọn: ${m.pollData.question || m.text}]`;
                if (m.eventData) content = `[Sự kiện: ${m.eventData.title || m.text}]`;

                return `[${date} ${time}] @${m.senderUsername}: ${content}`;
            });

            return {
                messages: formatted,
                totalMessages: allItems.length,
                fetchedCount: recentMessages.length,
                roomId,
            };
        } catch (err) {
            console.error('[AIAgent] summarizeConversation error:', err);
            return { messages: [], error: err.message };
        }
    }

    /**
     * Tool: Tìm kiếm tin nhắn ngữ nghĩa
     * Tìm tin nhắn theo nội dung, người gửi, khoảng thời gian trong room.
     */
    async searchMessages({ query, senderName, dateRange, roomId }) {
        try {
            let allItems = [];
            let lastKey = undefined;

            let filterParts = [];
            let expressionValues = {};

            // Filter by room
            if (roomId) {
                if (roomId.startsWith('dm_')) {
                    const parts = roomId.replace('dm_', '').split('_');
                    if (parts.length === 2) {
                        const altRoomId = `dm_${parts[1]}_${parts[0]}`;
                        if (altRoomId !== roomId) {
                            filterParts.push("(roomId = :r1 OR roomId = :r2)");
                            expressionValues[":r1"] = roomId;
                            expressionValues[":r2"] = altRoomId;
                        } else {
                            filterParts.push("roomId = :r");
                            expressionValues[":r"] = roomId;
                        }
                    } else {
                        filterParts.push("roomId = :r");
                        expressionValues[":r"] = roomId;
                    }
                } else {
                    filterParts.push("roomId = :r");
                    expressionValues[":r"] = roomId;
                }
            }

            // Filter non-revoked
            filterParts.push("(attribute_not_exists(isRevoked) OR isRevoked = :false)");
            expressionValues[":false"] = false;

            do {
                const data = await docClient.send(new ScanCommand({
                    TableName: 'Messages',
                    FilterExpression: filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
                    ExpressionAttributeValues: Object.keys(expressionValues).length > 0 ? expressionValues : undefined,
                    ExclusiveStartKey: lastKey,
                }));
                allItems = allItems.concat(data.Items || []);
                lastKey = data.LastEvaluatedKey;
            } while (lastKey);

            let results = allItems;

            // Lọc theo người gửi (tìm cả username và displayName)
            if (senderName) {
                const lowerSender = senderName.toLowerCase();
                results = results.filter(m =>
                    (m.senderUsername && m.senderUsername.toLowerCase().includes(lowerSender)) ||
                    (m.sender && m.sender.toLowerCase().includes(lowerSender))
                );
            }

            // Lọc theo nội dung (semantic: tìm từ khóa trong text)
            if (query) {
                const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
                results = results.filter(m => {
                    const text = (m.text || '').toLowerCase();
                    const fileName = (m.fileName || '').toLowerCase();
                    return keywords.some(kw => text.includes(kw) || fileName.includes(kw));
                });
            }

            // Lọc theo khoảng thời gian
            if (dateRange) {
                if (dateRange.before) {
                    const beforeDate = new Date(dateRange.before);
                    results = results.filter(m => new Date(m.createdAt) <= beforeDate);
                }
                if (dateRange.after) {
                    const afterDate = new Date(dateRange.after);
                    results = results.filter(m => new Date(m.createdAt) >= afterDate);
                }
            }

            // Sort theo thời gian, lấy tối đa 20 kết quả
            results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            results = results.slice(0, 20);

            // Format kết quả
            const formatted = results.map(m => {
                const time = new Date(m.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                const date = new Date(m.createdAt).toLocaleDateString('vi-VN');
                let content = m.text || '';
                if (m.fileType) content += ` [File: ${m.fileName || m.fileType}]`;
                return {
                    messageId: m.messageId,
                    sender: m.senderUsername,
                    time: `${date} ${time}`,
                    content: content.substring(0, 200),
                };
            });

            return {
                results: formatted,
                totalFound: results.length,
                query,
                senderName,
            };
        } catch (err) {
            console.error('[AIAgent] searchMessages error:', err);
            return { results: [], error: err.message };
        }
    }

    /**
     * Tool: Gợi ý phản hồi nhanh (Smart Replies)
     * Trả về danh sách tin nhắn gần nhất để AI gợi ý phản hồi.
     */
    async getRecentForSmartReplies({ roomId, count = 10 }) {
        try {
            const result = await this.summarizeConversation({ roomId, messageCount: count });
            return {
                recentMessages: result.messages,
                roomId,
            };
        } catch (err) {
            console.error('[AIAgent] getRecentForSmartReplies error:', err);
            return { recentMessages: [], error: err.message };
        }
    }

    /**
     * Tool: Gợi ý phản hồi nhanh (Smart Replies) — phiên bản nâng cấp.
     * Lấy tin nhắn gần nhất và trả metadata để Gemini gợi ý câu reply.
     */
    async suggestSmartReplies({ roomId, count = 4 }) {
        try {
            const result = await this.summarizeConversation({ roomId, messageCount: Math.min(count * 3, 15) });
            return {
                recentMessages: result.messages,
                totalMessages: result.totalMessages,
                requestedCount: count,
                roomId,
                instruction: `Dựa trên ${result.fetchedCount} tin nhắn gần nhất, hãy gợi ý ${count} câu trả lời ngắn gọn (dưới 50 ký tự mỗi câu) phù hợp với ngữ cảnh. Trả về dạng danh sách đánh số.`,
            };
        } catch (err) {
            console.error('[AIAgent] suggestSmartReplies error:', err);
            return { recentMessages: [], error: err.message };
        }
    }

    /**
     * Tool: Hỗ trợ viết (Writing Assistant)
     * Trả về metadata để Gemini xử lý chỉnh sửa văn phong, sửa lỗi, dịch thuật.
     * Gemini sẽ tự xử lý dựa trên action và text — không cần truy vấn DB.
     */
    async writingAssistant({ action, text, targetLanguage }) {
        const actionLabels = {
            polite: 'Chuyển sang giọng văn lịch sự, trang trọng hơn',
            professional: 'Chuyển sang giọng văn chuyên nghiệp, formal',
            casual: 'Chuyển sang giọng văn thân thiện, gần gũi',
            fix_grammar: 'Sửa lỗi chính tả và ngữ pháp',
            translate: `Dịch sang ${targetLanguage || 'English'}`,
        };

        return {
            action,
            actionLabel: actionLabels[action] || action,
            originalText: text,
            targetLanguage: targetLanguage || null,
            instruction: `Hãy ${actionLabels[action] || 'xử lý'} đoạn văn bản sau:\n\n"${text}"\n\nTrả về kết quả đã xử lý. Nếu là dịch thuật, kèm theo cả bản gốc.`,
        };
    }

    /**
     * Tool: OCR — Trích xuất text từ hình ảnh
     * Gọi Gemini Vision API để nhận dạng chữ trong ảnh.
     */
    async ocrImage({ imageData }) {
        try {
            const { GoogleGenAI } = require('@google/genai');
            const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

            // Determine if imageData is a URL or base64
            let imagePart;
            if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
                // Fetch image and convert to base64
                const response = await fetch(imageData);
                const buffer = await response.buffer();
                const base64 = buffer.toString('base64');
                const mimeType = response.headers.get('content-type') || 'image/png';
                imagePart = { inlineData: { data: base64, mimeType } };
            } else if (imageData.startsWith('data:')) {
                // Parse data URI
                const match = imageData.match(/^data:(.+);base64,(.+)$/);
                if (match) {
                    imagePart = { inlineData: { data: match[2], mimeType: match[1] } };
                } else {
                    return { error: 'Invalid image data format' };
                }
            } else {
                // Assume raw base64
                imagePart = { inlineData: { data: imageData, mimeType: 'image/png' } };
            }

            const result = await genAI.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [
                        imagePart,
                        { text: 'Hãy trích xuất toàn bộ nội dung văn bản (text) có trong hình ảnh này. Giữ nguyên định dạng, xuống dòng và cấu trúc nếu có. Chỉ trả về nội dung text, không thêm giải thích.' }
                    ]
                }],
            });

            const extractedText = result.text || '';
            return {
                extractedText,
                charCount: extractedText.length,
                instruction: 'Đây là nội dung text được trích xuất từ hình ảnh bằng OCR. Hãy trình bày lại cho người dùng một cách rõ ràng.',
            };
        } catch (err) {
            console.error('[AIAgent] ocrImage error:', err);
            return { error: 'Không thể trích xuất text từ ảnh: ' + err.message };
        }
    }

    /**
     * Tool: Tóm tắt nội dung link
     * Fetch nội dung trang web và trích xuất text chính.
     */
    async summarizeLink({ url }) {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; OTTBot/1.0)',
                    'Accept': 'text/html,application/xhtml+xml',
                },
                timeout: 8000,
            });

            if (!response.ok) {
                return { url, error: `HTTP ${response.status}` };
            }

            const html = await response.text();

            // Trích xuất title
            const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
            const title = titleMatch ? titleMatch[1].trim() : '';

            // Trích xuất meta description
            const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
                || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
            const description = descMatch ? descMatch[1].trim() : '';

            // Trích xuất OG tags
            const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
            const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);

            // Trích xuất body text (đơn giản)
            let bodyText = '';
            const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
            if (bodyMatch) {
                bodyText = bodyMatch[1]
                    .replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .substring(0, 2000);
            }

            return {
                url,
                title: ogTitleMatch ? ogTitleMatch[1] : title,
                description: ogDescMatch ? ogDescMatch[1] : description,
                bodyText,
            };
        } catch (err) {
            console.error('[AIAgent] summarizeLink error:', err);
            return { url, error: err.message };
        }
    }
}

module.exports = new AIAgentService();
