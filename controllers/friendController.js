const docClient = require('../awsConfig');
const { GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const requestFriend = async (req, res) => {
  try {
    const { fromUser, toUser } = req.body;

    const target = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: toUser } }));
    if (!target.Item) {
      return res.status(404).send("User not found");
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

module.exports = {
  requestFriend,
  acceptFriend,
  unfriend,
  rejectFriend
};
