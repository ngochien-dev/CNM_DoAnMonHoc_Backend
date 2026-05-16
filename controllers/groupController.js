const docClient = require('../awsConfig');
const { ScanCommand, GetCommand, PutCommand, UpdateCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");

const getAllGroups = async (req, res) => {
  try {
    const data = await docClient.send(new ScanCommand({ TableName: 'Groups' }));
    res.json(data.Items || []);
  } catch (err) {
    res.status(500).json(err);
  }
};

const createGroup = async (req, res) => {
  try {
    const { groupName, owner, isPublic, isChannel } = req.body;
    const groupId = "group_" + Date.now();

    const item = {
      groupId,
      groupName,
      owner,
      isPublic: isPublic || false,
      isChannel: isChannel || false,
      isDisabled: false,
      members: isPublic ? [] : [owner],
      pendingRequests: [],
      mods: [], // Thêm mảng chứa MOD
      createdAt: new Date().toISOString()
    };

    await docClient.send(new PutCommand({ TableName: 'Groups', Item: item }));

    req.app.get('io').emit('groups_updated');
    res.json(item);
  } catch (err) {
    res.status(500).json(err);
  }
};

const requestJoin = async (req, res) => {
  try {
    const { groupId, username } = req.body;

    const group = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!group.Item) return res.status(404).json({ error: "Group not found" });

    if (group.Item.isPublic) {
      let members = group.Item.members || [];
      if (!members.includes(username)) {
        members.push(username);
      }
      await docClient.send(new UpdateCommand({
        TableName: 'Groups',
        Key: { groupId },
        UpdateExpression: "set members = :m",
        ExpressionAttributeValues: { ":m": members }
      }));
      req.app.get('io').emit('groups_updated');
      return res.json({ success: true, joined: true });
    }

    let pending = group.Item.pendingRequests || [];
    if (!pending.includes(username)) {
      pending.push(username);
    }

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set pendingRequests = :p",
      ExpressionAttributeValues: { ":p": pending }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true, joined: false });
  } catch (err) {
    res.status(500).json(err);
  }
};

const approveJoin = async (req, res) => {
  try {
    const { groupId, targetUsername, action } = req.body;

    const data = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!data.Item) return res.status(404).json({ error: "Group not found" });

    let { members = [], pendingRequests = [] } = data.Item;

    pendingRequests = pendingRequests.filter(u => u !== targetUsername);

    if (action === 'accept') {
      if (!members.includes(targetUsername)) {
        members.push(targetUsername);
      }
    }

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set members = :m, pendingRequests = :p",
      ExpressionAttributeValues: {
        ":m": members,
        ":p": pendingRequests
      }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(err);
  }
};

const manageGroup = async (req, res) => {
  try {
    const { groupId, action } = req.body;
    const callerUsername = req.auth.username;

    if (action === 'delete') {
      // Only owner can delete
      const group = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
      if (!group.Item) return res.status(404).json({ error: "Group not found" });
      if (group.Item.owner !== callerUsername) return res.status(403).json({ error: "Chỉ chủ nhóm mới có thể giải tán!" });
      await docClient.send(new DeleteCommand({ TableName: 'Groups', Key: { groupId } }));
    } else {
      const group = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
      if (!group.Item) return res.status(404).json({ error: "Group not found" });
      // Only owner can toggle disable
      if (group.Item.owner !== callerUsername) return res.status(403).json({ error: "Chỉ chủ nhóm mới có thể khóa/mở nhóm!" });

      await docClient.send(new UpdateCommand({
        TableName: 'Groups',
        Key: { groupId },
        UpdateExpression: "set isDisabled = :s",
        ExpressionAttributeValues: { ":s": !group.Item.isDisabled }
      }));
    }

    req.app.get('io').emit('groups_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(err);
  }
};

const removeMember = async (req, res) => {
  try {
    const { groupId, targetUsername } = req.body;
    const callerUsername = req.auth.username;

    const data = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!data.Item) return res.status(404).json({ error: "Group not found" });

    const isOwner = data.Item.owner === callerUsername;
    const isMod = (data.Item.mods || []).includes(callerUsername);
    const isSelf = callerUsername === targetUsername; // Allow leaving

    // Must be owner, mod, or leaving yourself
    if (!isOwner && !isMod && !isSelf) return res.status(403).json({ error: "Bạn không có quyền kick thành viên!" });
    // Mod cannot kick owner or other mods
    if (isMod && !isOwner) {
      if (targetUsername === data.Item.owner || (data.Item.mods || []).includes(targetUsername)) {
        return res.status(403).json({ error: "Mod không thể kick chủ nhóm hoặc mod khác!" });
      }
    }

    let members = (data.Item.members || []).filter(u => u !== targetUsername);

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set members = :m",
      ExpressionAttributeValues: { ":m": members }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(err);
  }
};

const updateRole = async (req, res) => {
  try {
    const { groupId, targetUsername, action } = req.body;
    const callerUsername = req.auth.username;
    // action: 'grant' or 'revoke'
    const data = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!data.Item) return res.status(404).json({ error: "Group not found" });

    // Only owner can grant/revoke mod
    if (data.Item.owner !== callerUsername) return res.status(403).json({ error: "Chỉ chủ nhóm mới có thể phân quyền!" });

    let mods = data.Item.mods || [];
    if (action === 'grant') {
        if (!mods.includes(targetUsername)) mods.push(targetUsername);
    } else if (action === 'revoke') {
        mods = mods.filter(u => u !== targetUsername);
    }

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set mods = :m",
      ExpressionAttributeValues: { ":m": mods }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(err);
  }
};

const renameGroup = async (req, res) => {
  try {
    const { groupId, newName } = req.body;
    const callerUsername = req.auth.username;
    if (!newName?.trim()) return res.status(400).json({ error: "Tên nhóm không được để trống!" });

    const data = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!data.Item) return res.status(404).json({ error: "Group not found" });

    const isOwner = data.Item.owner === callerUsername;
    const isMod = (data.Item.mods || []).includes(callerUsername);
    if (!isOwner && !isMod) return res.status(403).json({ error: "Bạn không có quyền đổi tên nhóm!" });

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set groupName = :n",
      ExpressionAttributeValues: { ":n": newName.trim() }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(err);
  }
};

const transferOwnership = async (req, res) => {
  try {
    const { groupId, newOwner } = req.body;
    const callerUsername = req.auth.username;

    const data = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!data.Item) return res.status(404).json({ error: "Group not found" });
    if (data.Item.owner !== callerUsername) return res.status(403).json({ error: "Chỉ chủ nhóm mới có thể chuyển quyền!" });
    if (!(data.Item.members || []).includes(newOwner)) return res.status(400).json({ error: "Người nhận phải là thành viên của nhóm!" });

    // Transfer: set new owner, remove new owner from mods if they were one
    let mods = (data.Item.mods || []).filter(u => u !== newOwner);

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set #o = :no, mods = :m",
      ExpressionAttributeNames: { "#o": "owner" },
      ExpressionAttributeValues: { ":no": newOwner, ":m": mods }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(err);
  }
};

// P1: Invite user directly to group (owner/mod only)
const inviteToGroup = async (req, res) => {
  try {
    const { groupId, targetUsername } = req.body;
    const callerUsername = req.auth.username;

    const data = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!data.Item) return res.status(404).json({ error: "Group not found" });

    const isOwner = data.Item.owner === callerUsername;
    const isMod = (data.Item.mods || []).includes(callerUsername);
    if (!isOwner && !isMod) return res.status(403).json({ error: "Chỉ chủ nhóm hoặc MOD mới có thể mời thành viên!" });

    // Check if target user exists
    const targetData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: targetUsername } }));
    if (!targetData.Item) return res.status(404).json({ error: "Người dùng không tồn tại!" });

    let members = data.Item.members || [];
    if (members.includes(targetUsername)) {
      return res.status(400).json({ error: "Người dùng đã là thành viên!" });
    }

    members.push(targetUsername);
    // Also remove from pending if they had a pending request
    let pending = (data.Item.pendingRequests || []).filter(u => u !== targetUsername);

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set members = :m, pendingRequests = :p",
      ExpressionAttributeValues: { ":m": members, ":p": pending }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(err);
  }
};

module.exports = {
  getAllGroups,
  createGroup,
  requestJoin,
  approveJoin,
  manageGroup,
  removeMember,
  updateRole,
  renameGroup,
  transferOwnership,
  inviteToGroup
};
