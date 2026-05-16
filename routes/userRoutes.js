const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.get('/:username', userController.getUser);
router.post('/update', userController.updateUser);
router.post('/sync-tags', userController.syncTags);
router.post('/toggle-pin', userController.togglePinRoom);
router.post('/toggle-2fa', userController.toggle2FA);

module.exports = router;
