const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

exports.chatWithGemini = async (req, res) => {
  try {
    console.log('Received chatbot request:', JSON.stringify(req.body, null, 2));
    const { messages, agent } = req.body;

    let systemInstruction = "Bạn là một trợ lý ảo thông minh và thân thiện.";
    if (agent === 'ott') {
      systemInstruction = `Bạn là "Trợ lý Hệ thống OTT" - một AI đồng hành thông minh được tích hợp sẵn trong ứng dụng OTT Chat & Collaboration Platform (phát triển bởi đội ngũ ngochien140604).
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

Hãy trả lời ngắn gọn, lịch sự, chuyên nghiệp. Xưng là "Trợ lý OTT" hoặc "Tôi". Trả lời có cấu trúc và Markdown nếu cần.`;
    } else if (agent === 'coder') {
      systemInstruction = "Bạn là một chuyên gia lập trình phần mềm cấp cao. Hãy giải thích và viết code sạch, tối ưu bằng Markdown tiếng Việt.";
    } else if (agent === 'translator') {
      systemInstruction = "Bạn là một dịch thuật viên chuyên nghiệp. Hãy dịch các đoạn văn bản chính xác, tự nhiên giữa các ngôn ngữ và giải thích nếu cần.";
    } else if (agent === 'writer') {
      systemInstruction = "Bạn là một nhà sáng tạo nội dung chuyên nghiệp. Hãy viết bài viết sáng tạo, email, kịch bản, sửa văn phong tiếng Việt cuốn hút.";
    } else if (agent === 'health') {
      systemInstruction = "Bạn là một chuyên gia tư vấn sức khỏe và phong cách sống lành mạnh. Đưa ra lời khuyên khoa học về dinh dưỡng và sinh hoạt bằng tiếng Việt (luôn ghi chú lời khuyên này không thay thế chẩn đoán y tế).";
    }

    // Chuyển đổi roles: system/user -> user, assistant -> model
    // Đảm bảo tin nhắn đầu tiên luôn là 'user'
    const contents = messages.map((msg, idx) => ({
      role: (msg.role === 'assistant') ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    // Nếu tin nhắn đầu là model (do system convert sang), ta đổi nó thành user
    if (contents.length > 0 && contents[0].role === 'model') {
      contents[0].role = 'user';
    }

    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      config: {
        systemInstruction
      }
    });

    const reply = result.text || 'Xin lỗi, tôi chưa có câu trả lời.';
    res.json({ reply });
  } catch (err) {
    console.error('Gemini API error:', err?.response?.data || err.message || err);
    res.status(500).json({ reply: 'Xin lỗi, có lỗi xảy ra khi kết nối AI. Lỗi: ' + (err.message || 'Unknown') });
  }
};