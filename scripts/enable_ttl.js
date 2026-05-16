const { DynamoDBClient, UpdateTimeToLiveCommand } = require("@aws-sdk/client-dynamodb");
require('dotenv').config();

const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

async function enableTTL() {
    try {
        console.log("Enabling TTL on Stories table...");
        await client.send(new UpdateTimeToLiveCommand({
            TableName: "Stories",
            TimeToLiveSpecification: {
                AttributeName: "ttl",
                Enabled: true
            }
        }));
        console.log("TTL enabled successfully.");
    } catch (e) {
        console.error("Error enabling TTL:", e);
    }
}

enableTTL();
