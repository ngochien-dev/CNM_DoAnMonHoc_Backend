const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

exports.chatWithGemini = async (req, res) => {
  try {
    console.log('Received chatbot request:', JSON.stringify(req.body, null, 2));
    const { messages } = req.body;
    const contents = messages.map(msg => ({
      role: (msg.role === 'system' || msg.role === 'assistant') ? 'model' : msg.role,
      parts: [{ text: msg.content }]
    }));
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents
    });
    const reply = result.text || 'Xin lỗi, tôi chưa có câu trả lời.';
    res.json({ reply });
  } catch (err) {
    console.error('Gemini API error:', err?.response?.data || err.message || err);
    res.status(500).json({ reply: 'Xin lỗi, có lỗi xảy ra khi kết nối AI.' });
  }
};