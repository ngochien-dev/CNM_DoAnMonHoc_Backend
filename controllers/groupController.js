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
    const { groupName, owner, isPublic } = req.body;
    const groupId = "group_" + Date.now();

    const item = {
      groupId,
      groupName,
      owner,
      isPublic: isPublic || false,
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

    if (action === 'delete') {
      await docClient.send(new DeleteCommand({ TableName: 'Groups', Key: { groupId } }));
    } else {
      const group = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
      if (!group.Item) return res.status(404).json({ error: "Group not found" });

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

    const data = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!data.Item) return res.status(404).json({ error: "Group not found" });

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
    // action: 'grant' or 'revoke'
    const data = await docClient.send(new GetCommand({ TableName: 'Groups', Key: { groupId } }));
    if (!data.Item) return res.status(404).json({ error: "Group not found" });

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

module.exports = {
  getAllGroups,
  createGroup,
  requestJoin,
  approveJoin,
  manageGroup,
  removeMember,
  updateRole
};
