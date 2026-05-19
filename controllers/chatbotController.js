const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

exports.chatWithGemini = async (req, res) => {
  try {
    console.log('Received chatbot request:', JSON.stringify(req.body, null, 2));
    const { messages } = req.body;

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
      contents
    });

    const reply = result.text || 'Xin lỗi, tôi chưa có câu trả lời.';
    res.json({ reply });
  } catch (err) {
    console.error('Gemini API error:', err?.response?.data || err.message || err);
    res.status(500).json({ reply: 'Xin lỗi, có lỗi xảy ra khi kết nối AI. Lỗi: ' + (err.message || 'Unknown') });
  }
};