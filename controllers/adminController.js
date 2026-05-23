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

    // 1. User stats
    const totalUsers = users.length;
    const bannedUsers = users.filter(u => u.isBanned).length;
    const activeUsers = totalUsers - bannedUsers;

    // 2. Data Distribution (File Types vs Text vs Polls)
    let textCount = 0;
    let imageCount = 0;
    let videoCount = 0;
    let fileCount = 0;
    let pollCount = 0;

    // 3. Temporal Data (Messages per day/month based on range)
    const rangeParam = req.query.range ? parseInt(req.query.range) : 7;
    const isMonthly = rangeParam > 30;
    
    // Initialize temporal map
    const temporalMap = {};
    if (isMonthly) {
      const months = rangeParam === 180 ? 6 : 12;
      for (let i = months - 1; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const dateStr = d.toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' });
        temporalMap[dateStr] = 0;
      }
    } else {
      for (let i = rangeParam - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
        temporalMap[dateStr] = 0;
      }
    }

    const cutoffDate = new Date();
    if (isMonthly) {
        cutoffDate.setMonth(cutoffDate.getMonth() - (rangeParam === 180 ? 6 : 12));
    } else {
        cutoffDate.setDate(cutoffDate.getDate() - rangeParam);
    }

    const userActivity = {};

    messages.forEach(m => {
      // Data Distribution
      if (m.msgType === 'poll') {
        pollCount++;
      } else if (m.fileType) {
        if (m.fileType.startsWith('image/')) imageCount++;
        else if (m.fileType.startsWith('video/')) videoCount++;
        else fileCount++;
      } else {
        textCount++;
      }

      // Temporal Data
      if (m.createdAt) {
        const d = new Date(m.createdAt);
        if (d >= cutoffDate) {
          const dateStr = isMonthly 
            ? d.toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' })
            : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
          if (temporalMap[dateStr] !== undefined) {
            temporalMap[dateStr]++;
          }
        }
      }

      // User Activity
      userActivity[m.senderUsername] = (userActivity[m.senderUsername] || 0) + 1;
    });

    const chartData = [
      { name: 'Văn bản', value: textCount },
      { name: 'Hình ảnh', value: imageCount },
      { name: 'Video', value: videoCount },
      { name: 'Tài liệu', value: fileCount },
      { name: 'Bình chọn', value: pollCount }
    ].filter(item => item.value > 0);

    const activityChartData = Object.keys(temporalMap).map(date => ({
      date,
      messages: temporalMap[date]
    }));

    // Top Users & maxCount
    const sortedUsers = Object.keys(userActivity)
      .map(username => {
        const uInfo = users.find(u => u.username === username);
        return {
          name: uInfo ? uInfo.displayName : username,
          count: userActivity[username]
        };
      })
      .sort((a, b) => b.count - a.count);
    
    const topUsers = sortedUsers.slice(0, 5);
    const topUserMaxCount = topUsers.length > 0 ? topUsers[0].count : 1;

    const presenceStore = require('../store/presenceStore');

    res.json({
      totalUsers,
      activeUsers,
      bannedUsers,
      totalMessages: messages.length,
      onlineNow: presenceStore.getOnlineCount(),
      totalGroups: groups.length,
      chartData,
      activityChartData,
      topUsers,
      topUserMaxCount
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
