const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { requireAuth } = require('./middlewares/authMiddleware');
const { sanitizeMiddleware } = require('./middlewares/sanitize');
const authRoutes = require('./routes/authRoutes');
const chatbotRoutes = require('./routes/chatbotRoutes');
const messageRoutes = require('./routes/messageRoutes');
const userRoutes = require('./routes/userRoutes');
const callRoutes = require('./routes/callRoutes');
const adminRoutes = require('./routes/adminRoutes');
const groupRoutes = require('./routes/groupRoutes');
const friendRoutes = require('./routes/friendRoutes');
const searchRoutes = require('./routes/searchRoutes');
const utilsRoutes = require('./routes/utilsRoutes');
const storyRoutes = require('./routes/storyRoutes');
const postRoutes = require('./routes/postRoutes');

const configureSockets = require('./socket');

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
app.set('io', io);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// P0: Input sanitization — clean all incoming data (XSS protection)
app.use(sanitizeMiddleware);

// P0: Rate limiting — prevent brute-force and spam
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // max 20 requests per window per IP
  message: { message: 'Quá nhiều yêu cầu, vui lòng thử lại sau 15 phút.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, // Increased to 300 for rich OTT features
  message: { message: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
  standardHeaders: true,
  legacyHeaders: false,
});

configureSockets(io);

// Auth routes are public — apply strict rate limit (anti brute-force)
app.use('/api/auth', authLimiter, authRoutes);
// All other routes require authentication + general rate limit
app.use('/api/users', apiLimiter, requireAuth, userRoutes);
app.use('/api', apiLimiter, requireAuth, chatbotRoutes);
app.use('/api/v1/messages', apiLimiter, requireAuth, messageRoutes);
app.use('/api/calls', apiLimiter, requireAuth, callRoutes);
app.use('/api/admin', apiLimiter, requireAuth, adminRoutes);
app.use('/api/groups', apiLimiter, requireAuth, groupRoutes);
app.use('/api/friends', apiLimiter, requireAuth, friendRoutes);
app.use('/api/search', apiLimiter, requireAuth, searchRoutes);
app.use('/api/utils', apiLimiter, requireAuth, utilsRoutes);
app.use('/api/stories', apiLimiter, requireAuth, storyRoutes);
app.use('/api/posts', apiLimiter, requireAuth, postRoutes);



httpServer.listen(3001, () => {
  console.log('🚀 OTT Server v7 Online — with Sanitization + Rate Limiting');
});