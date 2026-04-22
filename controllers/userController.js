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

module.exports = {
  getUser,
  updateUser,
  syncTags
};
