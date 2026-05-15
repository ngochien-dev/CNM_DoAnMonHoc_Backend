const userConnections = new Map();
const socketToUser = new Map();
const userProfiles = new Map();
const lastSeenMap = new Map(); // P1: Track last seen timestamps

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
        // P1: Record last seen timestamp when user goes fully offline
        lastSeenMap.set(username, new Date().toISOString());
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

// P1: Get last seen timestamp for a user
function getLastSeen(username) {
    if (isOnline(username)) return null; // Currently online, no "last seen"
    return lastSeenMap.get(username) || null;
}

// P1: Get last seen for multiple users
function getLastSeenBatch(usernames) {
    const result = {};
    for (const username of usernames) {
        if (isOnline(username)) {
            result[username] = null; // online
        } else {
            result[username] = lastSeenMap.get(username) || null;
        }
    }
    return result;
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
    getLastSeen,
    getLastSeenBatch,
    registerConnection,
    removeConnection,
    updateProfile,
};