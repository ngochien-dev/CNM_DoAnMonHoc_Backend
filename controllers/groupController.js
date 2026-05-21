const docClient = require('../awsConfig');
const { ScanCommand, GetCommand, PutCommand, UpdateCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");
const crypto = require('crypto');

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
    const { groupName, owner, isPublic, isChannel, members, description } = req.body;
    const groupId = "group_" + Date.now();

    const initialMembers = members && Array.isArray(members) 
      ? [...new Set([owner, ...members])] 
      : (isPublic ? [] : [owner]);

    const item = {
      groupId,
      groupName,
      description: description || "",
      owner,
      isPublic: isPublic || false,
      isChannel: isChannel || false,
      isDisabled: false,
      members: initialMembers,
      pendingRequests: [],
      mods: [], // Thêm mảng chứa MOD
      inviteToken: crypto.randomBytes(8).toString('hex'),
      inviteLinkEnabled: true,
      inviteApprovalRequired: false,
      linkApprovalRequired: false,
      mutedMembers: {},
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

// P1: Invite user directly to group
const inviteToGroup = async (req, res) => {
  try {
    const { groupId, targetUsername } = req.body;
    const callerUsername = req.auth.username;

    const data = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!data.Item) return res.status(404).json({ error: "Group not found" });

    const isOwner = data.Item.owner === callerUsername;
    const isMod = (data.Item.mods || []).includes(callerUsername);
    const isMember = (data.Item.members || []).includes(callerUsername);
    
    if (!isOwner && !isMod && !isMember) {
      return res.status(403).json({ error: "Bạn không có quyền mời thành viên vào nhóm này!" });
    }

    // Check if target user exists
    const targetData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: targetUsername } }));
    if (!targetData.Item) return res.status(404).json({ error: "Người dùng không tồn tại!" });

    let members = data.Item.members || [];
    if (members.includes(targetUsername)) {
      return res.status(400).json({ error: "Người dùng đã là thành viên!" });
    }

    const isApprovalReq = data.Item.inviteApprovalRequired || false;
    const needsApproval = !isOwner && !isMod && isApprovalReq;

    if (needsApproval) {
      let pending = data.Item.pendingRequests || [];
      if (!pending.includes(targetUsername)) {
        pending.push(targetUsername);
      }
      await docClient.send(new UpdateCommand({
        TableName: 'Groups',
        Key: { groupId },
        UpdateExpression: "set pendingRequests = :p",
        ExpressionAttributeValues: { ":p": pending }
      }));

      req.app.get('io').emit('groups_updated');
      return res.json({ success: true, joined: false });
    } else {
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
      return res.json({ success: true, joined: true });
    }
  } catch (err) {
    res.status(500).json(err);
  }
};

// Đổi ảnh đại diện nhóm
const updateGroupAvatar = async (req, res) => {
  try {
    const { groupId, avatar } = req.body;
    const callerUsername = req.auth.username;
    
    if (!avatar) return res.status(400).json({ error: "Ảnh đại diện không được để trống!" });

    const data = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!data.Item) return res.status(404).json({ error: "Group not found" });

    const isOwner = data.Item.owner === callerUsername;
    const isMod = (data.Item.mods || []).includes(callerUsername);
    if (!isOwner && !isMod) return res.status(403).json({ error: "Bạn không có quyền đổi ảnh đại diện nhóm!" });

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set avatar = :a",
      ExpressionAttributeValues: { ":a": avatar }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true, avatar });
  } catch (err) {
    res.status(500).json(err);
  }
};

const toggleInviteLink = async (req, res) => {
  try {
    const { groupId, enabled } = req.body;
    const callerUsername = req.auth.username;

    const group = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!group.Item) return res.status(404).json({ error: "Không tìm thấy nhóm!" });

    const isOwner = group.Item.owner === callerUsername;
    const isMod = (group.Item.mods || []).includes(callerUsername);
    if (!isOwner && !isMod) return res.status(403).json({ error: "Bạn không có quyền quản lý liên kết mời!" });

    let inviteToken = group.Item.inviteToken;
    if (!inviteToken) {
      inviteToken = crypto.randomBytes(8).toString('hex');
    }

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set inviteLinkEnabled = :e, inviteToken = :t",
      ExpressionAttributeValues: { 
        ":e": enabled,
        ":t": inviteToken
      }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true, inviteLinkEnabled: enabled, inviteToken });
  } catch (err) {
    res.status(500).json(err);
  }
};

const resetInviteLink = async (req, res) => {
  try {
    const { groupId } = req.body;
    const callerUsername = req.auth.username;

    const group = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!group.Item) return res.status(404).json({ error: "Không tìm thấy nhóm!" });

    const isOwner = group.Item.owner === callerUsername;
    const isMod = (group.Item.mods || []).includes(callerUsername);
    if (!isOwner && !isMod) return res.status(403).json({ error: "Bạn không có quyền reset liên kết mời!" });

    const newInviteToken = crypto.randomBytes(8).toString('hex');

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set inviteToken = :t",
      ExpressionAttributeValues: { ":t": newInviteToken }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true, inviteToken: newInviteToken });
  } catch (err) {
    res.status(500).json(err);
  }
};

const joinByInvite = async (req, res) => {
  try {
    const { token } = req.body;
    const username = req.auth.username;

    if (!token) return res.status(400).json({ error: "Thiếu mã mời!" });

    const scanData = await docClient.send(new ScanCommand({
      TableName: 'Groups',
      FilterExpression: 'inviteToken = :t and inviteLinkEnabled = :e',
      ExpressionAttributeValues: {
        ':t': token,
        ':e': true
      }
    }));

    if (!scanData.Items || scanData.Items.length === 0) {
      return res.status(404).json({ error: "Liên kết mời không hợp lệ hoặc đã bị vô hiệu hóa!" });
    }

    const group = scanData.Items[0];
    
    if (group.isDisabled) {
      return res.status(400).json({ error: "Nhóm chat này hiện đang bị khóa!" });
    }

    let members = group.members || [];
    if (members.includes(username)) {
      return res.json({ success: true, joined: true, groupId: group.groupId, groupName: group.groupName });
    }

    const linkApprovalRequired = group.linkApprovalRequired || false;

    if (linkApprovalRequired) {
      let pending = group.pendingRequests || [];
      if (!pending.includes(username)) {
        pending.push(username);
      }
      await docClient.send(new UpdateCommand({
        TableName: 'Groups',
        Key: { groupId: group.groupId },
        UpdateExpression: "set pendingRequests = :p",
        ExpressionAttributeValues: {
          ":p": pending
        }
      }));

      req.app.get('io').emit('groups_updated');
      res.json({ success: true, joined: false, groupId: group.groupId, groupName: group.groupName });
    } else {
      members.push(username);
      let pending = (group.pendingRequests || []).filter(u => u !== username);

      await docClient.send(new UpdateCommand({
        TableName: 'Groups',
        Key: { groupId: group.groupId },
        UpdateExpression: "set members = :m, pendingRequests = :p",
        ExpressionAttributeValues: {
          ":m": members,
          ":p": pending
        }
      }));

      req.app.get('io').emit('groups_updated');
      res.json({ success: true, joined: true, groupId: group.groupId, groupName: group.groupName });
    }
  } catch (err) {
    res.status(500).json(err);
  }
};

const muteMember = async (req, res) => {
  try {
    const { groupId, targetUsername, duration } = req.body;
    const callerUsername = req.auth.username;

    if (callerUsername === targetUsername) {
      return res.status(400).json({ error: "Bạn không thể tự cấm chat chính mình!" });
    }

    const group = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!group.Item) return res.status(404).json({ error: "Không tìm thấy nhóm!" });

    const isOwner = group.Item.owner === callerUsername;
    const isMod = (group.Item.mods || []).includes(callerUsername);
    if (!isOwner && !isMod) return res.status(403).json({ error: "Bạn không có quyền cấm chat thành viên!" });

    if (isMod && !isOwner) {
      const targetIsOwner = group.Item.owner === targetUsername;
      const targetIsMod = (group.Item.mods || []).includes(targetUsername);
      if (targetIsOwner || targetIsMod) {
        return res.status(403).json({ error: "Mod không thể cấm chat chủ nhóm hoặc mod khác!" });
      }
    }

    let expireAt;
    if (duration === '5m') {
      expireAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    } else if (duration === '1h') {
      expireAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    } else {
      expireAt = '9999-12-31T23:59:59.999Z';
    }

    let mutedMembers = group.Item.mutedMembers || {};
    mutedMembers[targetUsername] = expireAt;

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set mutedMembers = :m",
      ExpressionAttributeValues: { ":m": mutedMembers }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true, mutedMembers });
  } catch (err) {
    res.status(500).json(err);
  }
};

const unmuteMember = async (req, res) => {
  try {
    const { groupId, targetUsername } = req.body;
    const callerUsername = req.auth.username;

    const group = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!group.Item) return res.status(404).json({ error: "Không tìm thấy nhóm!" });

    const isOwner = group.Item.owner === callerUsername;
    const isMod = (group.Item.mods || []).includes(callerUsername);
    if (!isOwner && !isMod) return res.status(403).json({ error: "Bạn không có quyền mở cấm chat!" });

    if (isMod && !isOwner) {
      const targetIsOwner = group.Item.owner === targetUsername;
      const targetIsMod = (group.Item.mods || []).includes(targetUsername);
      if (targetIsOwner || targetIsMod) {
        return res.status(403).json({ error: "Mod không thể thao tác với chủ nhóm hoặc mod khác!" });
      }
    }

    let mutedMembers = group.Item.mutedMembers || {};
    delete mutedMembers[targetUsername];

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set mutedMembers = :m",
      ExpressionAttributeValues: { ":m": mutedMembers }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true, mutedMembers });
  } catch (err) {
    res.status(500).json(err);
  }
};

const toggleInviteApproval = async (req, res) => {
  try {
    const { groupId } = req.body;
    const callerUsername = req.auth.username;

    const group = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!group.Item) return res.status(404).json({ error: "Không tìm thấy nhóm!" });

    const isOwner = group.Item.owner === callerUsername;
    const isMod = (group.Item.mods || []).includes(callerUsername);
    if (!isOwner && !isMod) return res.status(403).json({ error: "Bạn không có quyền quản lý cấu hình duyệt mời thành viên!" });

    const newVal = !group.Item.inviteApprovalRequired;

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set inviteApprovalRequired = :v",
      ExpressionAttributeValues: { ":v": newVal }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true, inviteApprovalRequired: newVal });
  } catch (err) {
    res.status(500).json(err);
  }
};

const toggleLinkApproval = async (req, res) => {
  try {
    const { groupId } = req.body;
    const callerUsername = req.auth.username;

    const group = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!group.Item) return res.status(404).json({ error: "Không tìm thấy nhóm!" });

    const isOwner = group.Item.owner === callerUsername;
    const isMod = (group.Item.mods || []).includes(callerUsername);
    if (!isOwner && !isMod) return res.status(403).json({ error: "Bạn không có quyền quản lý cấu hình duyệt liên kết mời!" });

    const newVal = !group.Item.linkApprovalRequired;

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set linkApprovalRequired = :v",
      ExpressionAttributeValues: { ":v": newVal }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true, linkApprovalRequired: newVal });
  } catch (err) {
    res.status(500).json(err);
  }
};

const toggleChannelMode = async (req, res) => {
  try {
    const { groupId } = req.body;
    const callerUsername = req.auth.username;

    const group = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!group.Item) return res.status(404).json({ error: "Không tìm thấy nhóm!" });

    const isOwner = group.Item.owner === callerUsername;
    const isMod = (group.Item.mods || []).includes(callerUsername);
    if (!isOwner && !isMod) return res.status(403).json({ error: "Bạn không có quyền quản lý cấu hình chế độ thông báo (Kênh)!" });

    const newVal = !group.Item.isChannel;

    await docClient.send(new UpdateCommand({
      TableName: 'Groups',
      Key: { groupId },
      UpdateExpression: "set isChannel = :v",
      ExpressionAttributeValues: { ":v": newVal }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true, isChannel: newVal });
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
  inviteToGroup,
  updateGroupAvatar,
  toggleInviteLink,
  resetInviteLink,
  joinByInvite,
  muteMember,
  unmuteMember,
  toggleChannelMode,
  toggleInviteApproval,
  toggleLinkApproval
};
