const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const { requireAuth } = require('./middlewares/authMiddleware');
const authRoutes = require('./routes/authRoutes');
const chatbotRoutes = require('./routes/chatbotRoutes');
const messageRoutes = require('./routes/messageRoutes');
const userRoutes = require('./routes/userRoutes');
const callRoutes = require('./routes/callRoutes');
const adminRoutes = require('./routes/adminRoutes');
const groupRoutes = require('./routes/groupRoutes');
const friendRoutes = require('./routes/friendRoutes');

const configureSockets = require('./socket');

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});
app.set('io', io);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

configureSockets(io);

// Auth routes are public (login, register, forgot/reset password)
app.use('/api/auth', authRoutes);
// All other routes require authentication
app.use('/api/users', requireAuth, userRoutes);
app.use('/api', requireAuth, chatbotRoutes);
app.use('/api/v1/messages', requireAuth, messageRoutes);
app.use('/api/calls', requireAuth, callRoutes);
app.use('/api/admin', requireAuth, adminRoutes);
app.use('/api/groups', requireAuth, groupRoutes);
app.use('/api/friends', requireAuth, friendRoutes);



httpServer.listen(3001, () => {
  console.log('🚀 OTT Server v6 Online');
});