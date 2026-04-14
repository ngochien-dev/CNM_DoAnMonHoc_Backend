const presenceStore = require('../store/presenceStore');

function emitOnlineUsers(io) {
    io.emit('update_user_list', presenceStore.getOnlineUsers());
}

function buildSafePresenceProfile(socket, payload = {}) {
    return {
        username: socket.user.username,
        displayName: payload.displayName || socket.user.displayName || socket.user.username,
        avatar: payload.avatar ?? socket.user.avatar ?? null,
        role: socket.user.role || payload.role || 'user',
    };
}

module.exports = function registerChatSocket({ io, socket, docClient }) {
    socket.on('user_online', (payload = {}) => {
        const safeProfile = buildSafePresenceProfile(socket, payload);
        socket.user = { ...socket.user, ...safeProfile };
        presenceStore.updateProfile(socket.user.username, safeProfile);
        emitOnlineUsers(io);
    });

    socket.on('admin_update_group', () => io.emit('groups_updated'));
    socket.on('request_join_group', () => io.emit('groups_updated'));

    socket.on('send_message', async (payload = {}) => {
        const presenceProfile = presenceStore.getProfile(socket.user.username) || socket.user;
        const item = {
            messageId: Date.now().toString(),
            ...payload,
            sender: payload.sender || presenceProfile.displayName || socket.user.username,
            senderUsername: socket.user.username,
            roomId: payload.roomId || 'chung',
            isRevoked: false,
            createdAt: new Date().toISOString(),
        };

        await docClient.put({ TableName: 'Messages', Item: item }).promise();
        io.emit('receive_message', item);
    });

    socket.on('revoke_message', async (messageId) => {
        await docClient.update({
            TableName: 'Messages',
            Key: { messageId },
            UpdateExpression: 'set #t = :txt, isRevoked = :rev, fileData = :f, fileType = :ft',
            ExpressionAttributeNames: { '#t': 'text' },
            ExpressionAttributeValues: {
                ':txt': 'Tin nhắn này đã bị thu hồi',
                ':rev': true,
                ':f': null,
                ':ft': null,
            },
        }).promise();

        io.emit('message_revoked', messageId);
    });

    socket.on('disconnect', () => {
        presenceStore.removeConnection(socket.id);
        emitOnlineUsers(io);
    });
};
