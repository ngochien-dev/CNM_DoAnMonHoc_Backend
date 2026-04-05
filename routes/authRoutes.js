const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Định nghĩa các đường dẫn API
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/verify', authController.verify);

module.exports = router;