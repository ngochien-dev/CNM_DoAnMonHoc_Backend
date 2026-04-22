const { GetCommand, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const docClient = require('../awsConfig');

const TABLE_NAME = process.env.CALLS_TABLE_NAME || 'Calls';
let hasWarnedMissingTable = false;
let shouldUseMemoryFallback = false;
const memoryFallbackCalls = new Map();

function isMissingTableError(error) {
    return (
        error?.name === 'ResourceNotFoundException' ||
        error?.code === 'ResourceNotFoundException' ||
        error?.Code === 'ResourceNotFoundException'
    );
}

function warnMissingTable() {
    if (hasWarnedMissingTable) return;
    hasWarnedMissingTable = true;
    console.warn(
        `[Calls] DynamoDB table "${TABLE_NAME}" was not found. Falling back to in-memory call history for this server session.`,
    );
}

function writeToMemoryFallback(callItem) {
    if (!callItem?.callId) return null;
    memoryFallbackCalls.set(callItem.callId, { ...callItem });
    return callItem;
}

function readFromMemoryFallback(callId) {
    if (!callId) return null;
    return memoryFallbackCalls.get(callId) || null;
}

function getHistoryFromMemoryFallback(username, limit = 20) {
    return Array.from(memoryFallbackCalls.values())
        .filter((item) => item.participants?.includes(username))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, limit);
}

async function upsert(callItem) {
    if (shouldUseMemoryFallback) {
        return writeToMemoryFallback(callItem);
    }

    try {
        return await docClient.send(
            new PutCommand({
                TableName: TABLE_NAME,
                Item: callItem,
            }),
        );
    } catch (error) {
        if (isMissingTableError(error)) {
            shouldUseMemoryFallback = true;
            warnMissingTable();
            return writeToMemoryFallback(callItem);
        }
        throw error;
    }
}

async function findById(callId) {
    if (shouldUseMemoryFallback) {
        return readFromMemoryFallback(callId);
    }

    try {
        const { Item } = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { callId },
            }),
        );
        return Item || null;
    } catch (error) {
        if (isMissingTableError(error)) {
            shouldUseMemoryFallback = true;
            warnMissingTable();
            return readFromMemoryFallback(callId);
        }
        throw error;
    }
}

async function getHistoryForUser(username, limit = 20) {
    if (shouldUseMemoryFallback) {
        return getHistoryFromMemoryFallback(username, limit);
    }

    try {
        const { Items = [] } = await docClient.send(
            new ScanCommand({
                TableName: TABLE_NAME,
                FilterExpression: 'contains(participants, :username)',
                ExpressionAttributeValues: {
                    ':username': username,
                },
            }),
        );

        return Items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
    } catch (error) {
        if (isMissingTableError(error)) {
            shouldUseMemoryFallback = true;
            warnMissingTable();
            return getHistoryFromMemoryFallback(username, limit);
        }
        throw error;
    }
}

module.exports = {
    upsert,
    save: upsert,
    findById,
    getHistoryForUser,
};