const xss = require('xss');

// Custom XSS options — strip all HTML but keep text
const xssOptions = {
    whiteList: {},          // No tags allowed
    stripIgnoreTag: true,   // Strip all non-whitelisted tags
    stripIgnoreTagBody: ['script', 'style'], // Remove script/style content entirely
};

/**
 * Sanitize a single string value using xss library.
 */
function sanitizeString(value) {
    if (typeof value !== 'string') return value;
    return xss(value, xssOptions);
}

/**
 * Recursively sanitize all string values in an object/array.
 * Skips keys that contain binary/file data (base64, fileData).
 */
function sanitizeDeep(obj, depth = 0) {
    if (depth > 10) return obj; // Prevent infinite recursion
    if (obj === null || obj === undefined) return obj;
    if (typeof obj === 'string') return sanitizeString(obj);
    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeDeep(item, depth + 1));
    }

    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
        // Skip sanitization for file data fields (base64 strings)
        if (key === 'fileData' || key === 'avatar') {
            cleaned[key] = value;
            continue;
        }
        cleaned[key] = sanitizeDeep(value, depth + 1);
    }
    return cleaned;
}

/**
 * Express middleware: sanitize req.body and req.query.
 */
function sanitizeMiddleware(req, res, next) {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeDeep(req.body);
    }
    if (req.query && typeof req.query === 'object') {
        req.query = sanitizeDeep(req.query);
    }
    next();
}

/**
 * Sanitize a socket payload object (for use in socket handlers).
 */
function sanitizeSocketPayload(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    return sanitizeDeep(payload);
}

module.exports = {
    sanitizeString,
    sanitizeDeep,
    sanitizeMiddleware,
    sanitizeSocketPayload,
};
