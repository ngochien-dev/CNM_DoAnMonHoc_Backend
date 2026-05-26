const CallService = require('../services/callService');
const presenceStore = require('../store/presenceStore');
const CALL_DEBUG_ENABLED = process.env.CALL_DEBUG !== 'false';

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
    if (!CALL_DEBUG_ENABLED) return;
    console.log('[SOCKET]', message, context);
}

function debugCall(eventName, data = {}) {
    if (!CALL_DEBUG_ENABLED) return;
    console.log('[CALL][BACKEND]', eventName, data);
}

function warnCall(eventName, data = {}) {
    if (!CALL_DEBUG_ENABLED) return;
    console.warn('[CALL][BACKEND]', eventName, data);
}

function errorCall(eventName, error, data = {}) {
    console.error('[CALL][BACKEND]', eventName, {
        ...data,
        error: {
            name: error?.name || null,
            message: error?.message || null,
            stack: error?.stack || null,
        },
    });
}

const CALL_EVENTS = {
    invite: 'call-user',
    incoming: 'incoming-call',
    accept: 'accept-call',
    reject: 'reject-call',
    end: 'end-call',
    ended: 'call-ended',
    offer: 'offer',
    answer: 'answer',
    iceCandidate: 'ice-candidate',
};

const LEGACY_CALL_EVENTS = {
    invite: 'call:invite',
    incoming: 'call:incoming',
    accept: 'call:accept',
    accepted: 'call:accepted',
    reject: 'call:reject',
    rejected: 'call:rejected',
    end: 'call:end',
    ended: 'call:ended',
    offer: 'webrtc:offer',
    answer: 'webrtc:answer',
    iceCandidate: 'webrtc:ice-candidate',
};

function registerAliases(socket, eventNames, handler) {
    eventNames.forEach((eventName) => socket.on(eventName, (payload = {}, ack = () => {}) => handler(payload, ack, eventName)));
}

function getUserSocketDebug(username) {
    return {
        username,
        online: presenceStore.isOnline(username),
        socketCount: presenceStore.getConnectionCount(username),
        socketIds: presenceStore.getSocketIds(username),
    };
}

function summarizeCall(call) {
    if (!call) return null;
    return {
        callId: call.callId || null,
        status: call.status || null,
        callerUsername: call.callerUsername || null,
        calleeUsername: call.calleeUsername || null,
        participants: call.participants || [],
        endReason: call.endReason || null,
        endedBy: call.endedBy || null,
    };
}

function summarizeMediaError(mediaError) {
    if (!mediaError) return null;
    return {
        error: mediaError.error
            ? {
                  name: mediaError.error.name || null,
                  message: mediaError.error.message || null,
                  code: mediaError.error.code || null,
                  constraint: mediaError.error.constraint || null,
                  userMessage: mediaError.error.userMessage || null,
              }
            : null,
        environment: mediaError.environment
            ? {
                  hasMediaDevices: mediaError.environment.hasMediaDevices,
                  hasGetUserMedia: mediaError.environment.hasGetUserMedia,
                  isSecureContext: mediaError.environment.isSecureContext,
                  protocol: mediaError.environment.protocol,
                  hostname: mediaError.environment.hostname,
                  userAgent: mediaError.environment.userAgent,
                  constraints: mediaError.environment.constraints,
              }
            : null,
        deviceCounts: mediaError.mediaDebug
            ? {
                  before: {
                      audioinput: mediaError.mediaDebug.devicesBefore?.audioinput,
                      videoinput: mediaError.mediaDebug.devicesBefore?.videoinput,
                      audiooutput: mediaError.mediaDebug.devicesBefore?.audiooutput,
                  },
                  afterFailure: {
                      audioinput: mediaError.mediaDebug.devicesAfterFailure?.audioinput,
                      videoinput: mediaError.mediaDebug.devicesAfterFailure?.videoinput,
                      audiooutput: mediaError.mediaDebug.devicesAfterFailure?.audiooutput,
                  },
              }
            : null,
        snapshot: mediaError.snapshot
            ? {
                  peerConnection: mediaError.snapshot.peerConnection || null,
                  localStream: mediaError.snapshot.localStream || null,
                  remoteStream: mediaError.snapshot.remoteStream || null,
              }
            : null,
    };
}

function emitToUser(io, username, eventName, payload) {
    const socketIds = presenceStore.getSocketIds(username);
    const context = {
        username,
        callId: payload.callId ?? payload.call?.callId ?? null,
        socketCount: socketIds.length,
        socketIds,
        onlineBy: 'username',
    };

    if (socketIds.length === 0) {
        logSocket(`No socket found for ${eventName} recipient.`, context);
        warnCall('receiver offline or not found', {
            eventName,
            ...context,
        });
    } else {
        logSocket(`Emitting ${eventName} to user room.`, context);
        debugCall(`forwarding ${eventName} to socket(s)`, {
            eventName,
            ...context,
        });
    }

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
        warnCall(`rejected ${eventName}`, {
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
    debugCall(`received ${eventName}`, {
        callId: payload.callId,
        from: socket.user.username,
        to: targetUsername,
        target: getUserSocketDebug(targetUsername),
        offer: valueKey === 'offer' ? describeSessionDescription(payload.offer) : null,
        answer: valueKey === 'answer' ? describeSessionDescription(payload.answer) : null,
        candidate: valueKey === 'candidate' ? describeCandidate(payload.candidate) : null,
    });

    if (!presenceStore.isOnline(targetUsername)) {
        warnCall(`${eventName} target not online`, {
            callId: payload.callId,
            from: socket.user.username,
            to: targetUsername,
            target: getUserSocketDebug(targetUsername),
        });
    }

    emitToUser(io, targetUsername, eventName, {
        callId: payload.callId,
        from: socket.user.username,
        [valueKey]: payload[valueKey],
    });

    return relayCheck.call;
}

module.exports = function registerCallSocket({ io, socket }) {
    registerAliases(socket, [CALL_EVENTS.invite, LEGACY_CALL_EVENTS.invite], async (payload = {}, ack = () => {}, receivedEventName) => {
        try {
            const calleeUsername = payload.calleeUsername;
            logSocket(`Received ${receivedEventName}.`, {
                from: socket.user.username,
                calleeUsername,
                roomId: payload.roomId || null,
                calleeOnline: presenceStore.isOnline(calleeUsername),
                calleeSocketCount: presenceStore.getConnectionCount(calleeUsername),
            });
            debugCall(`received ${receivedEventName}`, {
                eventName: receivedEventName,
                from: socket.user.username,
                to: calleeUsername,
                roomId: payload.roomId || null,
                caller: getUserSocketDebug(socket.user.username),
                receiver: getUserSocketDebug(calleeUsername),
                payload: {
                    calleeUsername,
                    roomId: payload.roomId || null,
                },
            });
            if (!presenceStore.isOnline(calleeUsername)) {
                warnCall('receiver offline or not found', {
                    eventName: receivedEventName,
                    from: socket.user.username,
                    to: calleeUsername,
                    receiver: getUserSocketDebug(calleeUsername),
                });
            }
            const result = await CallService.createInvite({
                callerUsername: socket.user.username,
                calleeUsername,
                roomId: payload.roomId,
                callType: 'video',
                isCalleeOnline: presenceStore.isOnline(calleeUsername),
            });

            if (!result.ok) {
                warnCall(`${receivedEventName} rejected by CallService`, {
                    eventName: receivedEventName,
                    from: socket.user.username,
                    to: calleeUsername,
                    status: result.status,
                    message: result.message,
                });
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
                debugCall('call timeout fired', {
                    call: summarizeCall(timedOutCall),
                    participants: timedOutCall.participants.map(getUserSocketDebug),
                });

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
                CALL_EVENTS.incoming,
                buildEventPayload(result.call, result.call.calleeUsername, {
                    caller: result.caller,
                    timeoutMs,
                }),
            );
            debugCall('incoming-call forwarded', {
                eventName: CALL_EVENTS.incoming,
                call: summarizeCall(result.call),
                from: result.call.callerUsername,
                to: result.call.calleeUsername,
                receiver: getUserSocketDebug(result.call.calleeUsername),
                timeoutMs,
            });

            return ack({
                ok: true,
                call: result.call,
                callee: result.callee,
                timeoutMs,
            });
        } catch (error) {
            errorCall(`${receivedEventName} failed`, error, {
                from: socket.user.username,
                to: payload?.calleeUsername || null,
            });
            return ack({ ok: false, status: 'failed', message: 'Could not start the call.' });
        }
    });

    registerAliases(socket, [CALL_EVENTS.accept, LEGACY_CALL_EVENTS.accept], async ({ callId } = {}, ack = () => {}, receivedEventName) => {
        try {
            logSocket(`Received ${receivedEventName}.`, {
                callId,
                username: socket.user.username,
            });
            debugCall(`received ${receivedEventName}`, {
                eventName: receivedEventName,
                callId,
                from: socket.user.username,
                fromSocketId: socket.id,
            });
            const result = await CallService.acceptCall({
                callId,
                username: socket.user.username,
            });

            if (!result.ok) {
                warnCall(`${receivedEventName} rejected by CallService`, {
                    callId,
                    from: socket.user.username,
                    status: result.status,
                    message: result.message,
                });
                return ack(result);
            }

            debugCall('forwarding accept-call to participants', {
                eventName: CALL_EVENTS.accept,
                call: summarizeCall(result.call),
                from: socket.user.username,
                caller: getUserSocketDebug(result.call.callerUsername),
                receiver: getUserSocketDebug(result.call.calleeUsername),
            });

            emitToUser(
                io,
                result.call.callerUsername,
                CALL_EVENTS.accept,
                buildEventPayload(result.call, result.call.callerUsername, {
                    acceptedBy: result.call.calleeUsername,
                }),
            );

            emitToUser(
                io,
                result.call.calleeUsername,
                CALL_EVENTS.accept,
                buildEventPayload(result.call, result.call.calleeUsername, {
                    acceptedBy: result.call.calleeUsername,
                }),
            );

            return ack({ ok: true, call: result.call });
        } catch (error) {
            errorCall(`${receivedEventName} failed`, error, {
                callId,
                from: socket.user.username,
            });
            return ack({ ok: false, status: 'failed', message: 'Could not accept the call.' });
        }
    });

    registerAliases(socket, ['accepting-call', 'call:accepting'], async ({ callId } = {}, ack = () => {}, receivedEventName) => {
        try {
            logSocket(`Received ${receivedEventName}.`, {
                callId,
                username: socket.user.username,
            });
            debugCall(`received ${receivedEventName}`, {
                eventName: receivedEventName,
                callId,
                from: socket.user.username,
                fromSocketId: socket.id,
            });

            const call = CallService.getActiveCall(callId);
            if (!call) {
                warnCall(`${receivedEventName} rejected by CallService: not found`, {
                    callId,
                    from: socket.user.username,
                });
                return ack({ ok: false, status: 'not_found', message: 'Call does not exist anymore.' });
            }

            if (call.calleeUsername !== socket.user.username) {
                warnCall(`${receivedEventName} rejected by CallService: forbidden`, {
                    callId,
                    from: socket.user.username,
                });
                return ack({ ok: false, status: 'forbidden', message: 'Only the callee can accept this call.' });
            }

            if (call.status !== 'ringing') {
                warnCall(`${receivedEventName} rejected by CallService: invalid state`, {
                    callId,
                    from: socket.user.username,
                    status: call.status,
                });
                return ack({ ok: false, status: 'invalid_state', message: 'Call is no longer ringing.' });
            }

            CallService.clearCallTimeout(callId);
            debugCall('cleared call timeout for accepting', {
                callId,
                username: socket.user.username,
            });

            emitToUser(
                io,
                call.callerUsername,
                'accepting-call',
                buildEventPayload(call, call.callerUsername, {
                    acceptedBy: call.calleeUsername,
                }),
            );

            return ack({ ok: true });
        } catch (error) {
            errorCall(`${receivedEventName} failed`, error, {
                callId,
                from: socket.user.username,
            });
            return ack({ ok: false, status: 'failed', message: 'Could not process accepting-call.' });
        }
    });

    registerAliases(socket, [CALL_EVENTS.reject, LEGACY_CALL_EVENTS.reject], async ({ callId, reason } = {}, ack = () => {}, receivedEventName) => {
        try {
            logSocket(`Received ${receivedEventName}.`, {
                callId,
                username: socket.user.username,
                reason: reason || 'rejected',
            });
            debugCall(`received ${receivedEventName}`, {
                eventName: receivedEventName,
                callId,
                from: socket.user.username,
                fromSocketId: socket.id,
                reason: reason || 'rejected',
            });
            const result = await CallService.rejectCall({
                callId,
                username: socket.user.username,
            });

            if (!result.ok) {
                warnCall(`${receivedEventName} rejected by CallService`, {
                    callId,
                    from: socket.user.username,
                    status: result.status,
                    message: result.message,
                    reason: reason || 'rejected',
                });
                return ack(result);
            }

            debugCall('forwarding reject-call to participants', {
                eventName: CALL_EVENTS.reject,
                call: summarizeCall(result.call),
                from: socket.user.username,
                reason: reason || result.call.endReason || 'rejected',
                caller: getUserSocketDebug(result.call.callerUsername),
                receiver: getUserSocketDebug(result.call.calleeUsername),
            });

            emitToUser(
                io,
                result.call.callerUsername,
                CALL_EVENTS.reject,
                buildEventPayload(result.call, result.call.callerUsername, {
                    message: 'The callee rejected the call.',
                }),
            );

            emitToUser(
                io,
                result.call.calleeUsername,
                CALL_EVENTS.reject,
                buildEventPayload(result.call, result.call.calleeUsername, {
                    message: 'You rejected the call.',
                }),
            );

            return ack({ ok: true, call: result.call });
        } catch (error) {
            errorCall(`${receivedEventName} failed`, error, {
                callId,
                from: socket.user.username,
                reason: reason || 'rejected',
            });
            return ack({ ok: false, status: 'failed', message: 'Could not reject the call.' });
        }
    });

    registerAliases(socket, [CALL_EVENTS.end, LEGACY_CALL_EVENTS.end], async ({ callId, reason, mediaError } = {}, ack = () => {}, receivedEventName) => {
        try {
            logSocket(`Received ${receivedEventName}.`, {
                callId,
                username: socket.user.username,
                reason: reason || 'ended',
            });
            debugCall(`received ${receivedEventName}`, {
                eventName: receivedEventName,
                callId,
                from: socket.user.username,
                fromSocketId: socket.id,
                reason: reason || 'ended',
                mediaError: summarizeMediaError(mediaError),
            });
            if (reason === 'media_error') {
                warnCall('media_error received from frontend', {
                    eventName: receivedEventName,
                    callId,
                    from: socket.user.username,
                    mediaError: summarizeMediaError(mediaError),
                });
            }
            const result = await CallService.endCall({
                callId,
                username: socket.user.username,
                reason: reason || 'ended',
            });

            if (!result.ok) {
                warnCall(`${receivedEventName} rejected by CallService`, {
                    callId,
                    from: socket.user.username,
                    status: result.status,
                    message: result.message,
                    reason: reason || 'ended',
                    mediaError: summarizeMediaError(mediaError),
                });
                return ack(result);
            }

            debugCall('forwarding call-ended to participants', {
                eventName: CALL_EVENTS.ended,
                call: summarizeCall(result.call),
                from: socket.user.username,
                reason: result.call.endReason,
                participants: result.call.participants.map(getUserSocketDebug),
                mediaError: summarizeMediaError(mediaError),
            });

            for (const participant of result.call.participants) {
                emitToUser(
                    io,
                    participant,
                    CALL_EVENTS.ended,
                    buildEventPayload(result.call, participant, {
                        reason: result.call.endReason,
                    }),
                );
            }

            return ack({ ok: true, call: result.call });
        } catch (error) {
            errorCall(`${receivedEventName} failed`, error, {
                callId,
                from: socket.user.username,
                reason: reason || 'ended',
                mediaError: summarizeMediaError(mediaError),
            });
            return ack({ ok: false, status: 'failed', message: 'Could not end the call.' });
        }
    });

    registerAliases(socket, [CALL_EVENTS.offer, LEGACY_CALL_EVENTS.offer], ({ callId, offer } = {}, ack = () => {}, receivedEventName) => {
        logSocket(`Received ${receivedEventName}.`, {
            callId,
            from: socket.user.username,
            offer: describeSessionDescription(offer),
        });
        debugCall(`received ${receivedEventName}`, {
            eventName: receivedEventName,
            callId,
            from: socket.user.username,
            fromSocketId: socket.id,
            offer: describeSessionDescription(offer),
        });
        // Only authenticated participants of the active call can relay SDP/ICE.
        const call = relaySignalingEvent({
            ack,
            eventName: CALL_EVENTS.offer,
            io,
            payload: { callId, offer },
            socket,
            valueKey: 'offer',
        });

        if (!call) return;
        ack({ ok: true });
    });

    registerAliases(socket, [CALL_EVENTS.answer, LEGACY_CALL_EVENTS.answer], async ({ callId, answer } = {}, ack = () => {}, receivedEventName) => {
        try {
            logSocket(`Received ${receivedEventName}.`, {
                callId,
                from: socket.user.username,
                answer: describeSessionDescription(answer),
            });
            debugCall(`received ${receivedEventName}`, {
                eventName: receivedEventName,
                callId,
                from: socket.user.username,
                fromSocketId: socket.id,
                answer: describeSessionDescription(answer),
            });
            const call = relaySignalingEvent({
                ack,
                eventName: CALL_EVENTS.answer,
                io,
                payload: { callId, answer },
                socket,
                valueKey: 'answer',
            });

            if (!call) return;

            await CallService.markCallInProgress(callId);
            ack({ ok: true });
        } catch (error) {
            errorCall(`${receivedEventName} failed`, error, {
                callId,
                from: socket.user.username,
                answer: describeSessionDescription(answer),
            });
            ack({ ok: false, status: 'failed', message: 'Could not relay WebRTC answer.' });
        }
    });

    registerAliases(socket, [CALL_EVENTS.iceCandidate, LEGACY_CALL_EVENTS.iceCandidate], ({ callId, candidate } = {}, ack = () => {}, receivedEventName) => {
        logSocket(`Received ${receivedEventName}.`, {
            callId,
            from: socket.user.username,
            candidate: describeCandidate(candidate),
        });
        debugCall(`received ${receivedEventName}`, {
            eventName: receivedEventName,
            callId,
            from: socket.user.username,
            fromSocketId: socket.id,
            candidate: describeCandidate(candidate),
        });
        const call = relaySignalingEvent({
            ack,
            eventName: CALL_EVENTS.iceCandidate,
            io,
            payload: { callId, candidate },
            socket,
            valueKey: 'candidate',
        });

        if (!call) return;
        ack({ ok: true });
    });

    socket.on('disconnect', async (reason) => {
        try {
            logSocket('Socket disconnected for call namespace handler.', {
                username: socket.user.username,
                socketId: socket.id,
                reason,
                stillOnline: presenceStore.isOnline(socket.user.username),
            });

            if (presenceStore.isOnline(socket.user.username)) return;

            const finalizedCall = await CallService.endCallForDisconnect(socket.user.username);
            if (!finalizedCall) return;

            debugCall('disconnect ended active call', {
                username: socket.user.username,
                socketId: socket.id,
                reason,
                call: summarizeCall(finalizedCall),
                participants: finalizedCall.participants.map(getUserSocketDebug),
            });

            // Only close the call when the user has gone fully offline.
            for (const participant of finalizedCall.participants) {
                emitToUser(
                    io,
                    participant,
                    CALL_EVENTS.ended,
                    buildEventPayload(finalizedCall, participant, {
                        reason: finalizedCall.endReason,
                    }),
                );
            }
        } catch (error) {
            errorCall('call disconnect cleanup failed', error, {
                username: socket.user.username,
                socketId: socket.id,
                reason,
            });
        }
    });
};
