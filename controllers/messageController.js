const messageService = require('../services/messageService');
const docClient = require('../awsConfig');
const { ScanCommand, GetCommand, UpdateCommand, QueryCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");

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

// ====== P0: PAGINATION — Load messages per room with limit + cursor ======
exports.getMessages = async (req, res) => {
  try {
    const { roomId, limit, before } = req.query;
    const { username } = req.params;
    const pageSize = Math.min(parseInt(limit) || 50, 100); // Max 100 per request

    // Fetch user's deleted messages list
    let deletedMessages = [];
    if (username) {
      const userData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username } }));
      if (userData.Item) {
        deletedMessages = userData.Item.deletedMessages || [];
      }
    }
    const deletedSet = new Set(deletedMessages);

    // If roomId is specified, fetch messages for that room only (efficient)
    if (roomId) {
      let allItems = [];
      let lastKey = undefined;

      // Handle both potential orders of usernames in DM room IDs to fetch legacy messages
      let filterExpression = "roomId = :r";
      let expressionValues = { ":r": roomId };

      if (roomId.startsWith('dm_')) {
          const parts = roomId.replace('dm_', '').split('_');
          if (parts.length === 2) {
              const altRoomId = `dm_${parts[1]}_${parts[0]}`;
              if (altRoomId !== roomId) {
                  filterExpression = "roomId = :r1 OR roomId = :r2";
                  expressionValues = { ":r1": roomId, ":r2": altRoomId };
              }
          }
      }

      do {
        const params = {
          TableName: 'Messages',
          FilterExpression: filterExpression,
          ExpressionAttributeValues: expressionValues,
          ExclusiveStartKey: lastKey,
        };
        const data = await docClient.send(new ScanCommand(params));
        allItems = allItems.concat(data.Items || []);
        lastKey = data.LastEvaluatedKey;
      } while (lastKey);

      // Filter out deleted messages
      allItems = allItems.filter(m => !deletedSet.has(m.messageId));

      // Sort by createdAt descending, then apply cursor + limit
      allItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // If 'before' timestamp is provided, filter messages before that time
      if (before) {
        allItems = allItems.filter(m => new Date(m.createdAt) < new Date(before));
      }

      // Take only 'pageSize' messages, then reverse to chronological order
      const page = allItems.slice(0, pageSize).reverse();
      const hasMore = allItems.length > pageSize;

      return res.json({
        messages: page,
        hasMore,
        nextCursor: hasMore ? page[0]?.createdAt : null,
      });
    }

    // Fallback: load ALL messages (legacy behavior for initial load)
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

    // Fetch user's active groups to securely filter group messages
    const groupsData = await docClient.send(new ScanCommand({ TableName: 'Groups' }));
    const myGroupIds = (groupsData.Items || [])
      .filter(g => g.owner === username || (g.members || []).includes(username))
      .map(g => g.groupId);
    const myGroupSet = new Set(myGroupIds);

    // Securely filter out deleted messages and messages that do not belong to this user
    allItems = allItems.filter(m => {
      // 1. Filter out deleted messages
      if (deletedSet.has(m.messageId)) return false;

      // 2. Filter DM messages: the user's username must be one of the participants
      if (m.roomId && m.roomId.startsWith('dm_')) {
        const parts = m.roomId.replace('dm_', '').split('_');
        return parts.includes(username);
      }

      // 3. Filter Group messages: the user must be a member of the group
      if (m.roomId) {
        return myGroupSet.has(m.roomId);
      }

      return false;
    });

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
        let allItems = [];
        let lastKey = undefined;

        // Support both orders of usernames in DM room IDs to clear legacy messages
        let filterExpression = "roomId = :r";
        let expressionValues = { ":r": roomId };

        if (roomId.startsWith('dm_')) {
            const parts = roomId.replace('dm_', '').split('_');
            if (parts.length === 2) {
                const altRoomId = `dm_${parts[1]}_${parts[0]}`;
                if (altRoomId !== roomId) {
                    filterExpression = "roomId = :r1 OR roomId = :r2";
                    expressionValues = { ":r1": roomId, ":r2": altRoomId };
                }
            }
        }

        do {
            const params = {
                TableName: 'Messages',
                FilterExpression: filterExpression,
                ExpressionAttributeValues: expressionValues,
                ExclusiveStartKey: lastKey,
            };
            const data = await docClient.send(new ScanCommand(params));
            allItems = allItems.concat(data.Items || []);
            lastKey = data.LastEvaluatedKey;
        } while (lastKey);
        
        const msgIdsInRoom = allItems.map(m => m.messageId);
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

// ====== P0: READ RECEIPTS — Mark messages as read ======
exports.markAsRead = async (req, res) => {
    const { messageIds, username } = req.body;
    if (!messageIds || !Array.isArray(messageIds) || !username) {
        return res.status(400).json({ error: 'messageIds (array) and username are required' });
    }

    try {
        // Batch update readBy for each message (limit to 20 per request to avoid overload)
        const idsToProcess = messageIds.slice(0, 20);
        const updatePromises = idsToProcess.map(async (messageId) => {
            try {
                const msgData = await docClient.send(new GetCommand({ TableName: 'Messages', Key: { messageId } }));
                if (!msgData.Item) return null;

                let readBy = msgData.Item.readBy || [];
                if (readBy.includes(username)) return null; // Already read

                readBy.push(username);
                await docClient.send(new UpdateCommand({
                    TableName: 'Messages',
                    Key: { messageId },
                    UpdateExpression: "set readBy = :r",
                    ExpressionAttributeValues: { ":r": readBy }
                }));

                return { messageId, readBy };
            } catch (e) {
                console.error(`Error marking message ${messageId} as read:`, e);
                return null;
            }
        });

        const results = (await Promise.all(updatePromises)).filter(Boolean);

        // Emit read receipt updates via socket
        if (req.app.get('io') && results.length > 0) {
            req.app.get('io').emit('messages_read', {
                messageIds: results.map(r => r.messageId),
                readBy: results.map(r => ({ messageId: r.messageId, readBy: r.readBy })),
                reader: username,
            });
        }

        res.json({ success: true, updated: results.length });
    } catch (err) {
        res.status(500).json({ error: 'Error marking messages as read' });
    }
};

exports.getRoomMedia = async (req, res) => {
    const { roomId } = req.params;
    try {
        const data = await docClient.send(new ScanCommand({
            TableName: 'Messages',
            FilterExpression: "roomId = :r AND isRevoked <> :true",
            ExpressionAttributeValues: { 
                ":r": roomId,
                ":true": true
            }
        }));

        const items = data.Items || [];
        const urlRegex = /((?:https?:\/\/|www\.)[^\s]+|[a-zA-Z0-9.-]+\.(?:com|net|org|vn|edu|gov|io)[^\s]*)/g;

        const media = items.filter(m => m.fileData && (m.fileType === 'image' || m.fileType === 'video'))
            .map(m => ({ messageId: m.messageId, fileData: m.fileData, fileType: m.fileType, sentAt: m.sentAt, senderUsername: m.senderUsername }));
            
        const files = items.filter(m => m.fileData && m.fileType !== 'image' && m.fileType !== 'video')
            .map(m => ({ messageId: m.messageId, fileData: m.fileData, fileName: m.fileName, fileType: m.fileType, sentAt: m.sentAt, senderUsername: m.senderUsername }));

        const links = [];
        items.forEach(m => {
            if (m.text) {
                const matches = m.text.match(urlRegex);
                if (matches) {
                    matches.forEach(url => {
                        links.push({ messageId: m.messageId, url: url.replace(/\.+$/, '').trim(), sentAt: m.sentAt, senderUsername: m.senderUsername, text: m.text });
                    });
                }
            }
        });

        res.json({
            media: media.sort((a, b) => b.sentAt - a.sentAt),
            files: files.sort((a, b) => b.sentAt - a.sentAt),
            links: links.sort((a, b) => b.sentAt - a.sentAt)
        });
    } catch (err) {
        console.error("GetRoomMedia error:", err);
        res.status(500).json({ error: "Could not fetch room media" });
    }
};

exports.reportMessage = async (req, res) => {
    try {
        const { messageId, reason } = req.body;
        const reporterUsername = req.auth ? req.auth.username : (req.user ? req.user.username : 'user');
        
        if (!messageId || !reason) {
            return res.status(400).json({ error: "Missing messageId or reason" });
        }
        
        // Fetch message details
        const msgData = await docClient.send(new GetCommand({ TableName: 'Messages', Key: { messageId } }));
        if (!msgData.Item) {
            return res.status(404).json({ error: "Message not found" });
        }
        
        const reportId = Date.now().toString() + "_" + Math.random().toString(36).substr(2, 5);
        const reportItem = {
            reportId,
            messageId,
            messageSender: msgData.Item.senderUsername || msgData.Item.sender || "unknown",
            messageText: msgData.Item.text || "[Tệp tin đính kèm]",
            messageRoomId: msgData.Item.roomId || "chung",
            reporterUsername: reporterUsername || "user",
            reason,
            status: "pending",
            createdAt: new Date().toISOString()
        };
        
        await docClient.send(new PutCommand({ TableName: 'Reports', Item: reportItem }));
        
        res.json({ success: true, report: reportItem });
    } catch (err) {
        console.error("Report message error:", err);
        res.status(500).json({ error: "Could not report message" });
    }
};