const { GoogleGenAI } = require("@google/genai");
const aiAgentService = require('../services/aiAgentService');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ─── Gemini Function Calling — Tool Declarations ────────────────────────────
const IN_CHAT_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "summarize_conversation",
        description: "Tóm tắt hội thoại gần đây trong phòng chat hiện tại. Sử dụng khi người dùng muốn biết có gì mới, bỏ lỡ gì, hoặc yêu cầu tóm tắt cuộc trò chuyện.",
        parameters: {
          type: "OBJECT",
          properties: {
            messageCount: {
              type: "INTEGER",
              description: "Số lượng tin nhắn gần nhất muốn tóm tắt. Mặc định 20, tối đa 50."
            },
            sinceMinutes: {
              type: "INTEGER",
              description: "Tóm tắt tin nhắn trong N phút gần nhất. Ví dụ: 30 = 30 phút qua."
            }
          }
        }
      },
      {
        name: "search_messages",
        description: "Tìm kiếm tin nhắn theo nội dung, người gửi, hoặc khoảng thời gian trong phòng chat hiện tại. Sử dụng khi người dùng muốn tìm lại tin nhắn cụ thể.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: {
              type: "STRING",
              description: "Từ khóa nội dung cần tìm trong tin nhắn."
            },
            senderName: {
              type: "STRING",
              description: "Tên người gửi (username hoặc displayName) cần lọc."
            },
            dateRange: {
              type: "OBJECT",
              description: "Khoảng thời gian cần lọc.",
              properties: {
                before: {
                  type: "STRING",
                  description: "Tìm tin nhắn trước ngày này. Định dạng ISO: YYYY-MM-DD."
                },
                after: {
                  type: "STRING",
                  description: "Tìm tin nhắn sau ngày này. Định dạng ISO: YYYY-MM-DD."
                }
              }
            }
          }
        }
      },
      {
        name: "suggest_smart_replies",
        description: "Gợi ý 3-5 câu trả lời nhanh phù hợp dựa trên ngữ cảnh cuộc trò chuyện gần nhất. Sử dụng khi người dùng hỏi 'gợi ý reply', 'nên trả lời gì', hoặc cần ý tưởng phản hồi.",
        parameters: {
          type: "OBJECT",
          properties: {
            count: {
              type: "INTEGER",
              description: "Số lượng gợi ý mong muốn (3-5). Mặc định 4."
            }
          }
        }
      },
      {
        name: "writing_assistant",
        description: "Công cụ hỗ trợ viết tin nhắn: chỉnh sửa văn phong (lịch sự, chuyên nghiệp), sửa lỗi chính tả/ngữ pháp. Sử dụng khi người dùng muốn sửa/chỉnh một đoạn text.",
        parameters: {
          type: "OBJECT",
          properties: {
            action: {
              type: "STRING",
              description: "Loại hành động: 'polite' (lịch sự hơn), 'professional' (chuyên nghiệp), 'fix_grammar' (sửa lỗi chính tả/ngữ pháp), 'casual' (thân thiện)."
            },
            text: {
              type: "STRING",
              description: "Đoạn văn bản cần xử lý."
            }
          },
          required: ["action", "text"]
        }
      },
      {
        name: "process_content",
        description: "Xử lý nội dung media và link: tóm tắt link bài báo/tài liệu, hoặc chuyển đổi hình ảnh chụp tài liệu/bảng trắng thành văn bản (OCR). Sử dụng khi người dùng gửi link muốn tóm tắt hoặc gửi ảnh muốn trích xuất text.",
        parameters: {
          type: "OBJECT",
          properties: {
            action: {
              type: "STRING",
              description: "Loại xử lý: 'summarize_link' (tóm tắt link), 'ocr_image' (trích xuất text từ ảnh)."
            },
            url: {
              type: "STRING",
              description: "URL cần tóm tắt (khi action='summarize_link')."
            },
            imageData: {
              type: "STRING",
              description: "Base64 data hoặc URL của ảnh cần OCR (khi action='ocr_image')."
            }
          },
          required: ["action"]
        }
      },
      {
        name: "send_friend_request",
        description: "Gửi lời mời kết bạn tự động cho người dùng theo username. Sử dụng khi người dùng yêu cầu kết bạn, thêm bạn, hoặc gửi lời mời kết bạn với ai đó. Ví dụ: 'kết bạn với kuruma', 'giúp tôi kết bạn với user123', 'thêm bạn abc'.",
        parameters: {
          type: "OBJECT",
          properties: {
            targetUsername: {
              type: "STRING",
              description: "Username của người dùng muốn kết bạn. Đây là tên đăng nhập (username), không phải tên hiển thị."
            }
          },
          required: ["targetUsername"]
        }
      }
    ]
  }
];

// ─── System Instructions ────────────────────────────────────────────────────
const IN_CHAT_SYSTEM_INSTRUCTION = `Bạn là "Trợ lý AI OTT" — một AI Agent thông minh được tích hợp trực tiếp vào khung hội thoại của ứng dụng OTT Chat.

NHIỆM VỤ CHÍNH:
- Bạn có quyền truy cập lịch sử tin nhắn của phòng chat hiện tại thông qua các tool function.
- Khi người dùng yêu cầu TÓM TẮT, TÌM KIẾM, GỢI Ý PHẢN HỒI, SỬA VĂN PHONG, TÓM TẮT LINK, OCR, hoặc KẾT BẠN → Hãy GỌI TOOL tương ứng.
- Khi người dùng hỏi đáp thông thường, trò chuyện, hoặc hỏi về tính năng ứng dụng → Trả lời trực tiếp KHÔNG gọi tool.
- Khi người dùng yêu cầu kết bạn (ví dụ: "kết bạn với X", "thêm bạn Y", "giúp tôi kết bạn với Z") → GỌI tool send_friend_request với targetUsername là username mà người dùng đề cập.

QUY TẮC:
1. Luôn trả lời bằng tiếng Việt, ngắn gọn, rõ ràng.
2. Khi gọi tool thành công, hãy tổng hợp kết quả thành câu trả lời tự nhiên, dễ hiểu.
3. Khi tóm tắt hội thoại, hãy liệt kê các chủ đề chính và đề xuất quan trọng.
4. Khi tìm kiếm tin nhắn, hãy format kết quả rõ ràng với thời gian và người gửi.
5. Khi gợi ý smart replies, hãy đưa ra 3-5 câu ngắn gọn, phù hợp ngữ cảnh.
6. Khi sửa văn phong, hãy trả về cả bản gốc và bản đã sửa.
7. Khi kết bạn, hãy báo kết quả rõ ràng (thành công hoặc lỗi gì).
8. Xưng là "Trợ lý AI" hoặc "Tôi".

THÔNG TIN ỨNG DỤNG:
- Tên: OTT Chat & Collaboration Platform
- Tính năng: Chat cá nhân/nhóm, E2EE, Secret Chat, Video Call, Cloud Drive, Bảng tin, Game Center, Todo List.`;

// ─── Agent-specific system instructions (existing behavior) ─────────────────
const AGENT_INSTRUCTIONS = {
  ott: `Bạn là "Trợ lý Hệ thống OTT" - một AI đồng hành thông minh được tích hợp sẵn trong ứng dụng OTT Chat & Collaboration Platform (phát triển bởi đội ngũ ngochien140604).
Nhiệm vụ của bạn là giải đáp, hướng dẫn người dùng sử dụng toàn bộ các tính năng của ứng dụng này một cách chi tiết, cụ thể và chuyên nghiệp bằng tiếng Việt.

Thông tin chi tiết về ứng dụng:
1. Tên ứng dụng: OTT Chat & Collaboration Platform (hoặc OTT App).
2. Công nghệ: React + Vite + CSS thuần cho Frontend; Node.js + Express cho Backend; DynamoDB làm Cơ sở dữ liệu; Socket.io truyền tải thời gian thực.
3. Các tính năng chính và cách hoạt động:
   - Trò chuyện (Chats): Hỗ trợ Chat cá nhân (DMs) và Chat nhóm (Groups). Có trạng thái đang gõ (typing), trạng thái tin nhắn (đã gửi - đã đọc). Cho phép Ghim tin nhắn hoặc ghim hội thoại.
   - Bảo mật E2EE (Mã hóa đầu cuối): Mã hóa tin nhắn cá nhân bằng cặp khóa ECDH (phát sinh qua Web Crypto API) và mã hóa nội dung bằng AES-GCM. Đảm bảo bảo mật tối đa, chỉ 2 người trong phòng chat mới giải mã được.
   - Trò chuyện bí mật (Secret Chat): Hội thoại mã hóa E2EE, cho phép đặt "Bộ đếm thời gian tự hủy" (10s, 30s, 1m,...). Sau khi hết hạn, tin nhắn biến mất vĩnh viễn trên màn hình và database.
   - Gọi thoại & Video (WebRTC): Gọi thoại và gọi video trực tiếp Peer-to-Peer. Lịch sử cuộc gọi lưu trong tab "Nhật ký cuộc gọi".
   - Nhắc việc (To-Do List): Quản lý công việc cá nhân. Cho phép thiết lập độ ưu tiên (Thấp/Trung bình/Cao), đặt hạn chót (Due date), đánh dấu hoàn thành trước hạn và xóa việc.
   - Bảng tin (Social Feed): Đăng khoảnh khắc, bài viết kèm hình ảnh, thích (like) và bình luận (comment).
   - Game Center (Trò chơi): Chơi các game HTML5 trực tuyến, tự động đồng bộ điểm số cao lên Bảng xếp hạng toàn hệ thống.
   - Cloud của tôi: Không gian lưu trữ cá nhân (tự chat với chính mình) để lưu file, ảnh, ghi chú và link.
   - Hộp lưu trữ (Archived Chats): Ẩn bớt các phòng chat cũ vào kho lưu trữ. Click qua icon hộp lưu trữ ở sidebar trái.
   - Bảo mật 2FA & Session Control: Hỗ trợ xác thực 2 lớp. Xem danh sách các phiên đăng nhập hoạt động và nhấn nút Đăng xuất từ xa để hủy phiên đáng ngờ.
   - Admin Panel: Cho phép Admin xem thống kê hệ thống, quản lý người dùng (khóa/mở khóa tài khoản, reset mật khẩu).

Hãy trả lời ngắn gọn, lịch sự, chuyên nghiệp. Xưng là "Trợ lý OTT" hoặc "Tôi". Trả lời có cấu trúc và Markdown nếu cần.`,
  coder: "Bạn là một chuyên gia lập trình phần mềm cấp cao. Hãy giải thích và viết code sạch, tối ưu bằng Markdown tiếng Việt.",

  writer: "Bạn là một nhà sáng tạo nội dung chuyên nghiệp. Hãy viết bài viết sáng tạo, email, kịch bản, sửa văn phong tiếng Việt cuốn hút.",
  health: "Bạn là một chuyên gia tư vấn sức khỏe và phong cách sống lành mạnh. Đưa ra lời khuyên khoa học về dinh dưỡng và sinh hoạt bằng tiếng Việt (luôn ghi chú lời khuyên này không thay thế chẩn đoán y tế).",
};

// ─── Execute Tool Function ──────────────────────────────────────────────────
async function executeToolFunction(functionCall, roomId, fromUser, io) {
  const { name, args } = functionCall;
  
  switch (name) {
    case 'summarize_conversation':
      return await aiAgentService.summarizeConversation({
        roomId,
        messageCount: args.messageCount || 20,
        sinceMinutes: args.sinceMinutes,
      });

    case 'search_messages':
      return await aiAgentService.searchMessages({
        roomId,
        query: args.query,
        senderName: args.senderName,
        dateRange: args.dateRange,
      });

    case 'suggest_smart_replies':
      return await aiAgentService.suggestSmartReplies({
        roomId,
        count: args.count || 4,
      });

    case 'writing_assistant':
      return await aiAgentService.writingAssistant({
        action: args.action,
        text: args.text,
      });

    case 'process_content':
      if (args.action === 'summarize_link' && args.url) {
        return await aiAgentService.summarizeLink({ url: args.url });
      }
      if (args.action === 'ocr_image' && args.imageData) {
        return await aiAgentService.ocrImage({ imageData: args.imageData });
      }
      return { error: 'Missing required parameters for process_content' };

    case 'send_friend_request':
      return await aiAgentService.sendFriendRequest({
        fromUser,
        targetUsername: args.targetUsername,
        io,
      });

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Main Controller ────────────────────────────────────────────────────────
exports.chatWithGemini = async (req, res) => {
  try {
    const { messages, agent, roomId } = req.body;
    const fromUser = req.body.fromUser || req.user?.username || req.auth?.username;
    const io = req.app.get('io');

    // ─── Determine mode: in-chat agent vs standalone agents ─────────────────
    const isInChatAgent = agent === 'in-chat';

    // Pick system instruction
    let systemInstruction = "Bạn là một trợ lý ảo thông minh và thân thiện.";
    if (isInChatAgent) {
      systemInstruction = IN_CHAT_SYSTEM_INSTRUCTION;
    } else if (AGENT_INSTRUCTIONS[agent]) {
      systemInstruction = AGENT_INSTRUCTIONS[agent];
    }

    // Convert message roles: system/user → user, assistant → model
    const mapped = messages
      .filter(msg => msg.content && msg.content.trim())
      .map((msg) => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));

    // Ensure first message has role 'user'
    if (mapped.length > 0 && mapped[0].role === 'model') {
      mapped[0].role = 'user';
    }

    // Merge consecutive messages with identical roles to strictly alternate
    const contents = [];
    for (const item of mapped) {
      if (contents.length > 0 && contents[contents.length - 1].role === item.role) {
        contents[contents.length - 1].parts[0].text += '\n' + item.parts[0].text;
      } else {
        contents.push(item);
      }
    }

    // ─── In-Chat Agent: Use Function Calling ────────────────────────────────
    if (isInChatAgent) {
      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
        config: { 
          systemInstruction,
          tools: IN_CHAT_TOOLS 
        },
      });

      // Check if Gemini wants to call a function
      const candidate = result.candidates?.[0];
      const parts = candidate?.content?.parts || [];
      const functionCallPart = parts.find(p => p.functionCall);

      if (functionCallPart) {
        // ─── AGENT MODE: Execute tool and synthesize response ───────────────
        const { functionCall } = functionCallPart;
        console.log(`[AI Agent] Function call: ${functionCall.name}`, functionCall.args);

        const toolResult = await executeToolFunction(functionCall, roomId, fromUser, io);
        console.log(`[AI Agent] Tool result keys:`, Object.keys(toolResult));

        // Send tool result back to Gemini for natural language synthesis
        const functionResponseContents = [
          ...contents,
          candidate.content,
          {
            role: 'user',
            parts: [{
              functionResponse: {
                name: functionCall.name,
                response: toolResult,
              }
            }]
          }
        ];

        const finalResult = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: functionResponseContents,
          config: { 
            systemInstruction,
            tools: IN_CHAT_TOOLS 
          },
        });

        const reply = finalResult.text || 'Đã thực hiện xong nhưng không có kết quả cụ thể.';

        // Build smart replies if the tool was suggest_smart_replies
        let smartReplies = null;
        if (functionCall.name === 'suggest_smart_replies' && toolResult.recentMessages) {
          // Gemini already synthesized replies in the text, but we also try to parse them
          smartReplies = extractSmartReplies(reply);
        }

        return res.json({
          reply,
          mode: 'agent',
          tool: functionCall.name,
          toolData: toolResult,
          smartReplies,
        });
      } else {
        // ─── CHATBOT MODE: Direct text response ────────────────────────────
        const reply = result.text || 'Xin lỗi, tôi chưa có câu trả lời.';
        return res.json({
          reply,
          mode: 'chatbot',
        });
      }
    }

    // ─── Standalone Agents (existing behavior — no function calling) ────────
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: { systemInstruction },
    });

    const reply = result.text || 'Xin lỗi, tôi chưa có câu trả lời.';
    res.json({ reply });

  } catch (err) {
    console.error('Gemini API error:', err?.response?.data || err.message || err);

    // Detect quota / rate-limit errors from the GenAI client and return a clearer response
    const statusCode = err?.status || err?.response?.status || err?.response?.data?.error?.code;
    const isQuota = Number(statusCode) === 429 || Number(statusCode) === 403;

    if (isQuota) {
      return res.status(503).json({
        reply: 'Hệ thống AI đang quá tải hoặc quota đã hết. Vui lòng kiểm tra billing/GEMINI_API_KEY hoặc thử lại sau vài phút.',
        mode: 'error',
      });
    }

    res.status(500).json({
      reply: 'Xin lỗi, có lỗi xảy ra khi kết nối AI. Lỗi: ' + (err.message || 'Unknown'),
      mode: 'error',
    });
  }
};

// ─── Helper: Extract smart reply options from Gemini text ───────────────────
function extractSmartReplies(text) {
  if (!text) return null;
  // Try to parse numbered list or bullet points from Gemini response
  const lines = text.split('\n').filter(l => l.trim());
  const replies = [];
  for (const line of lines) {
    // Match patterns like: 1. "OK, anh!" or - "Được rồi" or • Reply text
    const match = line.match(/(?:^[\d]+[.)]\s*|^[-•*]\s*)[""]?(.+?)[""]?\s*$/);
    if (match && match[1].length < 100) {
      const clean = match[1].replace(/^[""\s]+|[""\s]+$/g, '').trim();
      if (clean.length > 0 && clean.length < 80) {
        replies.push(clean);
      }
    }
  }
  return replies.length >= 2 ? replies.slice(0, 5) : null;
}

// ─── Summarize Chat (Direct) ────────────────────────────────────────────────
exports.summarizeChat = async (req, res) => {
  try {
    const { chatText } = req.body;
    
    if (!chatText) {
      return res.status(400).json({ error: 'Missing chat text' });
    }

    const systemInstruction = "Bạn là Trợ lý AI OTT. Dưới đây là một đoạn lịch sử trò chuyện. Hãy tóm tắt nội dung chính, các chủ đề quan trọng hoặc quyết định được đưa ra một cách ngắn gọn, súc tích (khoảng 3-4 câu) bằng tiếng Việt thân thiện.";
    
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: chatText }] }],
      config: { systemInstruction },
    });

    const summary = result.text || 'Không thể tóm tắt đoạn hội thoại này.';
    res.json({ summary });
  } catch (err) {
    console.error('Gemini Summarize API error:', err?.response?.data || err.message || err);
    res.status(500).json({ error: 'Lỗi khi kết nối với AI' });
  }
};