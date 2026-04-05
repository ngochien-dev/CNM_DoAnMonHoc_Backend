const docClient = require('../awsConfig');
const { PutCommand, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const TABLE_NAME = "Users";

const User = {
    create: async (userData) => {
        const params = {
            TableName: TABLE_NAME,
            Item: {
                username: userData.username,
                email: userData.email,
                password: userData.password,
                displayName: userData.displayName,
                role: 'user',
                isVerified: false,
                otp: userData.otp,
                createdAt: new Date().toISOString()
            },
        };
        return await docClient.send(new PutCommand(params));
    },

    findByUsername: async (username) => {
        const params = { TableName: TABLE_NAME, Key: { username } };
        const { Item } = await docClient.send(new GetCommand(params));
        return Item;
    },

    verifyUser: async (username) => {
        const params = {
            TableName: TABLE_NAME,
            Key: { username },
            UpdateExpression: "set isVerified = :v, otp = :null",
            ExpressionAttributeValues: { ":v": true, ":null": null }
        };
        return await docClient.send(new UpdateCommand(params));
    }
};

module.exports = User;