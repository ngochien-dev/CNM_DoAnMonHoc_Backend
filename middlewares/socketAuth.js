const jwt = require('jsonwebtoken');
const { extractBearerToken, loadVerifiedUser } = require('./authMiddleware');

module.exports = async function socketAuth(socket, next) {
    try {
        const token =
            socket.handshake.auth?.token ||
            extractBearerToken(socket.handshake.headers?.authorization || '');

        if (!token) {
            return next(new Error('Unauthorized'));
        }

        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const user = await loadVerifiedUser(payload.username);

        if (!user) {
            return next(new Error('Unauthorized'));
        }

        socket.user = {
            username: user.username,
            displayName: user.displayName,
            role: user.role,
            avatar: user.avatar || null,
        };

        next();
    } catch (error) {
        next(new Error('Unauthorized'));
    }
};
