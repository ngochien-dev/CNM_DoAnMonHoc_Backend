const activeCalls = new Map();
const userCallIndex = new Map();

function clearCallTimeout(call) {
    if (call?.timeoutHandle) {
        clearTimeout(call.timeoutHandle);
        call.timeoutHandle = null;
    }
}

function createActiveCall(callData) {
    const call = {
        ...callData,
        timeoutHandle: null,
    };

    activeCalls.set(call.callId, call);
    userCallIndex.set(call.callerUsername, call.callId);
    userCallIndex.set(call.calleeUsername, call.callId);

    return call;
}

function getActiveCall(callId) {
    return activeCalls.get(callId) || null;
}

function getActiveCallForUser(username) {
    const callId = userCallIndex.get(username);
    if (!callId) return null;
    return getActiveCall(callId);
}

function isUserBusy(username) {
    return userCallIndex.has(username);
}

function setCallTimeout(callId, timeoutHandle) {
    const call = getActiveCall(callId);
    if (!call) return null;
    clearCallTimeout(call);
    call.timeoutHandle = timeoutHandle;
    return call;
}

function patchActiveCall(callId, patch) {
    const call = getActiveCall(callId);
    if (!call) return null;
    Object.assign(call, patch);
    return call;
}

function removeActiveCall(callId) {
    const call = getActiveCall(callId);
    if (!call) return null;

    clearCallTimeout(call);
    activeCalls.delete(callId);

    [call.callerUsername, call.calleeUsername].forEach((username) => {
        if (userCallIndex.get(username) === callId) {
            userCallIndex.delete(username);
        }
    });

    return call;
}

function getPeerUsername(call, username) {
    if (!call) return null;
    return call.callerUsername === username ? call.calleeUsername : call.callerUsername;
}

module.exports = {
    clearCallTimeout,
    createActiveCall,
    getActiveCall,
    getActiveCallForUser,
    getPeerUsername,
    isUserBusy,
    patchActiveCall,
    removeActiveCall,
    setCallTimeout,
};