/**
 * fcmService.js
 * Firebase Admin SDK service để gửi Push Notification qua FCM.
 * Hỗ trợ: gửi cho 1 user, gửi cho nhiều user, cleanup invalid tokens.
 */

const admin = require('firebase-admin');
const docClient = require('../awsConfig');
const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

// ─── Khởi tạo Firebase Admin (singleton) ─────────────────────────────────────

let _firebaseApp = null;

function getFirebaseApp() {
    if (_firebaseApp) return _firebaseApp;

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
        console.warn('[FCM] Firebase credentials không đầy đủ. Push notification bị tắt.');
        return null;
    }

    try {
        _firebaseApp = admin.initializeApp({
            credential: admin.credential.cert({
                projectId,
                clientEmail,
                privateKey,
            }),
        });
        console.log('[FCM] Firebase Admin initialized thành công.');
    } catch (err) {
        if (err.code === 'app/duplicate-app') {
            _firebaseApp = admin.app();
        } else {
            console.error('[FCM] Firebase Admin init error:', err.message);
            return null;
        }
    }

    return _firebaseApp;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Lấy danh sách FCM tokens của một user từ DynamoDB.
 * @param {string} username
 * @returns {Promise<string[]>}
 */
async function getUserFcmTokens(username) {
    try {
        const data = await docClient.send(new GetCommand({
            TableName: 'Users',
            Key: { username },
            ProjectionExpression: 'fcmTokens',
        }));
        return data.Item?.fcmTokens || [];
    } catch (err) {
        console.warn('[FCM] getUserFcmTokens error:', err.message);
        return [];
    }
}

/**
 * Xóa các tokens không còn hợp lệ khỏi DynamoDB.
 * @param {string} username
 * @param {string[]} invalidTokens
 */
async function removeInvalidTokens(username, invalidTokens) {
    if (!invalidTokens || invalidTokens.length === 0) return;
    try {
        const tokens = await getUserFcmTokens(username);
        const cleaned = tokens.filter(t => !invalidTokens.includes(t));
        await docClient.send(new UpdateCommand({
            TableName: 'Users',
            Key: { username },
            UpdateExpression: 'set fcmTokens = :t',
            ExpressionAttributeValues: { ':t': cleaned },
        }));
    } catch (err) {
        console.warn('[FCM] removeInvalidTokens error:', err.message);
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Gửi push notification cho một user.
 * @param {string} username - Tên user nhận notification
 * @param {object} notification - { title, body, icon? }
 * @param {object} data - Custom data payload (string values only)
 * @returns {Promise<boolean>} true nếu gửi thành công ít nhất 1 token
 */
async function sendPushToUser(username, notification, data = {}) {
    const app = getFirebaseApp();
    if (!app) return false;

    // Lấy tokens và settings
    let tokens = [];
    let settings = {
        enabled: true,
        messages: true,
        friendRequests: true,
        mutedRooms: []
    };

    try {
        const userData = await docClient.send(new GetCommand({
            TableName: 'Users',
            Key: { username },
            ProjectionExpression: 'fcmTokens, notificationSettings',
        }));
        tokens = userData.Item?.fcmTokens || [];
        if (userData.Item?.notificationSettings) {
            settings = { ...settings, ...userData.Item.notificationSettings };
        }
    } catch (err) {
        console.warn('[FCM] Lấy dữ liệu user thất bại:', err.message);
        return false;
    }

    if (tokens.length === 0) return false;

    // Kiểm tra cài đặt nhận thông báo
    if (settings.enabled === false) return false;
    if (data.type === 'message' && settings.messages === false) return false;
    if (data.type === 'friendRequest' && settings.friendRequests === false) return false;
    if (data.roomId && settings.mutedRooms && settings.mutedRooms.includes(data.roomId)) return false;

    // Đảm bảo tất cả data values đều là string (FCM requirement)
    const safeData = {};
    for (const [k, v] of Object.entries(data)) {
        safeData[k] = String(v ?? '');
    }

    const message = {
        notification: {
            title: notification.title || 'OTT Chat',
            body: notification.body || '',
        },
        data: safeData,
        webpush: {
            notification: {
                icon: notification.icon || '/favicon.svg',
                badge: '/favicon.svg',
                vibrate: [200, 100, 200],
                requireInteraction: false,
                tag: safeData.roomId || 'ott-notification',
            },
            fcmOptions: {
                link: '/',
            },
        },
        tokens,
    };

    try {
        const messaging = admin.messaging(app);
        const response = await messaging.sendEachForMulticast(message);

        // Xử lý invalid tokens
        const invalidTokens = [];
        response.responses.forEach((resp, idx) => {
            if (!resp.success) {
                const errCode = resp.error?.code;
                if (
                    errCode === 'messaging/registration-token-not-registered' ||
                    errCode === 'messaging/invalid-registration-token'
                ) {
                    invalidTokens.push(tokens[idx]);
                }
            }
        });

        if (invalidTokens.length > 0) {
            removeInvalidTokens(username, invalidTokens).catch(() => {});
        }

        const successCount = response.successCount;
        if (successCount > 0) {
            console.log(`[FCM] Gửi push cho ${username}: ${successCount}/${tokens.length} thiết bị thành công.`);
        }

        return successCount > 0;
    } catch (err) {
        console.error('[FCM] sendPushToUser error:', err.message);
        return false;
    }
}

/**
 * Gửi push notification cho nhiều user cùng lúc.
 * @param {string[]} usernames
 * @param {object} notification
 * @param {object} data
 */
async function sendPushToMultiple(usernames, notification, data = {}) {
    if (!usernames || usernames.length === 0) return;
    // Gửi song song
    await Promise.allSettled(
        usernames.map(username => sendPushToUser(username, notification, data))
    );
}

module.exports = {
    sendPushToUser,
    sendPushToMultiple,
    getUserFcmTokens,
};
