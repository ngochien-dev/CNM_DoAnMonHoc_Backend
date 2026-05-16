const express = require('express');
const router = express.Router();
const storyController = require('../controllers/storyController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.post('/upload', requireAuth, storyController.uploadStory);
router.get('/list', requireAuth, storyController.getStories);
router.post('/react', requireAuth, storyController.reactStory);
router.post('/delete', requireAuth, storyController.deleteStory);

module.exports = router;
