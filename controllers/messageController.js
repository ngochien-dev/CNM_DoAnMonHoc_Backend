const messageService = require('../services/messageService');
const docClient = require('../awsConfig');
const { ScanCommand, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

// Simple search by content
exports.searchByContent = async (req, res) => {
  try {
    const { content } = req.query;
    if (!content) {
      return res.status(400).json({ error: 'Content parameter is required' });
    }
    const messages = await messageService.searchByContent(content);
    const searchResponses = messageService.convertToSearchResponse(messages);
    res.json(searchResponses);
  } catch (err) {
    res.status(500).json({ error: 'Error when searching' });
  }
};

// Advanced search with all available filters
exports.advancedSearch = async (req, res) => {
  try {
    const { content, from, in: channelId, before, after } = req.query;
    const messages = await messageService.advancedSearch({
      content,
      senderId: from,
      channelId,
      beforeDate: before,
      afterDate: after
    });
    const searchResponses = messageService.convertToSearchResponse(messages);
    res.json(searchResponses);
  } catch (err) {
    res.status(500).json({ error: 'Error during advanced search: ' + err.message });
  }
};

// Search messages from specific user (from: userId)
exports.searchByUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { content } = req.query;
    const messages = await messageService.searchByUser(userId, content);
    const searchResponses = messageService.convertToSearchResponse(messages);
    res.json(searchResponses);
  } catch (err) {
    res.status(500).json({ error: 'Error when searching by user: ' + err.message });
  }
};

// Search messages with attachments (tệp)
exports.searchWithAttachments = async (req, res) => {
  try {
    const { content, in: channelId } = req.query;
    const messages = await messageService.searchWithAttachments({ content, channelId });
    const searchResponses = messageService.convertToSearchResponse(messages);
    res.json(searchResponses);
  } catch (err) {
    res.status(500).json({ error: 'Error when searching messages with attachments: ' + err.message });
  }
};

// Search messages with links
exports.searchWithLinks = async (req, res) => {
  try {
    const { content, in: channelId } = req.query;
    const messages = await messageService.searchWithLinks({ content, channelId });
    const searchResponses = messageService.convertToSearchResponse(messages);
    res.json(searchResponses);
  } catch (err) {
    res.status(500).json({ error: 'Error when searching messages with links: ' + err.message });
  }
};

// Search messages by date range (before, after)
exports.searchByDateRange = async (req, res) => {
  try {
    const { startDate, endDate, content, in: channelId } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required' });
    }
    const messages = await messageService.searchByDateRange({
      startDate,
      endDate,
      content,
      channelId
    });
    const searchResponses = messageService.convertToSearchResponse(messages);
    res.json(searchResponses);
  } catch (err) {
    res.status(500).json({ error: 'Error when searching by date range: ' + err.message });
  }
};

// Search edited messages
exports.searchEditedMessages = async (req, res) => {
  try {
    const { content, in: channelId } = req.query;
    const messages = await messageService.searchEditedMessages({ content, channelId });
    const searchResponses = messageService.convertToSearchResponse(messages);
    res.json(searchResponses);
  } catch (err) {
    res.status(500).json({ error: 'Error when searching edited messages: ' + err.message });
  }
};

// Search pinned messages (đã ghim)
exports.searchPinnedMessages = async (req, res) => {
  try {
    const { in: channelId } = req.query;
    const messages = await messageService.searchPinnedMessages(channelId);
    const searchResponses = messageService.convertToSearchResponse(messages);
    res.json(searchResponses);
  } catch (err) {
    res.status(500).json({ error: 'Error when searching pinned messages: ' + err.message });
  }
};

// Basic operations that were previously in server.js
exports.getMessages = async (req, res) => {
  try {
    let allItems = [];
    let lastEvaluatedKey = undefined;

    do {
      const data = await docClient.send(new ScanCommand({ 
        TableName: 'Messages',
        ExclusiveStartKey: lastEvaluatedKey 
      }));
      allItems = allItems.concat(data.Items || []);
      lastEvaluatedKey = data.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    res.json(allItems.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
  } catch (err) {
    res.status(500).json(err);
  }
};

exports.deleteForMe = async (req, res) => {
  const { username, messageId } = req.body;
  try {
    const userData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username } }));
    if (!userData.Item) return res.status(404).send("User not found");
    
    let deletedMsgs = userData.Item.deletedMessages || [];
    
    if (!deletedMsgs.includes(messageId)) {
      deletedMsgs.push(messageId);
    }

    await docClient.send(new UpdateCommand({
      TableName: 'Users',
      Key: { username },
      UpdateExpression: "set deletedMessages = :d",
      ExpressionAttributeValues: { ":d": deletedMsgs }
    }));

    res.json({ success: true });
  } catch (err) { res.status(500).json(err); }
};

exports.clearHistory = async (req, res) => {
    const { username, roomId } = req.body;
    try {
        const allMsgs = await docClient.send(new ScanCommand({ 
            TableName: 'Messages',
            FilterExpression: "roomId = :r",
            ExpressionAttributeValues: { ":r": roomId }
        }));
        
        const msgIdsInRoom = (allMsgs.Items || []).map(m => m.messageId);
        const userData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username } }));
        if (!userData.Item) return res.status(404).send("User not found");
        
        let deletedMsgs = userData.Item.deletedMessages || [];
        const newDeletedList = Array.from(new Set([...deletedMsgs, ...msgIdsInRoom]));

        await docClient.send(new UpdateCommand({
            TableName: 'Users',
            Key: { username },
            UpdateExpression: "set deletedMessages = :d",
            ExpressionAttributeValues: { ":d": newDeletedList }
        }));

        res.json({ success: true });
    } catch (err) { res.status(500).json(err); }
};

exports.pinMessage = async (req, res) => {
    const { messageId, isPinned } = req.body;
    try {
        // Fetch message to get roomId for scoped emission
        const msgData = await docClient.send(new GetCommand({ TableName: 'Messages', Key: { messageId } }));
        if (!msgData.Item) return res.status(404).json({ error: "Message not found" });

        await docClient.send(new UpdateCommand({
            TableName: 'Messages',
            Key: { messageId },
            UpdateExpression: "set isPinned = :p",
            ExpressionAttributeValues: { ":p": isPinned }
        }));
        if (req.app.get('io')) {
             req.app.get('io').emit('message_pinned', { messageId, isPinned, roomId: msgData.Item.roomId });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json(err);
    }
};

exports.votePoll = async (req, res) => {
    const { messageId, optionIndex, username } = req.body;
    try {
        const msgData = await docClient.send(new GetCommand({ TableName: 'Messages', Key: { messageId } }));
        if (!msgData.Item || !msgData.Item.pollData) return res.status(404).send("Poll not found");

        let pollData = msgData.Item.pollData;
        
        // Remove user from all options first (single vote)
        pollData.options.forEach(opt => {
            opt.votes = (opt.votes || []).filter(u => u !== username);
        });
        
        // Add user to selected option
        if (pollData.options[optionIndex]) {
            if (!pollData.options[optionIndex].votes) pollData.options[optionIndex].votes = [];
            pollData.options[optionIndex].votes.push(username);
        }

        await docClient.send(new UpdateCommand({
            TableName: 'Messages',
            Key: { messageId },
            UpdateExpression: "set pollData = :pd",
            ExpressionAttributeValues: { ":pd": pollData }
        }));

        if (req.app.get('io')) {
             req.app.get('io').emit('message_updated', { messageId, pollData });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json(err);
    }
};

exports.attendEvent = async (req, res) => {
    const { messageId, username, action } = req.body; // action: 'join' or 'leave'
    try {
        const msgData = await docClient.send(new GetCommand({ TableName: 'Messages', Key: { messageId } }));
        if (!msgData.Item || !msgData.Item.eventData) return res.status(404).send("Event not found");

        let eventData = msgData.Item.eventData;
        eventData.attendees = eventData.attendees || [];
        
        if (action === 'join' && !eventData.attendees.includes(username)) {
            eventData.attendees.push(username);
        } else if (action === 'leave') {
            eventData.attendees = eventData.attendees.filter(u => u !== username);
        }

        await docClient.send(new UpdateCommand({
            TableName: 'Messages',
            Key: { messageId },
            UpdateExpression: "set eventData = :ed",
            ExpressionAttributeValues: { ":ed": eventData }
        }));

        if (req.app.get('io')) {
             req.app.get('io').emit('message_updated', { messageId, eventData });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json(err);
    }
};

exports.reactToMessage = async (req, res) => {
    const { messageId, username, emoji } = req.body;
    try {
        const msgData = await docClient.send(new GetCommand({ TableName: 'Messages', Key: { messageId } }));
        if (!msgData.Item) return res.status(404).send("Message not found");

        let reactions = msgData.Item.reactions || []; // Array of { username, emoji }
        
        // Remove existing reaction by this user
        reactions = reactions.filter(r => r.username !== username);
        
        // If an emoji is provided, add it
        if (emoji) {
            reactions.push({ username, emoji });
        }

        await docClient.send(new UpdateCommand({
            TableName: 'Messages',
            Key: { messageId },
            UpdateExpression: "set reactions = :r",
            ExpressionAttributeValues: { ":r": reactions }
        }));

        if (req.app.get('io')) {
             req.app.get('io').emit('message_updated', { messageId, reactions });
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json(err);
    }
};