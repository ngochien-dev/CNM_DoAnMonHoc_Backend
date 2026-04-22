const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

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

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api', chatbotRoutes);
app.use('/api/v1/messages', messageRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/friends', friendRoutes);



httpServer.listen(3001, () => {
  console.log('🚀 OTT Server v6 Online');
});