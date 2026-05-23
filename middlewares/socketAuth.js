const jwt = require('jsonwebtoken');
const { extractBearerToken, loadVerifiedUser } = require('./authMiddleware');

module.exports = async function socketAuth(socket, next) {
    const socketId = socket.id;
    const auth = socket.handshake.auth || {};
    const token = auth.token || extractBearerToken(socket.handshake.headers?.authorization || '');
    const sessionId = auth.sessionId || null;
    const hasToken = Boolean(token);
    const tokenLength = token ? token.length : 0;
    const tokenPreview = token ? `${token.slice(0, 6)}...${token.slice(-4)}` : null;
    const hasSessionId = Boolean(sessionId);

    console.log('[SocketAuth] auth received', {
        socketId,
        hasToken,
        tokenLength,
        tokenPreview,
        hasSessionId,
        sessionId,
    });

    try {
        if (!token) {
            console.warn('[SocketAuth] Unauthorized', {
                socketId,
                reason: 'MISSING_TOKEN',
                hasToken: false,
                tokenLength: 0,
                tokenPreview: null,
                hasSessionId,
                sessionId,
            });
            return next(new Error('Unauthorized'));
        }

        let payload;
        try {
            payload = jwt.verify(token, process.env.JWT_SECRET);
        } catch (err) {
            console.warn('[SocketAuth] Unauthorized', {
                socketId,
                reason: 'INVALID_TOKEN',
                hasToken: true,
                tokenLength,
                tokenPreview,
                hasSessionId,
                sessionId,
                jwtError: err.message,
            });
            return next(new Error('Unauthorized'));
        }

        const username = payload.username;
        if (!username) {
            console.warn('[SocketAuth] Unauthorized', {
                socketId,
                reason: 'MISSING_USERNAME_IN_TOKEN',
                hasToken: true,
                tokenLength,
                tokenPreview,
                hasSessionId,
                sessionId,
            });
            return next(new Error('Unauthorized'));
        }

        const user = await loadVerifiedUser(username);
        if (!user) {
            console.warn('[SocketAuth] Unauthorized', {
                socketId,
                reason: 'USER_NOT_FOUND',
                username,
                hasToken: true,
                tokenLength,
                tokenPreview,
                hasSessionId,
                sessionId,
            });
            return next(new Error('Unauthorized'));
        }

        // Validate sessionId nếu có — nhất quán với HTTP authMiddleware (optional)
        if (hasSessionId && user.activeSessions && Array.isArray(user.activeSessions)) {
            const hasSession = user.activeSessions.some(s => s.sessionId === sessionId);
            if (!hasSession) {
                console.warn('[SocketAuth] Unauthorized', {
                    socketId,
                    reason: 'SESSION_NOT_FOUND',
                    username,
                    sessionId,
                    hasToken: true,
                    tokenLength,
                    tokenPreview,
                    hasSessionId,
                    activeSessionCount: user.activeSessions.length,
                });
                return next(new Error('Unauthorized'));
            }
        } else if (hasSessionId) {
            // user.activeSessions không tồn tại / không phải array — cho qua, log warning
            console.warn('[SocketAuth] Warning: sessionId provided but user.activeSessions unavailable — allowing through', {
                socketId,
                username,
                sessionId,
                hasActiveSessions: Boolean(user.activeSessions),
            });
        }
        // Nếu không có sessionId → cho phép qua (nhất quán với HTTP authMiddleware)

        socket.user = {
            username: user.username,
            displayName: user.displayName,
            role: user.role,
            avatar: user.avatar || null,
        };
        socket.sessionId = sessionId;

        console.log('[SocketAuth] Socket authorized successfully', {
            socketId,
            username: user.username,
            hasUsername: true,
            hasSessionId,
            hasToken: true,
            tokenLength,
        });
        next();
    } catch (error) {
        console.error('[SocketAuth] Unauthorized', {
            socketId,
            reason: 'UNKNOWN_ERROR',
            error: error.message,
            hasToken,
            tokenLength,
            tokenPreview,
            hasSessionId,
            sessionId,
        });
        next(new Error('Unauthorized'));
    }
};