const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

function extractBearerToken(headerValue = '') {
    if (typeof headerValue !== 'string') return null;
    const [scheme, token] = headerValue.split(' ');
    if (scheme !== 'Bearer' || !token) return null;
    return token.trim();
}

async function loadVerifiedUser(username) {
    if (!username) return null;
    const user = await User.findByUsername(username);
    if (!user || !user.isVerified || user.isBanned) return null;
    return user;
}

async function requireAuth(req, res, next) {
    try {
        const token = extractBearerToken(req.headers.authorization || '');
        if (!token) {
            return res.status(401).json({ message: 'Thiếu token đăng nhập.' });
        }

        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const user = await loadVerifiedUser(payload.username);

        if (!user) {
            return res.status(401).json({ message: 'Token không hợp lệ hoặc tài khoản không tồn tại.' });
        }

        req.auth = {
            username: user.username,
            displayName: user.displayName,
            role: user.role,
        };
        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ.' });
    }
}

module.exports = {
    extractBearerToken,
    loadVerifiedUser,
    requireAuth,
};