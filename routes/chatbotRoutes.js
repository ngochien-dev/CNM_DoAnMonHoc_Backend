const express = require('express');
const router = express.Router();
const { chatWithGemini, summarizeChat } = require('../controllers/chatbotController');

router.post('/chatbot', chatWithGemini);
router.post('/chatbot/summarize', summarizeChat);

module.exports = router;