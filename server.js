const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const AWS = require('aws-sdk');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const callRoutes = require('./routes/callRoutes');
const socketAuth = require('./middlewares/socketAuth');
const presenceStore = require('./store/presenceStore');
const registerChatSocket = require('./socket/chatSocket');
const registerCallSocket = require('./socket/callSocket');

const app = express();
const httpServer = createServer(app);

function parseOriginList(rawValue = '') {
    return String(rawValue || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
}

function isAllowedDevOrigin(origin = '') {
    return /^https?:\/\/((localhost|127\.0\.0\.1)|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?$/i.test(
        origin,
    );
}

const HOST = process.env.HOST || '0.0.0.0';
const FRONTEND_ORIGINS = parseOriginList(process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN);
const PORT = Number(process.env.PORT) || 3001;

function corsOrigin(origin, callback) {
    if (!origin || FRONTEND_ORIGINS.includes(origin) || isAllowedDevOrigin(origin)) {
        callback(null, true);
        return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS.`));
}

const corsOptions = {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true,
};

const io = new Server(httpServer, {
    cors: corsOptions,
});

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));

AWS.config.update({
    region: process.env.AWS_REGION || 'ap-southeast-2',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const docClient = new AWS.DynamoDB.DocumentClient();

app.get('/api/admin/stats', async (req, res) => {
    try {
        const users = await docClient.scan({ TableName: 'Users' }).promise();
        const messages = await docClient.scan({ TableName: 'Messages' }).promise();
        const groups = await docClient.scan({ TableName: 'Groups' }).promise();

        const groupDict = { chung: 'Kenh Chung' };
        groups.Items.forEach((group) => {
            groupDict[group.groupId] = group.groupName;
        });

        const statsMap = {};
        messages.Items.forEach((message) => {
            const roomId = message.roomId || 'chung';
            if (groupDict[roomId] || roomId.startsWith('dm_')) {
                const roomName = groupDict[roomId] || 'Chat Rieng';
                statsMap[roomName] = (statsMap[roomName] || 0) + 1;
            }
        });

        const chartData = Object.keys(statsMap).map((name) => ({ name, value: statsMap[name] }));
        const userActivity = {};
        messages.Items.forEach((message) => {
            userActivity[message.senderUsername] = (userActivity[message.senderUsername] || 0) + 1;
        });

        const topUsers = Object.keys(userActivity)
            .map((username) => {
                const userInfo = users.Items.find((item) => item.username === username);
                return {
                    name: userInfo ? userInfo.displayName : username,
                    count: userActivity[username],
                };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        res.json({
            totalUsers: users.Count,
            totalMessages: messages.Count,
            onlineNow: presenceStore.getOnlineCount(),
            totalGroups: groups.Count,
            chartData,
            topUsers,
        });
    } catch (error) {
        res.status(500).json(error);
    }
});

app.get('/api/groups/all', async (req, res) => {
    const data = await docClient.scan({ TableName: 'Groups' }).promise();
    res.json(data.Items);
});

app.post('/api/groups/create', async (req, res) => {
    const { groupName, owner, isPublic } = req.body;
    const groupId = `group_${Date.now()}`;
    const item = {
        groupId,
        groupName,
        owner,
        isPublic: isPublic || false,
        isDisabled: false,
        members: isPublic ? [] : [owner],
        pendingRequests: [],
        createdAt: new Date().toISOString(),
    };

    await docClient.put({ TableName: 'Groups', Item: item }).promise();
    io.emit('groups_updated');
    res.json(item);
});

app.post('/api/groups/request', async (req, res) => {
    const { groupId, username } = req.body;
    const group = await docClient.get({ TableName: 'Groups', Key: { groupId } }).promise();
    const pendingRequests = group.Item.pendingRequests || [];

    if (!pendingRequests.includes(username)) pendingRequests.push(username);

    await docClient.update({
        TableName: 'Groups',
        Key: { groupId },
        UpdateExpression: 'set pendingRequests = :pendingRequests',
        ExpressionAttributeValues: {
            ':pendingRequests': pendingRequests,
        },
    }).promise();

    io.emit('groups_updated');
    res.json({ success: true });
});

app.post('/api/groups/approve', async (req, res) => {
    const { groupId, targetUsername, action } = req.body;
    const data = await docClient.get({ TableName: 'Groups', Key: { groupId } }).promise();
    let { members, pendingRequests } = data.Item;

    pendingRequests = pendingRequests.filter((username) => username !== targetUsername);
    if (action === 'accept' && !members.includes(targetUsername)) {
        members.push(targetUsername);
    }

    await docClient.update({
        TableName: 'Groups',
        Key: { groupId },
        UpdateExpression: 'set members = :members, pendingRequests = :pendingRequests',
        ExpressionAttributeValues: {
            ':members': members,
            ':pendingRequests': pendingRequests,
        },
    }).promise();

    io.emit('groups_updated');
    res.json({ success: true });
});

app.post('/api/groups/manage', async (req, res) => {
    const { groupId, action } = req.body;

    if (action === 'delete') {
        await docClient.delete({ TableName: 'Groups', Key: { groupId } }).promise();
    } else {
        const group = await docClient.get({ TableName: 'Groups', Key: { groupId } }).promise();
        await docClient.update({
            TableName: 'Groups',
            Key: { groupId },
            UpdateExpression: 'set isDisabled = :isDisabled',
            ExpressionAttributeValues: {
                ':isDisabled': !group.Item.isDisabled,
            },
        }).promise();
    }

    io.emit('groups_updated');
    res.json({ success: true });
});

app.post('/api/groups/remove-member', async (req, res) => {
    const { groupId, targetUsername } = req.body;
    const data = await docClient.get({ TableName: 'Groups', Key: { groupId } }).promise();
    const members = (data.Item.members || []).filter((username) => username !== targetUsername);

    await docClient.update({
        TableName: 'Groups',
        Key: { groupId },
        UpdateExpression: 'set members = :members',
        ExpressionAttributeValues: {
            ':members': members,
        },
    }).promise();

    io.emit('groups_updated');
    res.json({ success: true });
});

app.post('/api/friends/request', async (req, res) => {
    const { fromUser, toUser } = req.body;
    const target = await docClient.get({ TableName: 'Users', Key: { username: toUser } }).promise();

    if (!target.Item) return res.status(404).send('User not found');

    const requests = target.Item.friendRequests || [];
    if (!requests.includes(fromUser)) requests.push(fromUser);

    await docClient.update({
        TableName: 'Users',
        Key: { username: toUser },
        UpdateExpression: 'set friendRequests = :requests',
        ExpressionAttributeValues: {
            ':requests': requests,
        },
    }).promise();

    io.emit('groups_updated');
    res.json({ success: true });
});

app.post('/api/friends/accept', async (req, res) => {
    const { me, friendUname } = req.body;
    const myData = await docClient.get({ TableName: 'Users', Key: { username: me } }).promise();
    const myFriends = myData.Item.friends || [];
    const myRequests = (myData.Item.friendRequests || []).filter((username) => username !== friendUname);

    if (!myFriends.includes(friendUname)) myFriends.push(friendUname);

    await docClient.update({
        TableName: 'Users',
        Key: { username: me },
        UpdateExpression: 'set friends = :friends, friendRequests = :friendRequests',
        ExpressionAttributeValues: {
            ':friends': myFriends,
            ':friendRequests': myRequests,
        },
    }).promise();

    const friendData = await docClient.get({ TableName: 'Users', Key: { username: friendUname } }).promise();
    const friendFriends = friendData.Item.friends || [];
    if (!friendFriends.includes(me)) friendFriends.push(me);

    await docClient.update({
        TableName: 'Users',
        Key: { username: friendUname },
        UpdateExpression: 'set friends = :friends',
        ExpressionAttributeValues: {
            ':friends': friendFriends,
        },
    }).promise();

    io.emit('groups_updated');
    res.json({ success: true });
});

app.post('/api/friends/unfriend', async (req, res) => {
    const { me, friendUname } = req.body;
    try {
        const myData = await docClient.get({ TableName: 'Users', Key: { username: me } }).promise();
        const myFriends = (myData.Item.friends || []).filter((username) => username !== friendUname);

        await docClient.update({
            TableName: 'Users',
            Key: { username: me },
            UpdateExpression: 'set friends = :friends',
            ExpressionAttributeValues: {
                ':friends': myFriends,
            },
        }).promise();

        const friendData = await docClient.get({ TableName: 'Users', Key: { username: friendUname } }).promise();
        const friendFriends = (friendData.Item.friends || []).filter((username) => username !== me);

        await docClient.update({
            TableName: 'Users',
            Key: { username: friendUname },
            UpdateExpression: 'set friends = :friends',
            ExpressionAttributeValues: {
                ':friends': friendFriends,
            },
        }).promise();

        io.emit('groups_updated');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json(error);
    }
});

app.get('/api/users/:username', async (req, res) => {
    const data = await docClient.get({ TableName: 'Users', Key: { username: req.params.username } }).promise();
    if (data.Item) {
        const { password, ...safeUser } = data.Item;
        res.json(safeUser);
    } else {
        res.status(404).send('Not found');
    }
});

app.post('/api/users/update', async (req, res) => {
    const { username, displayName, email, bio, phone, address, avatar } = req.body;
    const params = {
        TableName: 'Users',
        Key: { username },
        UpdateExpression: 'set displayName = :displayName, email = :email, bio = :bio, phone = :phone, address = :address, avatar = :avatar',
        ExpressionAttributeValues: {
            ':displayName': displayName,
            ':email': email,
            ':bio': bio || '',
            ':phone': phone || '',
            ':address': address || '',
            ':avatar': avatar || null,
        },
        ReturnValues: 'ALL_NEW',
    };

    const data = await docClient.update(params).promise();
    res.json(data.Attributes);
});

app.get('/api/messages/:username', async (req, res) => {
    const data = await docClient.scan({ TableName: 'Messages' }).promise();
    res.json(data.Items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
});

app.use('/api/auth', authRoutes);
app.use('/api/calls', callRoutes);

io.use(socketAuth);
io.on('connection', (socket) => {
    presenceStore.registerConnection(socket.user, socket.id);
    socket.join(`user:${socket.user.username}`);
    io.emit('update_user_list', presenceStore.getOnlineUsers());

    registerChatSocket({ io, socket, docClient });
    registerCallSocket({ io, socket });
});

httpServer.listen(PORT, HOST, () => {
    console.log(`OTT Server v6 Online on http://${HOST}:${PORT}`);
});
