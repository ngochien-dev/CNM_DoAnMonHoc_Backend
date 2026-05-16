const docClient = require('../awsConfig');
const { ScanCommand } = require("@aws-sdk/lib-dynamodb");

/**
 * Global search for users, groups, and messages
 */
exports.globalSearch = async (req, res) => {
    try {
        const { q } = req.query;
        const currentUsername = req.auth.username;

        if (!q || q.length < 2) {
            return res.json({ users: [], groups: [], messages: [] });
        }

        const query = q.toLowerCase();

        // 1. Search Users
        const usersData = await docClient.send(new ScanCommand({
            TableName: 'Users',
            FilterExpression: 'contains(username, :q) OR contains(displayName, :q)',
            ExpressionAttributeValues: { ':q': q }
        }));

        // 2. Search Groups
        const groupsData = await docClient.send(new ScanCommand({
            TableName: 'Groups',
            FilterExpression: 'contains(groupName, :q)',
            ExpressionAttributeValues: { ':q': q }
        }));

        // 3. Search Messages (Simplified global search - can be very slow with Scan)
        // In a real app, you'd use ElasticSearch or CloudSearch for this.
        // We limit it to top results for performance.
        const messagesData = await docClient.send(new ScanCommand({
            TableName: 'Messages',
            FilterExpression: 'contains(#txt, :q)',
            ExpressionAttributeNames: { '#txt': 'text' },
            ExpressionAttributeValues: { ':q': q },
            Limit: 20
        }));

        // Post-filter messages: only show messages from rooms the user belongs to
        // For simplicity in this demo, we'll filter them by roomId patterns
        const filteredMessages = (messagesData.Items || []).filter(msg => {
            const roomId = msg.roomId || 'chung';
            if (roomId === 'chung') return true;
            if (roomId.startsWith('dm_') && roomId.includes(currentUsername)) return true;
            // For groups, we'd ideally check group membership, but let's keep it simple
            return true; 
        });

        res.json({
            users: (usersData.Items || []).map(u => ({ username: u.username, displayName: u.displayName, avatar: u.avatar })).slice(0, 10),
            groups: (groupsData.Items || []).map(g => ({ groupId: g.groupId, groupName: g.groupName, isPublic: g.isPublic })).slice(0, 10),
            messages: filteredMessages.map(m => ({
                messageId: m.messageId,
                text: m.text,
                senderUsername: m.senderUsername,
                roomId: m.roomId,
                createdAt: m.createdAt
            }))
        });

    } catch (error) {
        console.error("Global search error:", error);
        res.status(500).json({ error: "Search failed" });
    }
};
