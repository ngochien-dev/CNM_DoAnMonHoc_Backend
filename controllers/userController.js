const docClient = require('../awsConfig');
const { GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

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

module.exports = {
  getUser,
  updateUser,
  syncTags,
  togglePinRoom,
  toggle2FA,
  updateE2EEKey,
  getActiveSessions,
  terminateSession
};
