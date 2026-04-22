const messageService = require('../services/messageService');

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