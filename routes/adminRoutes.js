const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

router.get('/stats', adminController.getStats);

// User Management Routes
router.get('/users', adminController.getUsersList);
router.post('/users/toggle-status', adminController.toggleUserStatus);
router.post('/users/reset-password', adminController.resetUserPassword);

// Moderation / Report Routes
router.get('/reports', adminController.getReports);
router.post('/reports/:reportId/resolve', adminController.resolveReport);

module.exports = router;
