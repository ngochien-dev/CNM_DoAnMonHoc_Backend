const docClient = require('../awsConfig');
const { ScanCommand, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const bcrypt = require('bcryptjs');

const getStats = async (req, res) => {
  try {
    const usersData = await docClient.send(new ScanCommand({ TableName: 'Users' }));
    const messagesData = await docClient.send(new ScanCommand({ TableName: 'Messages' }));
    const groupsData = await docClient.send(new ScanCommand({ TableName: 'Groups' }));

    const users = usersData.Items || [];
    const messages = messagesData.Items || [];
    const groups = groupsData.Items || [];

    const groupDict = {
      chung: 'Kênh Chung'
    };

    groups.forEach(g => {
      groupDict[g.groupId] = g.groupName;
    });

    const statsMap = {};
    messages.forEach(m => {
      const rId = m.roomId || 'chung';
      if (groupDict[rId] || rId.startsWith('dm_')) {
        const rName = groupDict[rId] || 'Chat Riêng';
        statsMap[rName] = (statsMap[rName] || 0) + 1;
      }
    });

    const chartData = Object.keys(statsMap).map(name => ({
      name,
      value: statsMap[name]
    }));

    const userActivity = {};
    messages.forEach(m => {
      userActivity[m.senderUsername] = (userActivity[m.senderUsername] || 0) + 1;
    });

    const topUsers = Object.keys(userActivity)
      .map(username => {
        const uInfo = users.find(u => u.username === username);
        return {
          name: uInfo ? uInfo.displayName : username,
          count: userActivity[username]
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Using presenceStore to get online count if needed, or io instance.
    // For now, since onlineNow was getting length of onlineUsers, we can return a placeholder or get it.
    const presenceStore = require('../store/presenceStore');

    res.json({
      totalUsers: users.length,
      totalMessages: messages.length,
      onlineNow: presenceStore.getOnlineUsers().length,
      totalGroups: groups.length,
      chartData,
      topUsers
    });
  } catch (err) {
    console.error(err);
    res.status(500).json(err);
  }
};

const getUsersList = async (req, res) => {
  try {
    // Only admin can call this
    if (req.auth && req.auth.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. Admin only." });
    }

    const data = await docClient.send(new ScanCommand({ TableName: 'Users' }));
    // exclude passwords
    const users = (data.Items || []).map(u => {
        const { password, ...rest } = u;
        return rest;
    });

    res.json(users);
  } catch (err) {
    res.status(500).json(err);
  }
};

const toggleUserStatus = async (req, res) => {
  try {
    if (req.auth && req.auth.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. Admin only." });
    }

    const { targetUsername, isBanned } = req.body;
    if (!targetUsername) return res.status(400).json({ error: "Missing target username" });

    const userData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: targetUsername } }));
    if (!userData.Item) return res.status(404).json({ error: "User not found" });

    if (userData.Item.role === 'admin') {
      return res.status(400).json({ error: "Cannot ban an admin user" });
    }

    await docClient.send(new UpdateCommand({
      TableName: 'Users',
      Key: { username: targetUsername },
      UpdateExpression: "set isBanned = :b",
      ExpressionAttributeValues: { ":b": isBanned }
    }));

    if (isBanned && req.app.get('io')) {
        req.app.get('io').emit('force_logout', { username: targetUsername, reason: 'banned' });
    }

    res.json({ success: true, isBanned });
  } catch (err) {
    res.status(500).json(err);
  }
};

const resetUserPassword = async (req, res) => {
  try {
    if (req.auth && req.auth.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. Admin only." });
    }

    const { targetUsername } = req.body;
    if (!targetUsername) return res.status(400).json({ error: "Missing target username" });

    const newPassword = "OttUser@123";
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await docClient.send(new UpdateCommand({
      TableName: 'Users',
      Key: { username: targetUsername },
      UpdateExpression: "set password = :p",
      ExpressionAttributeValues: { ":p": hashedPassword }
    }));

    if (req.app.get('io')) {
        req.app.get('io').emit('force_logout', { username: targetUsername, reason: 'password_reset' });
    }

    res.json({ success: true, newPassword });
  } catch (err) {
    res.status(500).json(err);
  }
};

const getReports = async (req, res) => {
  try {
    if (req.auth && req.auth.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. Admin only." });
    }

    const data = await docClient.send(new ScanCommand({ TableName: 'Reports' }));
    const reports = data.Items || [];
    
    // Sort reports by createdAt descending
    reports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(reports);
  } catch (err) {
    console.error("getReports error:", err);
    res.status(500).json(err);
  }
};

const resolveReport = async (req, res) => {
  try {
    if (req.auth && req.auth.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. Admin only." });
    }

    const { reportId } = req.params;
    const { action } = req.body; // 'dismiss', 'delete_message', 'ban_sender'
    if (!reportId || !action) {
      return res.status(400).json({ error: "Missing reportId or action" });
    }

    // Get report info
    const reportData = await docClient.send(new GetCommand({ TableName: 'Reports', Key: { reportId } }));
    if (!reportData.Item) {
      return res.status(404).json({ error: "Report not found" });
    }
    const report = reportData.Item;
    const { messageId, messageSender, targetRoomId } = report;

    if (action === 'dismiss') {
      await docClient.send(new UpdateCommand({
        TableName: 'Reports',
        Key: { reportId },
        UpdateExpression: "set #s = :status",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":status": "resolved_dismissed" }
      }));
    } else if (action === 'delete_message') {
      // 1. Mark message as revoked/deleted in Messages table (if messageId exists)
      if (messageId) {
        await docClient.send(new UpdateCommand({
          TableName: 'Messages',
          Key: { messageId },
          UpdateExpression: 'set #t = :txt, isRevoked = :rev, fileData = :f, fileType = :ft',
          ExpressionAttributeNames: { '#t': 'text' },
          ExpressionAttributeValues: {
            ':txt': 'Tin nhắn này đã bị ẩn bởi Admin do vi phạm tiêu chuẩn cộng đồng',
            ':rev': true,
            ':f': null,
            ':ft': null
          }
        }));

        // 2. Emit real-time revoke to all clients via Socket.io
        if (req.app.get('io')) {
          req.app.get('io').emit('message_revoked', messageId);
        }
      } else if (targetRoomId && targetRoomId.startsWith('group_')) {
        // Disable the group
        await docClient.send(new UpdateCommand({
          TableName: 'Groups',
          Key: { groupId: targetRoomId },
          UpdateExpression: "set isDisabled = :d",
          ExpressionAttributeValues: { ":d": true }
          }));
        if (req.app.get('io')) {
          req.app.get('io').emit('groups_updated');
        }
      }

      // 3. Update report status
      await docClient.send(new UpdateCommand({
        TableName: 'Reports',
        Key: { reportId },
        UpdateExpression: "set #s = :status",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":status": "resolved_deleted" }
      }));
    } else if (action === 'ban_sender') {
      // 1. Ban the user in Users table
      if (messageSender && messageSender !== 'admin' && messageSender !== 'system') {
        const userData = await docClient.send(new GetCommand({ TableName: 'Users', Key: { username: messageSender } }));
        if (userData.Item && userData.Item.role !== 'admin') {
          await docClient.send(new UpdateCommand({
            TableName: 'Users',
            Key: { username: messageSender },
            UpdateExpression: "set isBanned = :b",
            ExpressionAttributeValues: { ":b": true }
          }));

          // Force logout the banned sender instantly via socket
          if (req.app.get('io')) {
            req.app.get('io').emit('force_logout', { username: messageSender, reason: 'banned' });
          }
        }
      }

      // 2. Mark message as revoked/deleted in Messages table (if messageId exists)
      if (messageId) {
        await docClient.send(new UpdateCommand({
          TableName: 'Messages',
          Key: { messageId },
          UpdateExpression: 'set #t = :txt, isRevoked = :rev, fileData = :f, fileType = :ft',
          ExpressionAttributeNames: { '#t': 'text' },
          ExpressionAttributeValues: {
            ':txt': 'Tin nhắn này đã bị ẩn bởi Admin do vi phạm tiêu chuẩn cộng đồng',
            ':rev': true,
            ':f': null,
            ':ft': null
          }
        }));

        // Emit real-time revoke to all clients via Socket.io
        if (req.app.get('io')) {
          req.app.get('io').emit('message_revoked', messageId);
        }
      } else if (targetRoomId && targetRoomId.startsWith('group_')) {
        // Disable the group
        await docClient.send(new UpdateCommand({
          TableName: 'Groups',
          Key: { groupId: targetRoomId },
          UpdateExpression: "set isDisabled = :d",
          ExpressionAttributeValues: { ":d": true }
        }));
        if (req.app.get('io')) {
          req.app.get('io').emit('groups_updated');
        }
      }

      // 3. Update report status
      await docClient.send(new UpdateCommand({
        TableName: 'Reports',
        Key: { reportId },
        UpdateExpression: "set #s = :status",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":status": "resolved_banned" }
      }));
    }

    res.json({ success: true });
  } catch (err) {
    console.error("resolveReport error:", err);
    res.status(500).json(err);
  }
};

module.exports = {
  getStats,
  getUsersList,
  toggleUserStatus,
  resetUserPassword,
  getReports,
  resolveReport
};
