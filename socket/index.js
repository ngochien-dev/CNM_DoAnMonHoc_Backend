const socketAuth = require('../middlewares/socketAuth');
const registerChatSocket = require('./chatSocket');
const registerCallSocket = require('./callSocket');
const registerGroupCallSocket = require('./groupCallSocket');
const registerStrangerSocket = require('./strangerSocket');
const docClient = require('../awsConfig');

const presenceStore = require('../store/presenceStore');
const CALL_DEBUG_ENABLED = process.env.CALL_DEBUG !== 'false';

function debugSocket(eventName, data = {}) {
    if (!CALL_DEBUG_ENABLED) return;
    console.log('[SOCKET]', eventName, data);
}

function summarizeHandshake(socket) {
    return {
        transport: socket.conn?.transport?.name || null,
        address: socket.handshake?.address || null,
        authKeys: Object.keys(socket.handshake?.auth || {}),
        hasAuthToken: Boolean(socket.handshake?.auth?.token),
        hasAuthSessionId: Boolean(socket.handshake?.auth?.sessionId),
        queryKeys: Object.keys(socket.handshake?.query || {}),
        headers: {
            origin: socket.handshake?.headers?.origin || null,
            userAgent: socket.handshake?.headers?.['user-agent'] || null,
        },
    };
}

module.exports = function configureSockets(io) {
    io.use(socketAuth);

    io.on('connection', (socket) => {
        debugSocket('User socket connected.', {
            username: socket.user.username,
            socketId: socket.id,
            sessionId: socket.sessionId || null,
            handshake: summarizeHandshake(socket),
        });
        // Tham gia room riêng của user để nhận tín hiệu cá nhân (như call)
        socket.join(`user:${socket.user.username}`);
        
        // Đăng ký connection vào presenceStore
        presenceStore.registerConnection(socket.user, socket.id);
        console.log('[SocketAuth] connected user mapped', {
            username: socket.user.username,
            socketId: socket.id,
            sessionId: socket.sessionId || null,
            totalSocketsForUser: presenceStore.getConnectionCount(socket.user.username),
            onlineUsersCount: presenceStore.getOnlineCount()
        });
        debugSocket('User registered online.', {
            username: socket.user.username,
            socketId: socket.id,
            room: `user:${socket.user.username}`,
            connectionCount: presenceStore.getConnectionCount(socket.user.username),
            onlineBy: 'username',
            onlineUsersSize: presenceStore.getOnlineCount(),
            onlineUsernames: presenceStore.getOnlineUsernames(),
        });

        // Register feature-specific sockets
        registerChatSocket({ io, socket, docClient });
        registerCallSocket({ io, socket });
        registerGroupCallSocket({ io, socket });
        registerStrangerSocket({ io, socket });

        // Add additional catch-all or global disconnect logic if needed
    });
};
