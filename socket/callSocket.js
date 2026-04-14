const CallService = require('../services/callService');
const presenceStore = require('../store/presenceStore');

function describeSessionDescription(description) {
    if (!description) return null;

    return {
        type: description.type || null,
        sdpLength: description.sdp?.length || 0,
    };
}

function describeCandidate(candidate) {
    if (!candidate) return null;

    const candidateLine = candidate.candidate || '';
    const typeMatch = candidateLine.match(/ typ ([^ ]+)/);

    return {
        type: typeMatch?.[1] || 'unknown',
        sdpMid: candidate.sdpMid ?? null,
        sdpMLineIndex: candidate.sdpMLineIndex ?? null,
    };
}

function logSocket(message, context = {}) {
    console.log('[SOCKET]', message, context);
}

function emitToUser(io, username, eventName, payload) {
    logSocket(`Emitting ${eventName} to user room.`, {
        username,
        callId: payload.callId ?? payload.call?.callId ?? null,
    });
    io.to(`user:${username}`).emit(eventName, payload);
}

function buildPeerPayload(call, recipientUsername) {
    const peerUsername = CallService.getPeerUsername(call, recipientUsername);
    return (
        presenceStore.getProfile(peerUsername) || {
            username: peerUsername,
            displayName: peerUsername,
            avatar: null,
            role: 'user',
        }
    );
}

function buildEventPayload(call, recipientUsername, extra = {}) {
    return {
        call,
        peer: buildPeerPayload(call, recipientUsername),
        ...extra,
    };
}

function relaySignalingEvent({ ack, eventName, io, payload = {}, socket, valueKey }) {
    if (!payload.callId || !payload[valueKey]) {
        ack({
            ok: false,
            status: 'invalid',
            message: `Missing ${valueKey || 'payload'} for ${eventName}.`,
        });
        return null;
    }

    const relayCheck = CallService.canRelaySignaling({
        callId: payload.callId,
        username: socket.user.username,
    });

    if (!relayCheck.ok) {
        logSocket(`Rejected ${eventName} relay.`, {
            callId: payload.callId,
            from: socket.user.username,
            status: relayCheck.status,
            message: relayCheck.message,
        });
        ack({
            ok: false,
            status: relayCheck.status,
            message: relayCheck.message,
        });
        return null;
    }

    const targetUsername = CallService.getPeerUsername(relayCheck.call, socket.user.username);
    logSocket(`Relaying ${eventName} to peer.`, {
        callId: payload.callId,
        from: socket.user.username,
        to: targetUsername,
        offer: valueKey === 'offer' ? describeSessionDescription(payload.offer) : null,
        answer: valueKey === 'answer' ? describeSessionDescription(payload.answer) : null,
        candidate: valueKey === 'candidate' ? describeCandidate(payload.candidate) : null,
    });

    emitToUser(io, targetUsername, eventName, {
        callId: payload.callId,
        from: socket.user.username,
        [valueKey]: payload[valueKey],
    });

    return relayCheck.call;
}

module.exports = function registerCallSocket({ io, socket }) {
    socket.on('call:invite', async (payload = {}, ack = () => {}) => {
        try {
            const calleeUsername = payload.calleeUsername;
            logSocket('Received call:invite.', {
                from: socket.user.username,
                calleeUsername,
                roomId: payload.roomId || null,
            });
            const result = await CallService.createInvite({
                callerUsername: socket.user.username,
                calleeUsername,
                roomId: payload.roomId,
                callType: 'video',
                isCalleeOnline: presenceStore.isOnline(calleeUsername),
            });

            if (!result.ok) {
                const failurePayload = {
                    status: result.status,
                    message: result.message,
                    calleeUsername,
                };

                return ack({ ok: false, ...failurePayload });
            }

            // The server owns the ringing timeout so the frontend can stay stateless.
            const timeoutMs = CallService.scheduleTimeout(result.call.callId, async (callId) => {
                const timedOutCall = await CallService.timeoutCall(callId);
                if (!timedOutCall) return;

                emitToUser(
                    io,
                    timedOutCall.callerUsername,
                    'call:timeout',
                    buildEventPayload(timedOutCall, timedOutCall.callerUsername, {
                        message: 'The callee did not answer before timeout.',
                    }),
                );

                emitToUser(
                    io,
                    timedOutCall.calleeUsername,
                    'call:timeout',
                    buildEventPayload(timedOutCall, timedOutCall.calleeUsername, {
                        message: 'The incoming call timed out.',
                    }),
                );
            });

            emitToUser(
                io,
                result.call.calleeUsername,
                'call:incoming',
                buildEventPayload(result.call, result.call.calleeUsername, {
                    caller: result.caller,
                    timeoutMs,
                }),
            );

            return ack({
                ok: true,
                call: result.call,
                callee: result.callee,
                timeoutMs,
            });
        } catch (error) {
            console.error('[call:invite] Error:', error);
            return ack({ ok: false, status: 'failed', message: 'Could not start the call.' });
        }
    });

    socket.on('call:accept', async ({ callId } = {}, ack = () => {}) => {
        try {
            logSocket('Received call:accept.', {
                callId,
                username: socket.user.username,
            });
            const result = await CallService.acceptCall({
                callId,
                username: socket.user.username,
            });

            if (!result.ok) {
                return ack(result);
            }

            emitToUser(
                io,
                result.call.callerUsername,
                'call:accepted',
                buildEventPayload(result.call, result.call.callerUsername, {
                    acceptedBy: result.call.calleeUsername,
                }),
            );

            emitToUser(
                io,
                result.call.calleeUsername,
                'call:accepted',
                buildEventPayload(result.call, result.call.calleeUsername, {
                    acceptedBy: result.call.calleeUsername,
                }),
            );

            return ack({ ok: true, call: result.call });
        } catch (error) {
            console.error('[call:accept] Error:', error);
            return ack({ ok: false, status: 'failed', message: 'Could not accept the call.' });
        }
    });

    socket.on('call:reject', async ({ callId } = {}, ack = () => {}) => {
        try {
            logSocket('Received call:reject.', {
                callId,
                username: socket.user.username,
            });
            const result = await CallService.rejectCall({
                callId,
                username: socket.user.username,
            });

            if (!result.ok) {
                return ack(result);
            }

            emitToUser(
                io,
                result.call.callerUsername,
                'call:rejected',
                buildEventPayload(result.call, result.call.callerUsername, {
                    message: 'The callee rejected the call.',
                }),
            );

            emitToUser(
                io,
                result.call.calleeUsername,
                'call:rejected',
                buildEventPayload(result.call, result.call.calleeUsername, {
                    message: 'You rejected the call.',
                }),
            );

            return ack({ ok: true, call: result.call });
        } catch (error) {
            console.error('[call:reject] Error:', error);
            return ack({ ok: false, status: 'failed', message: 'Could not reject the call.' });
        }
    });

    socket.on('call:end', async ({ callId, reason } = {}, ack = () => {}) => {
        try {
            logSocket('Received call:end.', {
                callId,
                username: socket.user.username,
                reason: reason || 'ended',
            });
            const result = await CallService.endCall({
                callId,
                username: socket.user.username,
                reason: reason || 'ended',
            });

            if (!result.ok) {
                return ack(result);
            }

            for (const participant of result.call.participants) {
                emitToUser(
                    io,
                    participant,
                    'call:ended',
                    buildEventPayload(result.call, participant, {
                        reason: result.call.endReason,
                    }),
                );
            }

            return ack({ ok: true, call: result.call });
        } catch (error) {
            console.error('[call:end] Error:', error);
            return ack({ ok: false, status: 'failed', message: 'Could not end the call.' });
        }
    });

    socket.on('webrtc:offer', ({ callId, offer } = {}, ack = () => {}) => {
        logSocket('Received webrtc:offer.', {
            callId,
            from: socket.user.username,
            offer: describeSessionDescription(offer),
        });
        // Only authenticated participants of the active call can relay SDP/ICE.
        const call = relaySignalingEvent({
            ack,
            eventName: 'webrtc:offer',
            io,
            payload: { callId, offer },
            socket,
            valueKey: 'offer',
        });

        if (!call) return;
        ack({ ok: true });
    });

    socket.on('webrtc:answer', async ({ callId, answer } = {}, ack = () => {}) => {
        try {
            logSocket('Received webrtc:answer.', {
                callId,
                from: socket.user.username,
                answer: describeSessionDescription(answer),
            });
            const call = relaySignalingEvent({
                ack,
                eventName: 'webrtc:answer',
                io,
                payload: { callId, answer },
                socket,
                valueKey: 'answer',
            });

            if (!call) return;

            await CallService.markCallInProgress(callId);
            ack({ ok: true });
        } catch (error) {
            console.error('[webrtc:answer] Error:', error);
            ack({ ok: false, status: 'failed', message: 'Could not relay WebRTC answer.' });
        }
    });

    socket.on('webrtc:ice-candidate', ({ callId, candidate } = {}, ack = () => {}) => {
        logSocket('Received webrtc:ice-candidate.', {
            callId,
            from: socket.user.username,
            candidate: describeCandidate(candidate),
        });
        const call = relaySignalingEvent({
            ack,
            eventName: 'webrtc:ice-candidate',
            io,
            payload: { callId, candidate },
            socket,
            valueKey: 'candidate',
        });

        if (!call) return;
        ack({ ok: true });
    });

    socket.on('disconnect', async () => {
        try {
            logSocket('Socket disconnected for call namespace handler.', {
                username: socket.user.username,
                socketId: socket.id,
            });

            if (presenceStore.isOnline(socket.user.username)) return;

            const finalizedCall = await CallService.endCallForDisconnect(socket.user.username);
            if (!finalizedCall) return;

            // Only close the call when the user has gone fully offline.
            for (const participant of finalizedCall.participants) {
                emitToUser(
                    io,
                    participant,
                    'call:ended',
                    buildEventPayload(finalizedCall, participant, {
                        reason: finalizedCall.endReason,
                    }),
                );
            }
        } catch (error) {
            console.error('[call disconnect] Error:', error);
        }
    });
};
