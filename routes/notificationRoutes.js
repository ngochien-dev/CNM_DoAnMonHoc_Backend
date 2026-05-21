/**
 * notificationRoutes.js
 * Routes cho FCM token management và notification settings.
 */

const express = require('express');
const router = express.Router();
const {
    saveFcmToken,
    removeFcmToken,
    getNotificationSettings,
    updateNotificationSettings,
} = require('../controllers/notificationController');

// FCM Token
router.post('/token', saveFcmToken);           // Lưu FCM token khi đăng nhập
router.delete('/token', removeFcmToken);        // Xóa FCM token khi logout

// Notification Settings
router.get('/settings', getNotificationSettings);       // Lấy cài đặt
router.put('/settings', updateNotificationSettings);    // Cập nhật cài đặt

module.exports = router;
