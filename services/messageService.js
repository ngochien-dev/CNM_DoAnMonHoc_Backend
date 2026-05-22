const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient();

const TABLE_NAME = 'Messages';

// Simple search by content
exports.searchByContent = async (content) => {
  try {
    const params = {
      TableName: TABLE_NAME,
      FilterExpression: 'contains(content, :content)',
      ExpressionAttributeValues: { ':content': content }
    };
    const data = await docClient.scan(params).promise();
    return data.Items || [];
  } catch (err) {
    throw new Error('Error when searching: ' + err.message);
  }
};

// Advanced search with available filters
exports.advancedSearch = async ({ content, senderId, channelId, beforeDate, afterDate }) => {
  try {
    let filter = [];
    let values = {};

    if (content) {
      filter.push('contains(content, :content)');
      values[':content'] = content;
    }
    if (senderId) {
      filter.push('senderId = :senderId');
      values[':senderId'] = senderId;
    }
    if (channelId) {
      filter.push('channelId = :channelId');
      values[':channelId'] = channelId;
    }
    if (beforeDate) {
      filter.push('sentAt <= :beforeDate');
      values[':beforeDate'] = new Date(beforeDate).getTime();
    }
    if (afterDate) {
      filter.push('sentAt >= :afterDate');
      values[':afterDate'] = new Date(afterDate).getTime();
    }

    const params = {
      TableName: TABLE_NAME,
      FilterExpression: filter.length ? filter.join(' AND ') : undefined,
      ExpressionAttributeValues: Object.keys(values).length ? values : undefined
    };
    
    const data = await docClient.scan(params).promise();
    return data.Items || [];
  } catch (err) {
    throw new Error('Error during advanced search: ' + err.message);
  }
};

// Search messages from specific user
exports.searchByUser = async (senderId, content) => {
  try {
    let filter = ['senderId = :senderId'];
    let values = { ':senderId': senderId };

    if (content) {
      filter.push('contains(content, :content)');
      values[':content'] = content;
    }

    const params = {
      TableName: TABLE_NAME,
      FilterExpression: filter.join(' AND '),
      ExpressionAttributeValues: values
    };

    const data = await docClient.scan(params).promise();
    return data.Items || [];
  } catch (err) {
    throw new Error('Error when searching by user: ' + err.message);
  }
};

// Search messages with attachments (tệp)
exports.searchWithAttachments = async ({ content, channelId }) => {
  try {
    let filter = ['attribute_exists(attachments) AND size(attachments) > :zero'];
    let values = { ':zero': 0 };

    if (content) {
      filter.push('contains(content, :content)');
      values[':content'] = content;
    }
    if (channelId) {
      filter.push('channelId = :channelId');
      values[':channelId'] = channelId;
    }

    const params = {
      TableName: TABLE_NAME,
      FilterExpression: filter.join(' AND '),
      ExpressionAttributeValues: values
    };

    const data = await docClient.scan(params).promise();
    return data.Items || [];
  } catch (err) {
    throw new Error('Error when searching messages with attachments: ' + err.message);
  }
};

// Search messages with links (chứa url)
exports.searchWithLinks = async ({ content, channelId }) => {
  try {
    // Regex pattern to match URLs
    const urlPattern = /(https?:\/\/[^\s]+)/i;
    
    let filter = [];
    let values = {};

    // Get all messages first, then filter in-app
    const params = {
      TableName: TABLE_NAME,
      FilterExpression: channelId ? 'channelId = :channelId' : undefined,
      ExpressionAttributeValues: channelId ? { ':channelId': channelId } : undefined
    };

    const data = await docClient.scan(params).promise();
    
    // Filter messages that contain URLs
    let messages = data.Items.filter(msg => 
      urlPattern.test(msg.content || '')
    );

    // Additional filter by content if provided
    if (content) {
      messages = messages.filter(msg => 
        msg.content.toLowerCase().includes(content.toLowerCase())
      );
    }

    return messages;
  } catch (err) {
    throw new Error('Error when searching messages with links: ' + err.message);
  }
};

// Search by date range
exports.searchByDateRange = async ({ startDate, endDate, content, channelId }) => {
  try {
    let filter = [];
    let values = {};

    if (startDate && endDate) {
      filter.push('sentAt BETWEEN :startDate AND :endDate');
      values[':startDate'] = new Date(startDate).getTime();
      values[':endDate'] = new Date(endDate).getTime();
    }

    if (content) {
      filter.push('contains(content, :content)');
      values[':content'] = content;
    }

    if (channelId) {
      filter.push('channelId = :channelId');
      values[':channelId'] = channelId;
    }

    const params = {
      TableName: TABLE_NAME,
      FilterExpression: filter.length ? filter.join(' AND ') : undefined,
      ExpressionAttributeValues: Object.keys(values).length ? values : undefined
    };

    const data = await docClient.scan(params).promise();
    return data.Items || [];
  } catch (err) {
    throw new Error('Error when searching by date range: ' + err.message);
  }
};

// Search edited messages
exports.searchEditedMessages = async ({ content, channelId }) => {
  try {
    let filter = ['attribute_exists(editedAt)'];
    let values = {};

    if (content) {
      filter.push('contains(content, :content)');
      values[':content'] = content;
    }

    if (channelId) {
      filter.push('channelId = :channelId');
      values[':channelId'] = channelId;
    }

    const params = {
      TableName: TABLE_NAME,
      FilterExpression: filter.join(' AND '),
      ExpressionAttributeValues: Object.keys(values).length ? values : undefined
    };

    const data = await docClient.scan(params).promise();
    return data.Items || [];
  } catch (err) {
    throw new Error('Error when searching edited messages: ' + err.message);
  }
};

// Search pinned messages (đã ghim)
exports.searchPinnedMessages = async (channelId) => {
  try {
    let filter = ['isPinned = :pinned AND isRevoked <> :true'];
    let values = { ':pinned': true, ':true': true };

    if (channelId) {
      if (channelId.startsWith('dm_')) {
          const parts = channelId.replace('dm_', '').split('_');
          if (parts.length === 2) {
              const altRoomId = `dm_${parts[1]}_${parts[0]}`;
              if (altRoomId !== channelId) {
                  filter.push('(roomId = :r1 OR roomId = :r2)');
                  values[':r1'] = channelId;
                  values[':r2'] = altRoomId;
              } else {
                  filter.push('roomId = :roomId');
                  values[':roomId'] = channelId;
              }
          } else {
              filter.push('roomId = :roomId');
              values[':roomId'] = channelId;
          }
      } else {
          filter.push('roomId = :roomId');
          values[':roomId'] = channelId;
      }
    }

    const params = {
      TableName: TABLE_NAME,
      FilterExpression: filter.join(' AND '),
      ExpressionAttributeValues: values
    };

    const data = await docClient.scan(params).promise();
    return data.Items || [];
  } catch (err) {
    throw new Error('Error when searching pinned messages: ' + err.message);
  }
};

// Helper method to convert Message to SearchResponse
exports.convertToSearchResponse = (messages) => {
  return messages.map(message => ({
    messageId: message.messageId || message.id,
    content: message.content || message.text,
    sentAt: message.sentAt || message.createdAt || message.time,
    editedAt: message.editedAt || null,
    senderId: message.senderId || message.senderUsername,
    senderName: message.senderName || message.senderUsername,
    channelId: message.channelId || message.roomId,
    channelName: message.channelName || 'General',
    attachmentCount: (message.attachments ? message.attachments.length : (message.fileData ? 1 : 0)),
    hasAttachments: message.attachments ? message.attachments.length > 0 : !!message.fileData,
    pinned: message.pinned || message.isPinned || false
  }));
};