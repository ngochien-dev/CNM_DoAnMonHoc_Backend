const crypto = require('crypto');
const User = require('../models/userModel');
const CallModel = require('../models/callModel');
const activeCallsStore = require('../store/activeCalls');

const DEFAULT_RING_TIMEOUT_MS = Number(process.env.CALL_RING_TIMEOUT_MS) || 30000;
const SIGNALING_ALLOWED_STATUSES = new Set(['connecting', 'in_call']);

function logCall(message, context = {}) {
    console.log('[CALL]', message, context);
}

function buildDmRoomId(callerUsername, calleeUsername) {
    return `dm_${[callerUsername, calleeUsername].sort().join('_')}`;
}

function normalizeRoomId(callerUsername, calleeUsername, roomId) {
    return roomId || buildDmRoomId(callerUsername, calleeUsername);
}

function isValidDmRoom(roomId, callerUsername, calleeUsername) {
    return roomId === buildDmRoomId(callerUsername, calleeUsername);
}

function sanitizeUser(user) {
    if (!user) return null;
    return {
        username: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar || null,
        role: user.role || 'user',
    };
}

function serializeCall(call) {
    if (!call) return null;
    const { timeoutHandle, ...safeCall } = call;
    return safeCall;
}

function computeDurationSec(call) {
    if (!call?.answeredAt || !call?.endedAt) return 0;

    const answeredAt = new Date(call.answeredAt).getTime();
    const endedAt = new Date(call.endedAt).getTime();

    if (Number.isNaN(answeredAt) || Number.isNaN(endedAt)) {
        return 0;
    }

    return Math.max(0, Math.round((endedAt - answeredAt) / 1000));
}

async function persistCall(call) {
    const safeCall = serializeCall(call);
    if (!safeCall) return null;

    await CallModel.upsert(safeCall);
    return safeCall;
}

async function validateParticipants({ callerUsername, calleeUsername, roomId }) {
    if (!calleeUsername || callerUsername === calleeUsername) {
        return {
            ok: false,
            status: 'invalid',
            message: 'Caller and callee are not valid.',
        };
    }

    const [caller, callee] = await Promise.all([
        User.findByUsername(callerUsername),
        User.findByUsername(calleeUsername),
    ]);

    if (!caller || !caller.isVerified || !callee || !callee.isVerified) {
        return {
            ok: false,
            status: 'invalid',
            message: 'Caller or callee does not exist or is not verified.',
        };
    }

    const normalizedRoomId = normalizeRoomId(callerUsername, calleeUsername, roomId);
    const isFriend =
        (caller.friends || []).includes(calleeUsername) || (callee.friends || []).includes(callerUsername);
    const isValidRoom = isValidDmRoom(normalizedRoomId, callerUsername, calleeUsername);

    if (!isFriend && !isValidRoom) {
        return {
            ok: false,
            status: 'forbidden',
            message: 'Call is only allowed for a valid 1-1 room or an existing friend relation.',
        };
    }

    return {
        ok: true,
        caller,
        callee,
        roomId: normalizedRoomId,
    };
}

async function finalizeCall(callId, patch = {}) {
    const existingCall = activeCallsStore.getActiveCall(callId);
    if (!existingCall) return null;

    activeCallsStore.clearCallTimeout(existingCall);

    const finalizedCall = {
        ...serializeCall(existingCall),
        ...patch,
        endedAt: patch.endedAt || new Date().toISOString(),
    };

    finalizedCall.durationSec = computeDurationSec(finalizedCall);
    activeCallsStore.removeActiveCall(callId);
    await persistCall(finalizedCall);

    logCall('Finalized active call.', {
        callId,
        status: finalizedCall.status,
        endReason: finalizedCall.endReason,
        endedBy: finalizedCall.endedBy,
        durationSec: finalizedCall.durationSec,
    });

    return finalizedCall;
}

const CallService = {
    getRingTimeoutMs: () => DEFAULT_RING_TIMEOUT_MS,

    getActiveCall: (callId) => activeCallsStore.getActiveCall(callId),

    getActiveCallForUser: (username) => activeCallsStore.getActiveCallForUser(username),

    getPeerUsername: (call, username) => activeCallsStore.getPeerUsername(call, username),

    createInvite: async ({ callerUsername, calleeUsername, roomId, callType = 'video', isCalleeOnline }) => {
        logCall('Creating call invite.', {
            callerUsername,
            calleeUsername,
            roomId: roomId || null,
            isCalleeOnline,
        });

        const validation = await validateParticipants({ callerUsername, calleeUsername, roomId });
        if (!validation.ok) return validation;

        if (!isCalleeOnline) {
            return {
                ok: false,
                status: 'offline',
                message: 'The callee is offline and cannot receive the call.',
                caller: sanitizeUser(validation.caller),
                callee: sanitizeUser(validation.callee),
            };
        }

        if (activeCallsStore.isUserBusy(callerUsername)) {
            return {
                ok: false,
                status: 'busy',
                message: 'Caller is already in another active call.',
            };
        }

        if (activeCallsStore.isUserBusy(calleeUsername)) {
            return {
                ok: false,
                status: 'busy',
                message: 'Callee is already in another active call.',
            };
        }

        const createdAt = new Date().toISOString();
        const timeoutAt = new Date(Date.now() + DEFAULT_RING_TIMEOUT_MS).toISOString();
        const call = activeCallsStore.createActiveCall({
            callId: crypto.randomUUID(),
            roomId: validation.roomId,
            callerUsername,
            calleeUsername,
            participants: [callerUsername, calleeUsername],
            callType,
            status: 'ringing',
            createdAt,
            answeredAt: null,
            endedAt: null,
            timeoutAt,
            durationSec: 0,
            endedBy: null,
            endReason: null,
        });

        await persistCall(call);
        logCall('Created active ringing call.', {
            callId: call.callId,
            callerUsername,
            calleeUsername,
            roomId: validation.roomId,
            status: call.status,
        });

        return {
            ok: true,
            call: serializeCall(call),
            caller: sanitizeUser(validation.caller),
            callee: sanitizeUser(validation.callee),
        };
    },

    scheduleTimeout: (callId, onTimeout) => {
        const timeoutHandle = setTimeout(() => {
            onTimeout(callId).catch((error) => {
                console.error('[Call timeout] Failed to process call timeout:', error);
            });
        }, DEFAULT_RING_TIMEOUT_MS);

        activeCallsStore.setCallTimeout(callId, timeoutHandle);
        return DEFAULT_RING_TIMEOUT_MS;
    },

    clearCallTimeout: (callId) => {
        const call = activeCallsStore.getActiveCall(callId);
        if (call) {
            activeCallsStore.clearCallTimeout(call);
            logCall('Cleared call timeout manually.', { callId });
        }
    },

    acceptCall: async ({ callId, username }) => {
        logCall('Accepting active call.', {
            callId,
            username,
        });

        const call = activeCallsStore.getActiveCall(callId);
        if (!call) {
            return { ok: false, status: 'not_found', message: 'Call does not exist anymore.' };
        }

        if (call.calleeUsername !== username) {
            return { ok: false, status: 'forbidden', message: 'Only the callee can accept this call.' };
        }

        if (call.status !== 'ringing') {
            return { ok: false, status: 'invalid_state', message: 'Call is no longer ringing.' };
        }

        activeCallsStore.clearCallTimeout(call);
        const updatedCall = activeCallsStore.patchActiveCall(callId, {
            status: 'connecting',
            answeredAt: new Date().toISOString(),
        });

        await persistCall(updatedCall);
        logCall('Call moved to connecting state.', {
            callId,
            answeredAt: updatedCall.answeredAt,
        });
        return { ok: true, call: serializeCall(updatedCall) };
    },

    rejectCall: async ({ callId, username }) => {
        logCall('Rejecting active call.', {
            callId,
            username,
        });

        const call = activeCallsStore.getActiveCall(callId);
        if (!call) {
            return { ok: false, status: 'not_found', message: 'Call does not exist anymore.' };
        }

        if (call.calleeUsername !== username) {
            return { ok: false, status: 'forbidden', message: 'Only the callee can reject this call.' };
        }

        const finalizedCall = await finalizeCall(callId, {
            status: 'rejected',
            endedBy: username,
            endReason: 'rejected',
        });

        return { ok: true, call: finalizedCall };
    },

    timeoutCall: async (callId) => {
        const call = activeCallsStore.getActiveCall(callId);
        if (!call || call.status !== 'ringing') return null;

        return finalizeCall(callId, {
            status: 'missed',
            endedBy: call.calleeUsername,
            endReason: 'timeout',
        });
    },

    endCall: async ({ callId, username, reason = 'ended' }) => {
        logCall('Ending active call.', {
            callId,
            username,
            reason,
        });

        const call = activeCallsStore.getActiveCall(callId);
        if (!call) {
            return { ok: false, status: 'not_found', message: 'Call does not exist anymore.' };
        }

        if (!call.participants.includes(username)) {
            return { ok: false, status: 'forbidden', message: 'Only participants can end this call.' };
        }

        const finalizedCall = await finalizeCall(callId, {
            status: call.answeredAt ? 'ended' : 'cancelled',
            endedBy: username,
            endReason: reason,
        });

        return { ok: true, call: finalizedCall };
    },

    endCallForDisconnect: async (username) => {
        logCall('Checking active call cleanup for disconnect.', {
            username,
        });

        const call = activeCallsStore.getActiveCallForUser(username);
        if (!call) return null;

        const nextStatus =
            call.status === 'ringing'
                ? call.callerUsername === username
                    ? 'cancelled'
                    : 'missed'
                : 'ended';

        return finalizeCall(call.callId, {
            status: nextStatus,
            endedBy: username,
            endReason: 'disconnect',
        });
    },

    canRelaySignaling: ({ callId, username }) => {
        const call = activeCallsStore.getActiveCall(callId);
        if (!call) {
            logCall('Cannot relay signaling because call was not found.', {
                callId,
                username,
            });
            return {
                ok: false,
                status: 'not_found',
                message: 'Call does not exist anymore.',
            };
        }

        if (!call.participants.includes(username)) {
            logCall('Cannot relay signaling because user is not part of the call.', {
                callId,
                username,
            });
            return {
                ok: false,
                status: 'forbidden',
                message: 'User is not part of this call.',
            };
        }

        if (!SIGNALING_ALLOWED_STATUSES.has(call.status)) {
            logCall('Cannot relay signaling because call is in invalid state.', {
                callId,
                username,
                status: call.status,
            });
            return {
                ok: false,
                status: 'invalid_state',
                message: 'Call is not ready for WebRTC signaling relay.',
            };
        }

        return { ok: true, call };
    },

    markCallInProgress: async (callId) => {
        const call = activeCallsStore.getActiveCall(callId);
        if (!call || call.status === 'in_call') return call;

        const updatedCall = activeCallsStore.patchActiveCall(callId, {
            status: 'in_call',
        });

        await persistCall(updatedCall);
        logCall('Call moved to in_call state after answer relay.', {
            callId,
        });
        return updatedCall;
    },

    getHistoryForUser: async (username, limit = 20) => CallModel.getHistoryForUser(username, limit),

    getCallById: async (callId) => CallModel.findById(callId),
};

module.exports = CallService;
