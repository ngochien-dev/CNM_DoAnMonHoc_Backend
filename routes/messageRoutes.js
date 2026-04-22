const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

// Simple search by content
router.get('/search', messageController.searchByContent);

// Advanced search with all available filters
router.get('/search/advanced', messageController.advancedSearch);

// Search messages from specific user (from: userId)
router.get('/search/from/:userId', messageController.searchByUser);

// Search messages with attachments (tệp)
router.get('/search/with-attachments', messageController.searchWithAttachments);

// Search messages with links
router.get('/search/with-links', messageController.searchWithLinks);

// Search messages by date range (before, after)
router.get('/search/date-range', messageController.searchByDateRange);

// Search edited messages
router.get('/search/edited', messageController.searchEditedMessages);

// Search pinned messages (đã ghim)
router.get('/search/pinned', messageController.searchPinnedMessages);

// Basic messaging operations
router.get('/:username', messageController.getMessages);
router.post('/delete-for-me', messageController.deleteForMe);
router.post('/clear-history', messageController.clearHistory);
router.post('/pin', messageController.pinMessage);
router.post('/vote', messageController.votePoll);
router.post('/attend-event', messageController.attendEvent);
router.post('/react', messageController.reactToMessage);

module.exports = router;