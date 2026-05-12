const express = require('express');
const router = express.Router();
const friendController = require('../controllers/friendController');

router.post('/request', friendController.requestFriend);
router.post('/accept', friendController.acceptFriend);
router.post('/reject', friendController.rejectFriend);
router.post('/unfriend', friendController.unfriend);

module.exports = router;
