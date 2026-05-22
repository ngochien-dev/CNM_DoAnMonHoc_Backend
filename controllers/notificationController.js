/**
 * notificationController.js
 * Quản lý FCM tokens và notification settings của user.
 */

const docClient = require('../awsConfig');
const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const MAX_TOKENS_PER_USER = 10; // Giới hạn tokens mỗi user (đa thiết bị)

// ─── FCM Token Management ─────────────────────────────────────────────────────

/**
 * Lưu FCM token mới cho user (khi đăng nhập / mở app).
 * Hỗ trợ đa thiết bị — lưu array tokens, tránh trùng lặp.
 */
const saveFcmToken = async (req, res) => {
    try {
        const username = req.auth?.username;
        const { token } = req.body;

        if (!username) return res.status(401).json({ message: 'Unauthorized' });
        if (!token || typeof token !== 'string' || token.length < 10) {
            return res.status(400).json({ message: 'FCM token không hợp lệ' });
        }

        // Lấy tokens hiện tại
        const data = await docClient.send(new GetCommand({
            TableName: 'Users',
            Key: { username },
            ProjectionExpression: 'fcmTokens',
        }));

        let tokens = data.Item?.fcmTokens || [];

        // Tránh trùng lặp
        if (!tokens.includes(token)) {
            tokens.push(token);
        }

        // Giữ tối đa MAX_TOKENS_PER_USER tokens mới nhất
        if (tokens.length > MAX_TOKENS_PER_USER) {
            tokens = tokens.slice(-MAX_TOKENS_PER_USER);
        }

        await docClient.send(new UpdateCommand({
            TableName: 'Users',
            Key: { username },
            UpdateExpression: 'set fcmTokens = :t',
            ExpressionAttributeValues: { ':t': tokens },
        }));

        res.json({ success: true, tokenCount: tokens.length });
    } catch (err) {
        console.error('[Notification] saveFcmToken error:', err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

/**
 * Xóa FCM token khi user logout hoặc revoke notification.
 */
const removeFcmToken = async (req, res) => {
    try {
        const username = req.auth?.username;
        const { token } = req.body;

        if (!username) return res.status(401).json({ message: 'Unauthorized' });
        if (!token) return res.status(400).json({ message: 'Thiếu token' });

        const data = await docClient.send(new GetCommand({
            TableName: 'Users',
            Key: { username },
            ProjectionExpression: 'fcmTokens',
        }));

        const tokens = (data.Item?.fcmTokens || []).filter(t => t !== token);

        await docClient.send(new UpdateCommand({
            TableName: 'Users',
            Key: { username },
            UpdateExpression: 'set fcmTokens = :t',
            ExpressionAttributeValues: { ':t': tokens },
        }));

        res.json({ success: true });
    } catch (err) {
        console.error('[Notification] removeFcmToken error:', err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

// ─── Notification Settings ────────────────────────────────────────────────────

/**
 * Lấy cài đặt notification của user.
 */
const getNotificationSettings = async (req, res) => {
    try {
        const username = req.auth?.username;
        if (!username) return res.status(401).json({ message: 'Unauthorized' });

        const data = await docClient.send(new GetCommand({
            TableName: 'Users',
            Key: { username },
            ProjectionExpression: 'notificationSettings',
        }));

        const settings = data.Item?.notificationSettings || {
            enabled: true,           // Bật/tắt tất cả push notifications
            messages: true,          // Thông báo tin nhắn mới
            friendRequests: true,    // Thông báo lời mời kết bạn
            mentions: true,          // Thông báo khi được @mention
            groupActivity: true,     // Thông báo hoạt động nhóm
            mutedRooms: [],          // Danh sách rooms đã mute push
        };

        res.json(settings);
    } catch (err) {
        console.error('[Notification] getNotificationSettings error:', err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

/**
 * Cập nhật cài đặt notification.
 */
const updateNotificationSettings = async (req, res) => {
    try {
        const username = req.auth?.username;
        const settings = req.body;

        if (!username) return res.status(401).json({ message: 'Unauthorized' });
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ message: 'Dữ liệu không hợp lệ' });
        }

        // Chỉ cho phép các fields hợp lệ
        const allowed = ['enabled', 'messages', 'friendRequests', 'mentions', 'groupActivity', 'mutedRooms'];
        const safeSettings = {};
        for (const key of allowed) {
            if (key in settings) safeSettings[key] = settings[key];
        }

        await docClient.send(new UpdateCommand({
            TableName: 'Users',
            Key: { username },
            UpdateExpression: 'set notificationSettings = :s',
            ExpressionAttributeValues: { ':s': safeSettings },
        }));

        res.json({ success: true, settings: safeSettings });
    } catch (err) {
        console.error('[Notification] updateNotificationSettings error:', err);
        res.status(500).json({ message: 'Lỗi server' });
    }
};

module.exports = {
    saveFcmToken,
    removeFcmToken,
    getNotificationSettings,
    updateNotificationSettings,
};
