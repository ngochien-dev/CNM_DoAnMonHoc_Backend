const presenceStore = require('../store/presenceStore');
const { sanitizeSocketPayload, sanitizeString } = require('../middlewares/sanitize');
const CALL_DEBUG_ENABLED = process.env.CALL_DEBUG !== 'false';

// P0: Constants for validation
const MAX_TEXT_LENGTH = 5000;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

function emitOnlineUsers(io) {
    io.emit('update_user_list', presenceStore.getOnlineUsers());
}

function debugSocket(eventName, data = {}) {
    if (!CALL_DEBUG_ENABLED) return;
    console.log('[SOCKET]', eventName, data);
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
        debugSocket('user_online profile registered.', {
            username: socket.user.username,
            socketId: socket.id,
            connectionCount: presenceStore.getConnectionCount(socket.user.username),
            onlineBy: 'username',
            onlineUsersSize: presenceStore.getOnlineCount(),
            onlineUsernames: presenceStore.getOnlineUsernames(),
        });
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

    socket.on('edit_message', async ({ messageId, newText, iv }) => {
        if (!messageId || !newText?.trim()) return;

        // P0: Sanitize edited text
        const safeText = sanitizeString(newText.trim());
        if (safeText.length > MAX_TEXT_LENGTH) return;

        const { GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

        // Verify ownership: only sender can edit
        const msgData = await docClient.send(new GetCommand({ TableName: 'Messages', Key: { messageId } }));
        if (!msgData.Item) return;
        if (msgData.Item.senderUsername !== socket.user.username) return;
        if (msgData.Item.isRevoked) return; // Can't edit revoked messages

        const updateExpression = iv
            ? 'set #t = :txt, iv = :iv, isEdited = :ed, editedAt = :ea'
            : 'set #t = :txt, isEdited = :ed, editedAt = :ea';

        const expressionAttributeValues = {
            ':txt': safeText,
            ':ed': true,
            ':ea': new Date().toISOString(),
            ...(iv && { ':iv': iv })
        };

        await docClient.send(new UpdateCommand({
            TableName: 'Messages',
            Key: { messageId },
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: { '#t': 'text' },
            ExpressionAttributeValues: expressionAttributeValues,
        }));

        io.emit('message_edited', {
            messageId,
            newText: safeText,
            iv,
            isEdited: true,
            editedAt: new Date().toISOString()
        });
    });

    // P0: Read Receipts via Socket — lightweight real-time read notifications
    socket.on('message_read', async ({ messageIds, roomId }) => {
        if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) return;

        const username = socket.user.username;
        const idsToProcess = messageIds.slice(0, 20); // Limit batch size

        const { GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

        const updatedIds = [];
        for (const messageId of idsToProcess) {
            try {
                const msgData = await docClient.send(new GetCommand({ TableName: 'Messages', Key: { messageId } }));
                if (!msgData.Item) continue;

                let readBy = msgData.Item.readBy || [];
                if (readBy.includes(username)) continue; // Already read

                readBy.push(username);
                await docClient.send(new UpdateCommand({
                    TableName: 'Messages',
                    Key: { messageId },
                    UpdateExpression: "set readBy = :r",
                    ExpressionAttributeValues: { ":r": readBy }
                }));
                updatedIds.push({ messageId, readBy });
            } catch (e) {
                // Skip individual failures silently
            }
        }

        if (updatedIds.length > 0) {
            io.emit('messages_read_update', {
                reader: username,
                roomId,
                updates: updatedIds,
            });
        }
    });

    socket.on('typing_start', (payload) => {
        socket.broadcast.emit('user_typing_start', payload);
    });

    socket.on('typing_end', (payload) => {
        socket.broadcast.emit('user_typing_end', payload);
    });

    socket.on('request_secret_chat', ({ roomId, senderUsername }) => {
        socket.broadcast.emit('secret_chat_request', { roomId, requester: senderUsername });
    });

    socket.on('accept_secret_chat', ({ roomId, requester }) => {
        io.emit('secret_chat_established', { roomId });
    });

    socket.on('decline_secret_chat', ({ roomId, requester }) => {
        socket.broadcast.emit('secret_chat_declined', { roomId, decliner: socket.user.username });
    });

    socket.on('close_secret_chat', ({ roomId }) => {
        io.emit('secret_chat_closed', { roomId, sender: socket.user.username });
    });

    socket.on('disconnect', (reason) => {
        const removal = presenceStore.removeConnection(socket.id);
        debugSocket('User socket disconnected and presence updated.', {
            username: removal?.username || socket.user.username,
            socketId: socket.id,
            reason,
            stillOnline: Boolean(removal?.stillOnline),
            connectionCount: presenceStore.getConnectionCount(socket.user.username),
            onlineUsersSize: presenceStore.getOnlineCount(),
            onlineUsernames: presenceStore.getOnlineUsernames(),
        });
        emitOnlineUsers(io);
    });
};