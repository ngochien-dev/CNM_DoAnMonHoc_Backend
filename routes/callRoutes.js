const express = require('express');
const callController = require('../controllers/callController');
const { requireAuth } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/config', requireAuth, callController.getClientConfig);
router.get('/history', requireAuth, callController.getHistory);
router.get('/:callId', requireAuth, callController.getCallById);

module.exports = router;
