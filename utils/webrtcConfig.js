const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

function parseUrlList(rawValue = '') {
    return String(rawValue || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
}

function buildIceServers({ stunUrls = [], turnUrls = [], turnUsername = '', turnCredential = '' } = {}) {
    const normalizedStunUrls = stunUrls.length ? stunUrls : DEFAULT_STUN_URLS;
    const iceServers = normalizedStunUrls.map((url) => ({ urls: url }));

    if (turnUrls.length) {
        iceServers.push({
            urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls,
            username: turnUsername,
            credential: turnCredential,
        });
    }

    return iceServers;
}

function getClientWebRTCConfig() {
    const stunUrls = parseUrlList(process.env.WEBRTC_STUN_URLS);
    const turnUrls = parseUrlList(process.env.WEBRTC_TURN_URLS || process.env.WEBRTC_TURN_URL);

    return {
        iceServers: buildIceServers({
            stunUrls,
            turnUrls,
            turnUsername: process.env.WEBRTC_TURN_USERNAME || '',
            turnCredential: process.env.WEBRTC_TURN_CREDENTIAL || '',
        }),
        ringTimeoutMs: Number(process.env.CALL_RING_TIMEOUT_MS) || 30000,
    };
}

module.exports = {
    buildIceServers,
    getClientWebRTCConfig,
    parseUrlList,
};