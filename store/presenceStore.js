const userConnections = new Map();
const socketToUser = new Map();
const userProfiles = new Map();
const lastSeenMap = new Map(); // P1: Track last seen timestamps

const CALL_DEBUG_ENABLED = process.env.CALL_DEBUG !== 'false';

function debugPresence(eventName, data = {}) {
    if (!CALL_DEBUG_ENABLED) return;
    console.log('[CALL][BACKEND]', eventName, data);
}

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
    lastSeenMap.delete(username);

    debugPresence('presence.registerConnection', {
        username,
        socketId,
        onlineUsersSize: getOnlineCount(),
        onlineUsernames: getOnlineUsernames(),
        socketCountForUser: getConnectionCount(username),
    });
}

function getConnectionCount(username) {
    return userConnections.get(username)?.size || 0;
}

function getSocketIds(username) {
    return Array.from(userConnections.get(username) || []);
}

function updateProfile(username, profile = {}) {
    const currentProfile = userProfiles.get(username) || { username };
    userProfiles.set(username, normalizeProfile({ ...currentProfile, ...profile, username }));
}

function removeConnection(socketId) {
    const username = socketToUser.get(socketId);

    if (!username) {
        debugPresence('presence.removeConnection socket not found', {
            socketId,
            onlineUsersSize: getOnlineCount(),
            onlineUsernames: getOnlineUsernames(),
        });
        return null;
    }

    socketToUser.delete(socketId);

    const existingSockets = userConnections.get(username);

    if (!existingSockets) {
        debugPresence('presence.removeConnection user set missing', {
            username,
            socketId,
            onlineUsersSize: getOnlineCount(),
            onlineUsernames: getOnlineUsernames(),
        });
        return { username, stillOnline: false };
    }

    existingSockets.delete(socketId);

    if (existingSockets.size === 0) {
        userConnections.delete(username);
        userProfiles.delete(username);

        // P1: Record last seen timestamp when user goes fully offline
        lastSeenMap.set(username, new Date().toISOString());

        debugPresence('presence.removeConnection user offline', {
            username,
            socketId,
            stillOnline: false,
            onlineUsersSize: getOnlineCount(),
            onlineUsernames: getOnlineUsernames(),
        });

        return { username, stillOnline: false };
    }

    userConnections.set(username, existingSockets);

    debugPresence('presence.removeConnection user still online', {
        username,
        socketId,
        stillOnline: true,
        socketCountForUser: getConnectionCount(username),
        onlineUsersSize: getOnlineCount(),
        onlineUsernames: getOnlineUsernames(),
    });

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

function getOnlineUsernames() {
    return Array.from(userConnections.keys());
}

function getLastSeen(username) {
    if (isOnline(username)) return null;
    return lastSeenMap.get(username) || null;
}

function getLastSeenBatch(usernames = []) {
    const result = {};

    for (const username of usernames) {
        result[username] = getLastSeen(username);
    }

    return result;
}

module.exports = {
    getOnlineCount,
    getOnlineUsers,
    getProfile,
    isOnline,
    getLastSeen,
    getLastSeenBatch,
    getConnectionCount,
    getSocketIds,
    getOnlineUsernames,
    registerConnection,
    removeConnection,
    updateProfile,
};
