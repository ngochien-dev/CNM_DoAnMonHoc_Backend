const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.get('/:username', userController.getUser);
router.post('/update', userController.updateUser);
router.post('/sync-tags', userController.syncTags);

module.exports = router;
