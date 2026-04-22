const docClient = require('../awsConfig');
const { ScanCommand } = require("@aws-sdk/lib-dynamodb");

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

module.exports = {
  getStats
};
