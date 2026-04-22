const userConnections = new Map();
const socketToUser = new Map();
const userProfiles = new Map();

function normalizeProfile(profile = {}) {
    return {
        username: profile.username,
        displayName: profile.displayName || profile.username,
        avatar: profile.avatar || null,
        role: profile.role || 'user',
    };
}

function registerConnection(user, socketId) {
    const username = user.username;
    const existingSockets = userConnections.get(username) || new Set();
    existingSockets.add(socketId);

    userConnections.set(username, existingSockets);
    socketToUser.set(socketId, username);
    userProfiles.set(username, normalizeProfile(user));
}

function updateProfile(username, profile = {}) {
    const currentProfile = userProfiles.get(username) || { username };
    userProfiles.set(username, normalizeProfile({ ...currentProfile, ...profile, username }));
}

function removeConnection(socketId) {
    const username = socketToUser.get(socketId);
    if (!username) return null;

    socketToUser.delete(socketId);
    const existingSockets = userConnections.get(username);
    if (!existingSockets) return { username, stillOnline: false };

    existingSockets.delete(socketId);
    if (existingSockets.size === 0) {
        userConnections.delete(username);
        userProfiles.delete(username);
        return { username, stillOnline: false };
    }

    userConnections.set(username, existingSockets);
    return { username, stillOnline: true };
}

function getProfile(username) {
    return userProfiles.get(username) || null;
}

function isOnline(username) {
    return userConnections.has(username);
}

function getOnlineUsers() {
    const result = {};
    for (const [username, profile] of userProfiles.entries()) {
        result[username] = profile;
    }
    return result;
}

function getOnlineCount() {
    return userProfiles.size;
}

module.exports = {
    getOnlineCount,
    getOnlineUsers,
    getProfile,
    isOnline,
    registerConnection,
    removeConnection,
    updateProfile,
};