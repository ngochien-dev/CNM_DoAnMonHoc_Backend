const docClient = require('../awsConfig');
const { GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const presenceStore = require('../store/presenceStore');

const requestFriend = async (req, res) => {
  try {
    const { fromUser, toUser } = req.body;

    // P1: Check if blocked
    const fromData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: fromUser } }));
    const blockedByMe = fromData.Item?.blockedUsers || [];
    if (blockedByMe.includes(toUser)) {
      return res.status(403).json({ error: "Bạn đã chặn người này." });
    }

    const target = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: toUser } }));
    if (!target.Item) {
      return res.status(404).send("User not found");
    }

    // P1: Check if target blocked fromUser
    const blockedByTarget = target.Item.blockedUsers || [];
    if (blockedByTarget.includes(fromUser)) {
      return res.status(403).json({ error: "Không thể gửi lời mời kết bạn." });
    }

    let requests = target.Item.friendRequests || [];
    if (!requests.includes(fromUser)) {
      requests.push(fromUser);
    }

    await docClient.send(new UpdateCommand({
      TableName: 'Users',
      Key: { username: toUser },
      UpdateExpression: "set friendRequests = :r",
      ExpressionAttributeValues: { ":r": requests }
    }));

    req.app.get('io').emit('groups_updated');
    req.app.get('io').emit('new_friend_request', { toUser, fromUser });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(err);
  }
};

const acceptFriend = async (req, res) => {
  try {
    const { me, friendUname } = req.body;

    const myData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: me } }));
    if (!myData.Item) return res.status(404).send("User not found");

    let myF = myData.Item.friends || [];
    let myR = (myData.Item.friendRequests || []).filter(u => u !== friendUname);

    if (!myF.includes(friendUname)) {
      myF.push(friendUname);
    }

    await docClient.send(new UpdateCommand({
      TableName: 'Users',
      Key: { username: me },
      UpdateExpression: "set friends = :f, friendRequests = :r",
      ExpressionAttributeValues: {
        ":f": myF,
        ":r": myR
      }
    }));

    const fData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: friendUname } }));
    if (!fData.Item) return res.status(404).send("User not found");

    let fF = fData.Item.friends || [];
    if (!fF.includes(me)) {
      fF.push(me);
    }

    await docClient.send(new UpdateCommand({
      TableName: 'Users',
      Key: { username: friendUname },
      UpdateExpression: "set friends = :f",
      ExpressionAttributeValues: { ":f": fF }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(err);
  }
};

const unfriend = async (req, res) => {
  try {
    const { me, friendUname } = req.body;

    const myData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: me } }));
    if (myData.Item) {
      let myF = (myData.Item.friends || []).filter(u => u !== friendUname);
      await docClient.send(new UpdateCommand({
        TableName: 'Users',
        Key: { username: me },
        UpdateExpression: "set friends = :f",
        ExpressionAttributeValues: { ":f": myF }
      }));
    }

    const fData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: friendUname } }));
    if (fData.Item) {
      let fF = (fData.Item.friends || []).filter(u => u !== me);
      await docClient.send(new UpdateCommand({
        TableName: 'Users',
        Key: { username: friendUname },
        UpdateExpression: "set friends = :f",
        ExpressionAttributeValues: { ":f": fF }
      }));
    }

    req.app.get('io').emit('groups_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(err);
  }
};

const rejectFriend = async (req, res) => {
  try {
    const { me, friendUname } = req.body;

    const myData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: me } }));
    if (!myData.Item) return res.status(404).send("User not found");

    // Remove from my friendRequests
    let myR = (myData.Item.friendRequests || []).filter(u => u !== friendUname);

    await docClient.send(new UpdateCommand({
      TableName: 'Users',
      Key: { username: me },
      UpdateExpression: "set friendRequests = :r",
      ExpressionAttributeValues: { ":r": myR }
    }));

    req.app.get('io').emit('groups_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(err);
  }
};

// P1: Block a user
const blockUser = async (req, res) => {
  try {
    const { me, targetUsername } = req.body;
    if (!me || !targetUsername || me === targetUsername) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    const myData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: me } }));
    if (!myData.Item) return res.status(404).json({ error: "User not found" });

    let blockedUsers = myData.Item.blockedUsers || [];
    if (!blockedUsers.includes(targetUsername)) {
      blockedUsers.push(targetUsername);
    }

    // Also remove from friends if they are friends
    let friends = (myData.Item.friends || []).filter(u => u !== targetUsername);
    let friendRequests = (myData.Item.friendRequests || []).filter(u => u !== targetUsername);

    await docClient.send(new UpdateCommand({
      TableName: 'Users',
      Key: { username: me },
      UpdateExpression: "set blockedUsers = :b, friends = :f, friendRequests = :r",
      ExpressionAttributeValues: { ":b": blockedUsers, ":f": friends, ":r": friendRequests }
    }));

    // Also remove me from the other user's friends list
    const otherData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: targetUsername } }));
    if (otherData.Item) {
      let otherFriends = (otherData.Item.friends || []).filter(u => u !== me);
      let otherRequests = (otherData.Item.friendRequests || []).filter(u => u !== me);
      await docClient.send(new UpdateCommand({
        TableName: 'Users',
        Key: { username: targetUsername },
        UpdateExpression: "set friends = :f, friendRequests = :r",
        ExpressionAttributeValues: { ":f": otherFriends, ":r": otherRequests }
      }));
    }

    req.app.get('io').emit('groups_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json(err);
  }
};

// P1: Unblock a user
const unblockUser = async (req, res) => {
  try {
    const { me, targetUsername } = req.body;
    if (!me || !targetUsername) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    const myData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: me } }));
    if (!myData.Item) return res.status(404).json({ error: "User not found" });

    let blockedUsers = (myData.Item.blockedUsers || []).filter(u => u !== targetUsername);

    await docClient.send(new UpdateCommand({
      TableName: 'Users',
      Key: { username: me },
      UpdateExpression: "set blockedUsers = :b",
      ExpressionAttributeValues: { ":b": blockedUsers }
    }));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json(err);
  }
};

// P1: Get last seen for friends
const getLastSeen = async (req, res) => {
  try {
    const { usernames } = req.query;
    if (!usernames) return res.json({});
    const list = usernames.split(',').slice(0, 50); // Max 50 users
    const result = presenceStore.getLastSeenBatch(list);
    res.json(result);
  } catch (err) {
    res.status(500).json(err);
  }
};

module.exports = {
  requestFriend,
  acceptFriend,
  unfriend,
  rejectFriend,
  blockUser,
  unblockUser,
  getLastSeen,
};
