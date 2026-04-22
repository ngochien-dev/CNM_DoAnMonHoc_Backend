const socketAuth = require('../middlewares/socketAuth');
const registerChatSocket = require('./chatSocket');
const registerCallSocket = require('./callSocket');
const docClient = require('../awsConfig');

const presenceStore = require('../store/presenceStore');

module.exports = function configureSockets(io) {
    io.use(socketAuth);

    io.on('connection', (socket) => {
        // Tham gia room riêng của user để nhận tín hiệu cá nhân (như call)
        socket.join(`user:${socket.user.username}`);
        
        // Đăng ký connection vào presenceStore
        presenceStore.registerConnection(socket.user, socket.id);

        // Register feature-specific sockets
        registerChatSocket({ io, socket, docClient });
        registerCallSocket({ io, socket });

        // Add additional catch-all or global disconnect logic if needed
    });
};
