// backend/server.js

const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const AWS = require('aws-sdk');
require('dotenv').config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));

AWS.config.update({
  region: 'ap-southeast-2', 
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
});
const docClient = new AWS.DynamoDB.DocumentClient();

let onlineUsers = {}; 

// --- 1. ADMIN ANALYTICS ---
app.get('/api/admin/stats', async (req, res) => {
  try {
    const users = await docClient.scan({ TableName: 'Users' }).promise();
    const messages = await docClient.scan({ TableName: 'Messages' }).promise();
    const groups = await docClient.scan({ TableName: 'Groups' }).promise();
    const groupDict = { 'chung': 'Kênh Chung' };
    groups.Items.forEach(g => groupDict[g.groupId] = g.groupName);
    const statsMap = {};
    messages.Items.forEach(m => {
      const rId = m.roomId || 'chung';
      if (groupDict[rId] || rId.startsWith('dm_')) {
          const rName = groupDict[rId] || 'Chat Riêng';
          statsMap[rName] = (statsMap[rName] || 0) + 1;
      }
    });
    const chartData = Object.keys(statsMap).map(name => ({ name, value: statsMap[name] }));
    const userActivity = {};
    messages.Items.forEach(m => { userActivity[m.senderUsername] = (userActivity[m.senderUsername] || 0) + 1; });
    const topUsers = Object.keys(userActivity).map(username => {
        const uInfo = users.Items.find(u => u.username === username);
        return { name: uInfo ? uInfo.displayName : username, count: userActivity[username] };
    }).sort((a, b) => b.count - a.count).slice(0, 5);
    res.json({ totalUsers: users.Count, totalMessages: messages.Count, onlineNow: Object.keys(onlineUsers).length, totalGroups: groups.Count, chartData, topUsers });
  } catch (err) { res.status(500).json(err); }
});

// --- 2. QUẢN LÝ NHÓM ---
app.get('/api/groups/all', async (req, res) => {
  const data = await docClient.scan({ TableName: 'Groups' }).promise();
  res.json(data.Items);
});

app.post('/api/groups/create', async (req, res) => {
  const { groupName, owner, isPublic } = req.body;
  const groupId = "group_" + Date.now();
  const item = { groupId, groupName, owner, isPublic: isPublic || false, isDisabled: false, members: isPublic ? [] : [owner], pendingRequests: [], createdAt: new Date().toISOString() };
  await docClient.put({ TableName: 'Groups', Item: item }).promise();
  io.emit('groups_updated');
  res.json(item);
});

app.post('/api/groups/request', async (req, res) => {
  const { groupId, username } = req.body;
  const group = await docClient.get({ TableName: 'Groups', Key: { groupId } }).promise();
  let pending = group.Item.pendingRequests || [];
  if (!pending.includes(username)) pending.push(username);
  await docClient.update({ TableName: 'Groups', Key: { groupId }, UpdateExpression: "set pendingRequests = :p", ExpressionAttributeValues: { ":p": pending } }).promise();
  io.emit('groups_updated');
  res.json({ success: true });
});

app.post('/api/groups/approve', async (req, res) => {
  const { groupId, targetUsername, action } = req.body;
  const data = await docClient.get({ TableName: 'Groups', Key: { groupId } }).promise();
  let { members, pendingRequests } = data.Item;
  
  // Xóa khỏi danh sách chờ
  pendingRequests = pendingRequests.filter(u => u !== targetUsername);
  
  if (action === 'accept') {
    if (!members.includes(targetUsername)) members.push(targetUsername);
  }
  
  await docClient.update({ 
    TableName: 'Groups', 
    Key: { groupId }, 
    UpdateExpression: "set members = :m, pendingRequests = :p", 
    ExpressionAttributeValues: { ":m": members, ":p": pendingRequests } 
  }).promise();
  
  io.emit('groups_updated'); 
  res.json({ success: true });
});

app.post('/api/groups/manage', async (req, res) => {
  const { groupId, action } = req.body; 
  if (action === 'delete') await docClient.delete({ TableName: 'Groups', Key: { groupId } }).promise();
  else {
    const group = await docClient.get({ TableName: 'Groups', Key: { groupId } }).promise();
    await docClient.update({ TableName: 'Groups', Key: { groupId }, UpdateExpression: "set isDisabled = :s", ExpressionAttributeValues: { ":s": !group.Item.isDisabled } }).promise();
  }
  io.emit('groups_updated');
  res.json({ success: true });
});

app.post('/api/groups/remove-member', async (req, res) => {
  const { groupId, targetUsername } = req.body;
  const data = await docClient.get({ TableName: 'Groups', Key: { groupId } }).promise();
  let members = (data.Item.members || []).filter(u => u !== targetUsername);
  await docClient.update({ TableName: 'Groups', Key: { groupId }, UpdateExpression: "set members = :m", ExpressionAttributeValues: { ":m": members } }).promise();
  io.emit('groups_updated');
  res.json({ success: true });
});

// --- 3. HỆ THỐNG BẠN BÈ ---
// app.post('/api/friends/request', async (req, res) => {
//   const { fromUser, toUser } = req.body;
//   const target = await docClient.get({ TableName: 'Users', Key: { username: toUser } }).promise();
//   if(!target.Item) return res.status(404).send("User not found");
//   let requests = target.Item.friendRequests || [];
//   if (!requests.includes(fromUser)) requests.push(fromUser);
//   await docClient.update({ TableName: 'Users', Key: { username: toUser }, UpdateExpression: "set friendRequests = :r", ExpressionAttributeValues: { ":r": requests } }).promise();
//   io.emit('groups_updated');
//   res.json({ success: true });
// });

app.post('/api/friends/accept', async (req, res) => {
  const { me, friendUname } = req.body;
  const myData = await docClient.get({ TableName: 'Users', Key: { username: me } }).promise();
  let myF = myData.Item.friends || [];
  let myR = (myData.Item.friendRequests || []).filter(u => u !== friendUname);
  if(!myF.includes(friendUname)) myF.push(friendUname);
  await docClient.update({ TableName: 'Users', Key: { username: me }, UpdateExpression: "set friends = :f, friendRequests = :r", ExpressionAttributeValues: { ":f": myF, ":r": myR } }).promise();
  const fData = await docClient.get({ TableName: 'Users', Key: { username: friendUname } }).promise();
  let fF = fData.Item.friends || [];
  if(!fF.includes(me)) fF.push(me);
  await docClient.update({ TableName: 'Users', Key: { username: friendUname }, UpdateExpression: "set friends = :f", ExpressionAttributeValues: { ":f": fF } }).promise();
  io.emit('groups_updated');
  res.json({ success: true });
});

app.post('/api/friends/unfriend', async (req, res) => {
    const { me, friendUname } = req.body;
    try {
        const myData = await docClient.get({ TableName: 'Users', Key: { username: me } }).promise();
        let myF = (myData.Item.friends || []).filter(u => u !== friendUname);
        await docClient.update({ TableName: 'Users', Key: { username: me }, UpdateExpression: "set friends = :f", ExpressionAttributeValues: { ":f": myF } }).promise();
        const fData = await docClient.get({ TableName: 'Users', Key: { username: friendUname } }).promise();
        let fF = (fData.Item.friends || []).filter(u => u !== me);
        await docClient.update({ TableName: 'Users', Key: { username: friendUname }, UpdateExpression: "set friends = :f", ExpressionAttributeValues: { ":f": fF } }).promise();
        io.emit('groups_updated'); 
        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

// --- 4. PROFILE ---
app.get('/api/users/:username', async (req, res) => {
  const data = await docClient.get({ TableName: 'Users', Key: { username: req.params.username } }).promise();
  if (data.Item) { const { password, ...safe } = data.Item; res.json(safe); }
  else res.status(404).send("Not found");
});

app.post('/api/users/update', async (req, res) => {
  const { username, displayName, bio, phone, address, avatar } = req.body;
  // CHẶN SỬA EMAIL (Bỏ field email khỏi UpdateExpression)
  const params = { 
    TableName: 'Users', Key: { username }, 
    UpdateExpression: "set displayName = :d, bio = :b, phone = :p, address = :a, avatar = :av", 
    ExpressionAttributeValues: { ":d": displayName, ":b": bio||"", ":p": phone||"", ":a": address||"", ":av": avatar||null }, 
    ReturnValues: "ALL_NEW" 
  };
  const data = await docClient.update(params).promise();
  res.json(data.Attributes);
});

app.get('/api/messages/:username', async (req, res) => {
  const data = await docClient.scan({ TableName: 'Messages' }).promise();
  res.json(data.Items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
});

// Thêm API này vào server.js (trước đoạn socket)
app.post('/api/messages/delete-for-me', async (req, res) => {
  const { username, messageId } = req.body;
  try {
    const userData = await docClient.get({ TableName: 'Users', Key: { username } }).promise();
    let deletedMsgs = userData.Item.deletedMessages || [];
    
    if (!deletedMsgs.includes(messageId)) {
      deletedMsgs.push(messageId);
    }

    await docClient.update({
      TableName: 'Users',
      Key: { username },
      UpdateExpression: "set deletedMessages = :d",
      ExpressionAttributeValues: { ":d": deletedMsgs }
    }).promise();

    res.json({ success: true });
  } catch (err) { res.status(500).json(err); }
});

// Và API xóa toàn bộ lịch sử (Clear chat)
app.post('/api/messages/clear-history', async (req, res) => {
    const { username, roomId } = req.body;
    try {
        // Lấy tất cả tin nhắn của phòng đó
        const allMsgs = await docClient.scan({ 
            TableName: 'Messages',
            FilterExpression: "roomId = :r",
            ExpressionAttributeValues: { ":r": roomId }
        }).promise();
        
        const msgIdsInRoom = allMsgs.Items.map(m => m.messageId);
        const userData = await docClient.get({ TableName: 'Users', Key: { username } }).promise();
        let deletedMsgs = userData.Item.deletedMessages || [];
        
        // Thêm tất cả ID tin nhắn trong phòng này vào danh sách đã xóa của User
        const newDeletedList = Array.from(new Set([...deletedMsgs, ...msgIdsInRoom]));

        await docClient.update({
            TableName: 'Users',
            Key: { username },
            UpdateExpression: "set deletedMessages = :d",
            ExpressionAttributeValues: { ":d": newDeletedList }
        }).promise();

        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

// --- 5. SOCKET REALTIME ---
// Tìm đoạn io.on('connection', ...) và sửa lại hàm user_online
io.on('connection', (socket) => {
  socket.on('user_online', (u) => { 
    if(u?.username){ 
      // Ghi đè thông tin mới nhất (avatar, displayName) vào danh sách online
      onlineUsers[u.username] = {...u, socketId: socket.id}; 
      io.emit('update_user_list', onlineUsers); 
    }
  });

  socket.on('admin_update_group', () => io.emit('groups_updated'));
  socket.on('send_message', async (d) => {
    const item = { messageId: Date.now().toString(), ...d, isRevoked: false, createdAt: new Date().toISOString() };
    await docClient.put({ TableName: 'Messages', Item: item }).promise();
    io.emit('receive_message', item);
  });
  
  socket.on('revoke_message', async (id) => {
    await docClient.update({ TableName: 'Messages', Key: { messageId: id }, UpdateExpression: "set #t = :txt, isRevoked = :rev, fileData = :f, fileType = :ft", ExpressionAttributeNames: { "#t": "text" }, ExpressionAttributeValues: { ":txt": "Tin nhắn này đã bị thu hồi", ":rev": true, ":f": null, ":ft": null } }).promise();
    io.emit('message_revoked', id);
  });
  
  socket.on('disconnect', () => {
    for(let u in onlineUsers) if(onlineUsers[u].socketId === socket.id){ delete onlineUsers[u]; break; }
    io.emit('update_user_list', onlineUsers);
  });
});

const authRoutes = require('./routes/authRoutes');
app.use('/api/auth', authRoutes);
httpServer.listen(3001, () => console.log(`🚀 OTT Server v5 Online`));

// Đổi mật khẩu
const authController = require('./controllers/authController'); 
app.post('/api/users/change-password', authController.changePassword);

// API lưu kho thẻ và dữ liệu gán thẻ
app.post('/api/users/sync-tags', async (req, res) => {
    const { username, availableTags, friendTags } = req.body;
    try {
        await docClient.update({
            TableName: 'Users',
            Key: { username },
            UpdateExpression: "set availableTags = :at, friendTags = :ft",
            ExpressionAttributeValues: {
                ":at": availableTags,
                ":ft": friendTags
            },
            ReturnValues: "ALL_NEW"
        }).promise();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json(err);
    }
});

app.post('/api/friends/request', async (req, res) => {
    const { fromUser, toUser } = req.body;
    try {
        // 1. Ghi vào friendRequests của người NHẬN
        const target = await docClient.get({ TableName: 'Users', Key: { username: toUser } }).promise();
        let requests = target.Item.friendRequests || [];
        if (!requests.includes(fromUser)) requests.push(fromUser);
        await docClient.update({
            TableName: 'Users', Key: { username: toUser },
            UpdateExpression: "set friendRequests = :r",
            ExpressionAttributeValues: { ":r": requests }
        }).promise();

        // 2. Ghi vào sentRequests của người GỬI (Field này DB bạn đang thiếu nè)
        const me = await docClient.get({ TableName: 'Users', Key: { username: fromUser } }).promise();
        let sent = me.Item.sentRequests || [];
        if (!sent.includes(toUser)) sent.push(toUser);
        await docClient.update({
            TableName: 'Users', Key: { username: fromUser },
            UpdateExpression: "set sentRequests = :s",
            ExpressionAttributeValues: { ":s": sent }
        }).promise();

        io.emit('groups_updated');
        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
});

// --- API TÌM KIẾM NHÂN TỐ MỚI ---
app.get('/api/users/search', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);

    try {
        // Quét toàn bộ bảng Users (Vì DynamoDB scan khá tốn tài nguyên nên thực tế sau này Hiền nên dùng Index nhé)
        const data = await docClient.scan({ TableName: 'Users' }).promise();
        
        // Lọc người dùng có username hoặc displayName chứa từ khóa q
        const results = data.Items.filter(u => 
            u.username.toLowerCase().includes(q.toLowerCase()) || 
            (u.displayName && u.displayName.toLowerCase().includes(q.toLowerCase()))
        ).map(({ password, ...safe }) => safe); // Bảo mật: Không trả mật khẩu về client

        res.json(results);
    } catch (err) {
        console.error("Lỗi search:", err);
        res.status(500).json(err);
    }
});