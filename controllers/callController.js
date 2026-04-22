const CallService = require('../services/callService');
const { getClientWebRTCConfig } = require('../utils/webrtcConfig');

exports.getHistory = async (req, res) => {
    try {
        const requestedLimit = Number(req.query.limit);
        const limit = Number.isFinite(requestedLimit)
            ? Math.max(1, Math.min(requestedLimit, 50))
            : 20;
        const history = await CallService.getHistoryForUser(req.auth.username, limit);

        res.json({
            items: history,
            limit,
        });
    } catch (error) {
        res.status(500).json({
            message: 'Could not load call history.',
            error: error.message,
        });
    }
};

exports.getClientConfig = async (_req, res) => {
    try {
        return res.json(getClientWebRTCConfig());
    } catch (error) {
        return res.status(500).json({
            message: 'Could not load call configuration.',
            error: error.message,
        });
    }
};

exports.getCallById = async (req, res) => {
    try {
        const call = await CallService.getCallById(req.params.callId);
        if (!call || !call.participants?.includes(req.auth.username)) {
            return res.status(404).json({ message: 'Call not found.' });
        }

        return res.json(call);
    } catch (error) {
        return res.status(500).json({
            message: 'Could not load call detail.',
            error: error.message,
        });
    }
};