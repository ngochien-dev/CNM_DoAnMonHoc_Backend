const docClient = require('../awsConfig');
const { GetCommand, UpdateCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const getUser = async (req, res) => {
  try {
    const data = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: req.params.username } }));
    if (data.Item) {
      const { password, ...safe } = data.Item;
      res.json(safe);
    } else {
      res.status(404).send("Not found");
    }
  } catch (err) {
    res.status(500).json(err);
  }
};

const updateUser = async (req, res) => {
  try {
    const { username, displayName, bio, phone, address, avatar } = req.body;
    const params = {
      TableName: 'Users',
      Key: { username },
      UpdateExpression: "set displayName = :d, bio = :b, phone = :p, address = :a, avatar = :av",
      ExpressionAttributeValues: {
        ":d": displayName,
        ":b": bio || "",
        ":p": phone || "",
        ":a": address || "",
        ":av": avatar || null
      },
      ReturnValues: "ALL_NEW"
    };
    const data = await docClient.send(new UpdateCommand(params));
    res.json(data.Attributes);
  } catch (err) {
    res.status(500).json(err);
  }
};

const syncTags = async (req, res) => {
  try {
    const { username, availableTags, friendTags } = req.body;
    const params = {
      TableName: 'Users',
      Key: { username },
      UpdateExpression: "set availableTags = :at, friendTags = :ft",
      ExpressionAttributeValues: {
        ":at": availableTags || ["All"],
        ":ft": friendTags || {}
      },
      ReturnValues: "UPDATED_NEW"
    };
    const data = await docClient.send(new UpdateCommand(params));
    res.json(data.Attributes);
  } catch (err) {
    res.status(500).json(err);
  }
};

const togglePinRoom = async (req, res) => {
  try {
    const { username, roomId, action } = req.body; // action: 'pin' or 'unpin'
    const userData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username } }));
    if (!userData.Item) return res.status(404).send("User not found");

    let pinnedRooms = userData.Item.pinnedRooms || [];
    if (action === 'pin' && !pinnedRooms.includes(roomId)) {
      pinnedRooms.push(roomId);
    } else if (action === 'unpin') {
      pinnedRooms = pinnedRooms.filter(id => id !== roomId);
    }

    await docClient.send(new UpdateCommand({
      TableName: 'Users',
      Key: { username },
      UpdateExpression: "set pinnedRooms = :p",
      ExpressionAttributeValues: { ":p": pinnedRooms }
    }));

    res.json({ success: true, pinnedRooms });
  } catch (err) {
    res.status(500).json(err);
  }
};

const toggleArchiveRoom = async (req, res) => {
  try {
    const { username, roomId, action } = req.body; // action: 'archive' or 'unarchive'
    const userData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username } }));
    if (!userData.Item) return res.status(404).send("User not found");

    let archivedRooms = userData.Item.archivedRooms || [];
    if (action === 'archive' && !archivedRooms.includes(roomId)) {
      archivedRooms.push(roomId);
    } else if (action === 'unarchive') {
      archivedRooms = archivedRooms.filter(id => id !== roomId);
    }

    await docClient.send(new UpdateCommand({
      TableName: 'Users',
      Key: { username },
      UpdateExpression: "set archivedRooms = :p",
      ExpressionAttributeValues: { ":p": archivedRooms }
    }));

    res.json({ success: true, archivedRooms });
  } catch (err) {
    res.status(500).json(err);
  }
};

const toggle2FA = async (req, res) => {
  try {
    const { username, enabled } = req.body;
    await docClient.send(new UpdateCommand({
      TableName: 'Users',
      Key: { username },
      UpdateExpression: "set is2FAEnabled = :e",
      ExpressionAttributeValues: { ":e": enabled }
    }));
    res.json({ success: true, is2FAEnabled: enabled });
  } catch (err) {
    res.status(500).json(err);
  }
};

const updateE2EEKey = async (req, res) => {
  try {
    const { username, e2eePublicKey } = req.body;
    await docClient.send(new UpdateCommand({
      TableName: 'Users',
      Key: { username },
      UpdateExpression: "set e2eePublicKey = :k",
      ExpressionAttributeValues: { ":k": e2eePublicKey }
    }));
    res.json({ success: true, e2eePublicKey });
  } catch (err) {
    res.status(500).json(err);
  }
};

const getActiveSessions = async (req, res) => {
  try {
    const targetUser = req.auth?.username || req.body.username;
    if (!targetUser) return res.status(400).json({ message: "Thiếu tên người dùng" });

    const data = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: targetUser } }));
    if (data.Item) {
      res.json(data.Item.activeSessions || []);
    } else {
      res.status(404).send("Not found");
    }
  } catch (err) {
    res.status(500).json(err);
  }
};

const terminateSession = async (req, res) => {
  try {
    const { username, sessionId } = req.body;
    const targetUser = req.auth?.username || username;
    if (!targetUser || !sessionId) return res.status(400).json({ message: "Thiếu tham số bắt buộc" });

    const userData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: targetUser } }));
    if (!userData.Item) return res.status(404).send("User not found");

    const activeSessions = userData.Item.activeSessions || [];
    const updatedSessions = activeSessions.filter(s => s.sessionId !== sessionId);

    await docClient.send(new UpdateCommand({
      TableName: 'Users',
      Key: { username: targetUser },
      UpdateExpression: "set activeSessions = :s",
      ExpressionAttributeValues: { ":s": updatedSessions }
    }));

    // Gửi sự kiện Socket Force Logout nếu io tồn tại
    const io = req.app.get('io');
    if (io) {
      const sockets = await io.in(`user:${targetUser}`).fetchSockets();
      for (const s of sockets) {
        if (s.sessionId === sessionId) {
          s.emit('force_logout', { username: targetUser, reason: 'remote_logout', sessionId });
          s.disconnect();
        }
      }
    }

    res.json({ success: true, activeSessions: updatedSessions });
  } catch (err) {
    res.status(500).json(err);
  }
};

const getLeaderboard = async (req, res) => {
  try {
    const { gameId = 'snake' } = req.query; // snake or flappy
    const scoreField = `score_${gameId}`;
    const data = await docClient.send(new ScanCommand({ TableName: 'Users' }));
    let users = data.Items || [];
    users = users.filter(u => u[scoreField] > 0);
    users.sort((a, b) => b[scoreField] - a[scoreField]);
    const top10 = users.slice(0, 10).map(u => ({ username: u.username, displayName: u.displayName, score: u[scoreField], avatar: u.avatar }));
    res.json(top10);
  } catch (err) {
    res.status(500).json(err);
  }
};

const updateScore = async (req, res) => {
  try {
    const { username, score, gameId = 'snake' } = req.body;
    if (!username || score == null) return res.status(400).send("Invalid input");

    const scoreField = `score_${gameId}`;
    const userData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username } }));
    if (!userData.Item) return res.status(404).send("User not found");

    const currentHigh = userData.Item[scoreField] || 0;
    if (score > currentHigh) {
      await docClient.send(new UpdateCommand({
        TableName: 'Users',
        Key: { username },
        UpdateExpression: `set ${scoreField} = :s`,
        ExpressionAttributeValues: { ":s": score }
      }));
      const io = req.app.get('io');
      if (io) io.emit('leaderboard_updated', { gameId });
      return res.json({ success: true, isNewHigh: true, newHighScore: score });
    }
    
    res.json({ success: true, isNewHigh: false, currentHighScore: currentHigh });
  } catch (err) {
    res.status(500).json(err);
  }
};

const getSuggestions = async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).send("Username is required");

    const userData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username } }));
    if (!userData.Item) return res.status(404).send("User not found");

    const friends = userData.Item.friends || [];
    const friendRequests = userData.Item.friendRequests || [];
    const sentRequests = userData.Item.sentRequests || [];
    const blockedUsers = userData.Item.blockedUsers || [];

    const allUsersData = await docClient.send(new ScanCommand({ TableName: 'Users' }));
    const allUsers = allUsersData.Items || [];

    const suggestions = allUsers.filter(u => {
      if (u.username === username) return false;
      const uFriends = u.friends || [];
      const uBlocked = u.blockedUsers || [];
      if (friends.includes(u.username)) return false;
      if (friendRequests.includes(u.username)) return false;
      if (sentRequests.includes(u.username)) return false;
      if (blockedUsers.includes(u.username)) return false;
      if (uBlocked.includes(username)) return false;
      return true;
    });

    const shuffled = suggestions.sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 5).map(u => ({
      username: u.username,
      displayName: u.displayName || u.username,
      avatar: u.avatar
    }));

    res.json(selected);
  } catch (err) {
    console.error("Suggestions error:", err);
    res.status(500).json(err);
  }
};

module.exports = {
  getUser,
  updateUser,
  syncTags,
  togglePinRoom,
  toggleArchiveRoom,
  toggle2FA,
  updateE2EEKey,
  getActiveSessions,
  terminateSession,
  getLeaderboard,
  updateScore,
  getSuggestions
};

