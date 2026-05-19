const { PutCommand, ScanCommand, UpdateCommand, DeleteCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const docClient = require("../awsConfig");
const s3Service = require("../services/s3Service");

exports.createPost = async (req, res) => {
    try {
        const { text, mediaData, username, privacy } = req.body;
        let mediaUrl = "";
        
        if (mediaData) {
            mediaUrl = await s3Service.uploadBase64File(mediaData, `post_${Date.now()}`, 'image');
        }

        const postId = `post_${Date.now()}_${username}`;
        const item = {
            postId,
            username,
            text: text || "",
            mediaUrl,
            privacy: privacy || "friends", // 'public' | 'friends' | 'private'
            likes: [], // Backward compatibility
            reactions: [], // Array of { username, emoji }
            comments: [], // Array of { commentId, username, text, createdAt }
            createdAt: new Date().toISOString()
        };

        await docClient.send(new PutCommand({
            TableName: "Posts",
            Item: item
        }));

        req.app.get('io').emit('posts_updated');
        res.json(item);
    } catch (error) {
        console.error("Create post error:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.getPosts = async (req, res) => {
    try {
        const { friends } = req.query;
        const friendList = friends ? friends.split(',') : [];
        
        // Scan all posts
        const result = await docClient.send(new ScanCommand({
            TableName: "Posts"
        }));

        const filtered = (result.Items || []).filter(p => {
            const author = p.username;
            const isMe = author === req.auth.username;
            
            if (isMe) return true;
            
            const privacy = p.privacy || 'friends';
            const isFriend = friendList.includes(author);
            
            if (isFriend) {
                return privacy === 'public' || privacy === 'friends';
            }
            
            // Non-friends can only see public posts
            return privacy === 'public';
        });

        // Ensure fields are defined
        filtered.forEach(p => {
            if (!p.reactions) p.reactions = [];
            if (!p.comments) p.comments = [];
        });

        // Sort by date descending
        filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json(filtered);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.reactPost = async (req, res) => {
    try {
        const { postId, username, emoji } = req.body;
        
        const postRes = await docClient.send(new QueryCommand({
            TableName: "Posts",
            KeyConditionExpression: "postId = :id",
            ExpressionAttributeValues: { ":id": postId }
        }));

        if (!postRes.Items || postRes.Items.length === 0) return res.status(404).json({ error: "Post not found" });

        const post = postRes.Items[0];
        let reactions = post.reactions || [];

        // Check if user already reacted
        const existingIdx = reactions.findIndex(r => r.username === username);
        if (existingIdx > -1) {
            if (reactions[existingIdx].emoji === emoji) {
                // Remove if same emoji clicked
                reactions.splice(existingIdx, 1);
            } else {
                // Update with new emoji
                reactions[existingIdx].emoji = emoji;
            }
        } else {
            // Add new reaction
            reactions.push({ username, emoji });
        }

        await docClient.send(new UpdateCommand({
            TableName: "Posts",
            Key: { postId },
            UpdateExpression: "SET reactions = :r",
            ExpressionAttributeValues: { ":r": reactions }
        }));

        req.app.get('io').emit('posts_updated');
        res.json({ success: true, reactions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.commentPost = async (req, res) => {
    try {
        const { postId, username, text, mediaData, stickerUrl } = req.body;
        
        let mediaUrl = "";
        if (mediaData) {
            mediaUrl = await s3Service.uploadBase64File(mediaData, `comment_${Date.now()}`, 'image');
        }

        const postRes = await docClient.send(new QueryCommand({
            TableName: "Posts",
            KeyConditionExpression: "postId = :id",
            ExpressionAttributeValues: { ":id": postId }
        }));

        if (!postRes.Items || postRes.Items.length === 0) return res.status(404).json({ error: "Post not found" });

        const post = postRes.Items[0];
        let comments = post.comments || [];

        const newComment = {
            commentId: `c_${Date.now()}_${username}`,
            username,
            text: (text || "").trim(),
            mediaUrl: mediaUrl || "",
            stickerUrl: stickerUrl || "",
            reactions: [],
            replies: [],
            createdAt: new Date().toISOString()
        };

        comments.push(newComment);

        await docClient.send(new UpdateCommand({
            TableName: "Posts",
            Key: { postId },
            UpdateExpression: "SET comments = :c",
            ExpressionAttributeValues: { ":c": comments }
        }));

        req.app.get('io').emit('posts_updated');
        res.json({ success: true, comment: newComment, comments });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


exports.deleteComment = async (req, res) => {
    try {
        const { postId, commentId, username } = req.body;
        
        const postRes = await docClient.send(new QueryCommand({
            TableName: "Posts",
            KeyConditionExpression: "postId = :id",
            ExpressionAttributeValues: { ":id": postId }
        }));

        if (!postRes.Items || postRes.Items.length === 0) return res.status(404).json({ error: "Post not found" });

        const post = postRes.Items[0];
        let comments = post.comments || [];

        const comment = comments.find(c => c.commentId === commentId);
        if (!comment) return res.status(404).json({ error: "Comment not found" });

        // Author of comment or author of post can delete
        if (comment.username !== username && post.username !== username) {
            return res.status(403).json({ error: "Unauthorized to delete comment" });
        }

        comments = comments.filter(c => c.commentId !== commentId);

        await docClient.send(new UpdateCommand({
            TableName: "Posts",
            Key: { postId },
            UpdateExpression: "SET comments = :c",
            ExpressionAttributeValues: { ":c": comments }
        }));

        req.app.get('io').emit('posts_updated');
        res.json({ success: true, comments });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.editComment = async (req, res) => {
    try {
        const { postId, commentId, text, username } = req.body;
        
        const postRes = await docClient.send(new QueryCommand({
            TableName: "Posts",
            KeyConditionExpression: "postId = :id",
            ExpressionAttributeValues: { ":id": postId }
        }));

        if (!postRes.Items || postRes.Items.length === 0) return res.status(404).json({ error: "Post not found" });

        const post = postRes.Items[0];
        let comments = post.comments || [];

        const commentIdx = comments.findIndex(c => c.commentId === commentId);
        if (commentIdx === -1) return res.status(404).json({ error: "Comment not found" });

        if (comments[commentIdx].username !== username) {
            return res.status(403).json({ error: "Unauthorized to edit this comment" });
        }

        comments[commentIdx].text = text || "";
        comments[commentIdx].isEdited = true;

        await docClient.send(new UpdateCommand({
            TableName: "Posts",
            Key: { postId },
            UpdateExpression: "SET comments = :c",
            ExpressionAttributeValues: { ":c": comments }
        }));

        req.app.get('io').emit('posts_updated');
        res.json({ success: true, comments });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


exports.editPost = async (req, res) => {
    try {
        const { postId, text } = req.body;
        const username = req.auth.username;

        const postRes = await docClient.send(new QueryCommand({
            TableName: "Posts",
            KeyConditionExpression: "postId = :id",
            ExpressionAttributeValues: { ":id": postId }
        }));

        if (!postRes.Items || postRes.Items.length === 0) return res.status(404).json({ error: "Post not found" });

        const post = postRes.Items[0];
        if (post.username !== username) {
            return res.status(403).json({ error: "Unauthorized to edit this post" });
        }

        await docClient.send(new UpdateCommand({
            TableName: "Posts",
            Key: { postId },
            UpdateExpression: "SET #t = :text, isEdited = :isEdited",
            ExpressionAttributeNames: { "#t": "text" },
            ExpressionAttributeValues: { ":text": text || "", ":isEdited": true }
        }));

        req.app.get('io').emit('posts_updated');
        res.json({ success: true, text });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.deletePost = async (req, res) => {
    try {
        const { postId } = req.body;
        const username = req.auth.username;
        const role = req.auth.role || 'user';

        const postRes = await docClient.send(new QueryCommand({
            TableName: "Posts",
            KeyConditionExpression: "postId = :id",
            ExpressionAttributeValues: { ":id": postId }
        }));

        if (!postRes.Items || postRes.Items.length === 0) return res.status(404).json({ error: "Post not found" });

        const post = postRes.Items[0];
        if (post.username !== username && role !== 'admin') {
            return res.status(403).json({ error: "Unauthorized to delete this post" });
        }

        await docClient.send(new DeleteCommand({
            TableName: "Posts",
            Key: { postId }
        }));

        req.app.get('io').emit('posts_updated');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.reactComment = async (req, res) => {
    try {
        const { postId, commentId, username, emoji } = req.body;

        const postRes = await docClient.send(new QueryCommand({
            TableName: "Posts",
            KeyConditionExpression: "postId = :id",
            ExpressionAttributeValues: { ":id": postId }
        }));

        if (!postRes.Items || postRes.Items.length === 0) return res.status(404).json({ error: "Post not found" });

        const post = postRes.Items[0];
        let comments = post.comments || [];

        const commentIdx = comments.findIndex(c => c.commentId === commentId);
        if (commentIdx === -1) return res.status(404).json({ error: "Comment not found" });

        let reactions = comments[commentIdx].reactions || [];
        const existingIdx = reactions.findIndex(r => r.username === username);

        if (existingIdx > -1) {
            if (reactions[existingIdx].emoji === emoji) {
                reactions.splice(existingIdx, 1);
            } else {
                reactions[existingIdx].emoji = emoji;
            }
        } else {
            reactions.push({ username, emoji });
        }

        comments[commentIdx].reactions = reactions;

        await docClient.send(new UpdateCommand({
            TableName: "Posts",
            Key: { postId },
            UpdateExpression: "SET comments = :c",
            ExpressionAttributeValues: { ":c": comments }
        }));

        req.app.get('io').emit('posts_updated');
        res.json({ success: true, comments });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

exports.replyComment = async (req, res) => {
    try {
        const { postId, commentId, username, text } = req.body;

        const postRes = await docClient.send(new QueryCommand({
            TableName: "Posts",
            KeyConditionExpression: "postId = :id",
            ExpressionAttributeValues: { ":id": postId }
        }));

        if (!postRes.Items || postRes.Items.length === 0) return res.status(404).json({ error: "Post not found" });

        const post = postRes.Items[0];
        let comments = post.comments || [];

        const commentIdx = comments.findIndex(c => c.commentId === commentId);
        if (commentIdx === -1) return res.status(404).json({ error: "Comment not found" });

        let replies = comments[commentIdx].replies || [];
        const newReply = {
            replyId: `reply_${Date.now()}_${username}`,
            username,
            text: (text || "").trim(),
            createdAt: new Date().toISOString()
        };

        replies.push(newReply);
        comments[commentIdx].replies = replies;

        await docClient.send(new UpdateCommand({
            TableName: "Posts",
            Key: { postId },
            UpdateExpression: "SET comments = :c",
            ExpressionAttributeValues: { ":c": comments }
        }));

        req.app.get('io').emit('posts_updated');
        res.json({ success: true, comments });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


