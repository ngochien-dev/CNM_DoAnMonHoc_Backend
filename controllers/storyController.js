const { PutCommand, ScanCommand, UpdateCommand, DeleteCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const docClient = require("../awsConfig");
const s3Service = require("../services/s3Service");

exports.uploadStory = async (req, res) => {
    try {
        const { username, mediaData, caption, mediaType } = req.body;
        if (!mediaData) return res.status(400).json({ error: "Media is required" });

        let mediaUrl = mediaData;
        if (mediaData.startsWith('data:')) {
            mediaUrl = await s3Service.uploadBase64File(mediaData, `story_${Date.now()}`, mediaType || 'image');
        }

        const storyId = `story_${Date.now()}_${username}`;
        const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

        const storyItem = {
            storyId,
            username,
            mediaUrl,
            caption: caption || "",
            createdAt: new Date().toISOString(),
            expiresAt,
            ttl: Math.floor(expiresAt / 1000), // DynamoDB TTL
            reactions: []
        };

        await docClient.send(new PutCommand({
            TableName: "Stories",
            Item: storyItem
        }));

        req.app.get('io').emit('stories_updated');
        res.json(storyItem);
    } catch (error) {
        console.error("Story upload error:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.deleteStory = async (req, res) => {
    try {
        const { storyId } = req.body;
        const username = req.auth.username;

        const story = await docClient.send(new QueryCommand({
            TableName: "Stories",
            KeyConditionExpression: "storyId = :id",
            ExpressionAttributeValues: { ":id": storyId }
        }));

        if (story.Items && story.Items.length > 0 && story.Items[0].username !== username) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        await docClient.send(new DeleteCommand({
            TableName: "Stories",
            Key: { storyId }
        }));

        req.app.get('io').emit('stories_updated');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.getStories = async (req, res) => {
    try {
        const { friends } = req.query; // Comma separated list
        const friendList = friends ? friends.split(',') : [];
        
        const result = await docClient.send(new ScanCommand({
            TableName: "Stories"
        }));

        const now = Date.now();
        const activeStories = (result.Items || []).filter(s => {
            const isFriend = friendList.includes(s.username);
            const isMe = s.username === req.auth.username;
            return s.expiresAt > now && (isFriend || isMe);
        });

        const grouped = activeStories.reduce((acc, s) => {
            if (!acc[s.username]) acc[s.username] = [];
            acc[s.username].push(s);
            return acc;
        }, {});

        res.json(grouped);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.reactStory = async (req, res) => {
    try {
        const { storyId, username, emoji } = req.body;
        await docClient.send(new UpdateCommand({
            TableName: "Stories",
            Key: { storyId },
            UpdateExpression: "SET reactions = list_append(if_not_exists(reactions, :empty), :r)",
            ExpressionAttributeValues: {
                ":empty": [],
                ":r": [{ username, emoji }]
            }
        }));
        
        req.app.get('io').emit('stories_updated');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
