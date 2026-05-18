const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const { requireAuth } = require('../middlewares/authMiddleware');

router.post('/create', requireAuth, postController.createPost);
router.get('/list', requireAuth, postController.getPosts);
router.post('/react', requireAuth, postController.reactPost);
router.post('/comment', requireAuth, postController.commentPost);
router.post('/comment/delete', requireAuth, postController.deleteComment);
router.post('/comment/edit', requireAuth, postController.editComment);
router.post('/comment/react', requireAuth, postController.reactComment);
router.post('/comment/reply', requireAuth, postController.replyComment);


router.post('/edit', requireAuth, postController.editPost);
router.post('/delete', requireAuth, postController.deletePost);

module.exports = router;
