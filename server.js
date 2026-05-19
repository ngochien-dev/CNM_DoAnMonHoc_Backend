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

function parseOriginList(rawValue = '') {
  return String(rawValue || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function isAllowedDevOrigin(origin = '') {
  return /^https?:\/\/((localhost|127\.0\.0\.1)|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(
    origin,
  );
}

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 3001;
const FRONTEND_ORIGINS = parseOriginList(process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN);

function corsOrigin(origin, callback) {
  if (!origin || FRONTEND_ORIGINS.includes(origin) || isAllowedDevOrigin(origin)) {
    callback(null, true);
    return;
  }

  callback(new Error(`Origin ${origin} is not allowed by CORS.`));
}

const corsOptions = {
  origin: corsOrigin,
  methods: ['GET', 'POST'],
  credentials: true,
};

const io = new Server(httpServer, {
  cors: corsOptions,
});
app.set('io', io);

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));

// P0: Input sanitization - clean all incoming data (XSS protection)
app.use(sanitizeMiddleware);

// P0: Rate limiting - prevent brute-force and spam
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: 'Qua nhieu yeu cau, vui long thu lai sau 15 phut.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  message: { message: 'Qua nhieu yeu cau, vui long thu lai sau.' },
  standardHeaders: true,
  legacyHeaders: false,
});

configureSockets(io);

// Auth routes are public - apply strict rate limit (anti brute-force)
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

httpServer.listen(PORT, HOST, () => {
  console.log(`OTT Server v7 Online on ${HOST}:${PORT} with Sanitization + Rate Limiting`);
});
