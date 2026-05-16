const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require("@aws-sdk/client-dynamodb");
require('dotenv').config();

const client = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const tables = [
    {
        TableName: "Stories",
        KeySchema: [{ AttributeName: "storyId", KeyType: "HASH" }],
        AttributeDefinitions: [{ AttributeName: "storyId", AttributeType: "S" }],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
    },
    {
        TableName: "Calls",
        KeySchema: [{ AttributeName: "callId", KeyType: "HASH" }],
        AttributeDefinitions: [{ AttributeName: "callId", AttributeType: "S" }],
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 }
    }
];

async function setup() {
    for (const table of tables) {
        try {
            console.log(`Checking table: ${table.TableName}...`);
            await client.send(new DescribeTableCommand({ TableName: table.TableName }));
            console.log(`Table ${table.TableName} already exists.`);
        } catch (e) {
            if (e.name === "ResourceNotFoundException") {
                console.log(`Creating table: ${table.TableName}...`);
                await client.send(new CreateTableCommand(table));
                console.log(`Table ${table.TableName} created successfully.`);
            } else {
                console.error(`Error with ${table.TableName}:`, e);
            }
        }
    }
}

setup();
