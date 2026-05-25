const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middlewares/authMiddleware');

// Định nghĩa các đường dẫn API
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/verify', authController.verify);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/change-password', authController.changePassword);
router.post('/verify-2fa', authController.verify2FA);

// Lock Account routes (requires auth)
router.post('/request-lock', requireAuth, authController.requestAccountLock);
router.post('/confirm-lock', requireAuth, authController.confirmAccountLock);

// Unlock Account routes (public)
router.post('/request-unlock', authController.requestAccountUnlock);
router.post('/confirm-unlock', authController.confirmAccountUnlock);

module.exports = router;