const express = require('express');
const router = express.Router();
const { chatWithGemini } = require('../controllers/chatbotController');

router.post('/chatbot', chatWithGemini);

module.exports = router;
