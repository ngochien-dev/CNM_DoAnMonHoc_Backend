const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");
require('dotenv').config();

// Cấu hình Client kết nối tới Sydney (ap-southeast-2)
const client = new DynamoDBClient({
    region: "ap-southeast-2",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

// Tạo DocumentClient để thao tác dữ liệu dễ hơn (Put, Get, Update)
const docClient = DynamoDBDocumentClient.from(client);

module.exports = docClient;