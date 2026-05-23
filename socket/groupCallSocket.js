// socket/groupCallSocket.js

const groupCallService = require('../services/groupCallService');
const presenceStore = require('../store/presenceStore');

const CALL_DEBUG_ENABLED = process.env.CALL_DEBUG !== 'false';
const LOG_PREFIX = '[GROUP_CALL][BACKEND]';

const GROUP_CALL_EVENTS = {
  start: 'group-call:start',
  incoming: 'group-call:incoming',
  started: 'group-call:started',
  join: 'group-call:join',
  joined: 'group-call:joined',
  userJoined: 'group-call:user-joined',
  leave: 'group-call:leave',
  userLeft: 'group-call:user-left',
  end: 'group-call:end',
  ended: 'group-call:ended',
  offer: 'group-call:offer',
  answer: 'group-call:answer',
  iceCandidate: 'group-call:ice-candidate',
  mediaState: 'group-call:media-state',
  error: 'group-call:error',
};

function debug(message, extra = {}) {
  if (!CALL_DEBUG_ENABLED) return;
  console.log(LOG_PREFIX, message, extra);
}

function warn(message, extra = {}) {
  if (!CALL_DEBUG_ENABLED) return;
  console.warn(LOG_PREFIX, message, extra);
}

function errorLog(message, error, extra = {}) {
  console.error(LOG_PREFIX, message, {
    ...extra,
    error: {
      name: error?.name || null,
      message: error?.message || null,
      stack: error?.stack || null,
    },
  });
}

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

function getSocketUsername(socket) {
  return socket.user?.username;
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
    callId: call.callId,
    groupId: call.groupId,
    creatorUsername: call.creatorUsername,
    status: call.status,
    participantCount: call.participants?.length || 0,
    participantUsernames: call.participants?.map((participant) => participant.username) || [],
  };
}

function emitError(socket, message, extra = {}) {
  warn('Emitting group-call:error', {
    username: getSocketUsername(socket),
    socketId: socket.id,
    message,
    ...extra,
  });

  socket.emit(GROUP_CALL_EVENTS.error, {
    message,
    ...extra,
  });
}

function emitToUser(io, username, eventName, payload) {
  const socketIds = presenceStore.getSocketIds(username);

  debug(`Emitting ${eventName} to user`, {
    username,
    eventName,
    socketCount: socketIds.length,
    socketIds,
    callId: payload?.callId || payload?.call?.callId || null,
  });

  if (socketIds.length === 0) {
    warn(`Target user offline for ${eventName}`, {
      username,
      eventName,
      payloadCallId: payload?.callId || payload?.call?.callId || null,
    });
  }

  io.to(`user:${username}`).emit(eventName, payload);
}

function emitToParticipants(io, participants, eventName, payload, exceptUsername = null) {
  participants.forEach((participant) => {
    const username = typeof participant === 'string' ? participant : participant.username;

    if (!username || username === exceptUsername) return;

    emitToUser(io, username, eventName, payload);
  });
}

function normalizeParticipants(participants) {
  if (!Array.isArray(participants)) return [];

  return participants
    .map((participant) => {
      if (typeof participant === 'string') return participant;
      return participant?.username;
    })
    .filter(Boolean);
}

function isUserInCall(callId, username) {
  return groupCallService.isParticipant({
    callId,
    username,
  });
}

function validateSignalingParticipant({ callId, fromUsername, targetUsername, socket }) {
  if (!callId || !targetUsername) {
    emitError(socket, 'callId and targetUsername are required', {
      callId,
      targetUsername,
    });
    return false;
  }

  if (!isUserInCall(callId, fromUsername)) {
    emitError(socket, 'Sender is not a participant in this group call', {
      callId,
      fromUsername,
    });
    return false;
  }

  if (!isUserInCall(callId, targetUsername)) {
    emitError(socket, 'Target is not a participant in this group call', {
      callId,
      targetUsername,
    });
    return false;
  }

  if (!presenceStore.isOnline(targetUsername)) {
    emitError(socket, 'Target user is offline', {
      callId,
      targetUsername,
      target: getUserSocketDebug(targetUsername),
    });
    return false;
  }

  return true;
}

module.exports = function registerGroupCallSocket({ io, socket }) {
  socket.on(GROUP_CALL_EVENTS.start, (payload = {}, ack = () => {}) => {
    const creatorUsername = getSocketUsername(socket);

    try {
      const groupId = payload.groupId;

      // Normalize receivers: ưu tiên theo thứ tự invitedParticipants → participants → targetUsernames → participantUsernames → calleeUsernames → members
      const rawReceivers =
        payload.invitedParticipants ||
        payload.participants ||
        payload.targetUsernames ||
        payload.participantUsernames ||
        payload.calleeUsernames ||
        payload.members ||
        [];

      const invitedParticipants = normalizeParticipants(rawReceivers);

      console.log('[GroupCallSocket] start received', {
        socketId: socket.id,
        callerUsername: creatorUsername,
        groupId: payload.groupId,
        rawPayload: {
          participants: payload.participants,
          invitedParticipants: payload.invitedParticipants,
          members: payload.members,
          targetUsernames: payload.targetUsernames,
          participantUsernames: payload.participantUsernames,
          calleeUsernames: payload.calleeUsernames,
        },
      });

      debug('Received group-call:start', {
        from: creatorUsername,
        socketId: socket.id,
        groupId,
        invitedParticipants,
      });

      const result = groupCallService.startGroupCall({
        groupId,
        creatorUsername,
        socketId: socket.id,
      });

      if (!result.ok) {
        emitError(socket, result.error, { eventName: GROUP_CALL_EVENTS.start });
        return ack({ ok: false, message: result.error });
      }

      const call = result.data;

      const inviteTargets = invitedParticipants.filter(
        (username) => username && username !== creatorUsername
      );

      console.log('[GroupCallSocket] start normalized receivers', {
        callerUsername: creatorUsername,
        groupId,
        receiverUsernames: inviteTargets,
        excludedCaller: creatorUsername,
        onlineUsers: presenceStore.getOnlineUsernames(),
      });

      console.log('[GroupCallSocket] call created', {
        callId: call.callId,
        groupId: call.groupId,
        callerUsername: call.creatorUsername,
        participants: call.participants,
        invitedUsernames: inviteTargets,
      });

      socket.emit(GROUP_CALL_EVENTS.started, {
        callId: call.callId,
        groupId: call.groupId,
        call,
        participants: call.participants,
      });

      inviteTargets.forEach((username) => {
        const receiverSocketIds = presenceStore.getSocketIds(username);
        const receiverOnline = presenceStore.isOnline(username);

        if (!receiverOnline || receiverSocketIds.length === 0) {
          console.warn('[GroupCallSocket] receiver socket not found', {
            receiverUsername: username,
            knownOnlineUsers: presenceStore.getOnlineUsernames(),
            callId: call.callId,
            groupId: call.groupId,
          });
        } else {
          console.log('[GroupCallSocket] emit incoming', {
            receiverUsername: username,
            receiverSocketIds,
            receiverOnline,
            eventName: 'group-call:incoming',
            callId: call.callId,
            groupId: call.groupId,
            callerUsername: creatorUsername,
          });
        }

        emitToUser(io, username, GROUP_CALL_EVENTS.incoming, {
          callId: call.callId,
          groupId: call.groupId,
          callerUsername: creatorUsername,
          fromUsername: creatorUsername,
          createdBy: creatorUsername,
          participants: inviteTargets,
          call: {
            callId: call.callId,
            groupId: call.groupId,
            createdBy: creatorUsername,
            creatorUsername,
            participants: call.participants,
          },
          activeGroupCall: call,
        });
      });

      debug('Group call started and incoming emitted', {
        call: summarizeCall(call),
        inviteTargets,
        inviteTargetDebug: inviteTargets.map(getUserSocketDebug),
      });

      return ack({
        ok: true,
        call,
        inviteTargets,
      });
    } catch (error) {
      errorLog('group-call:start failed', error, {
        from: creatorUsername,
        socketId: socket.id,
        payload,
      });

      emitError(socket, 'Could not start group call');
      return ack({ ok: false, message: 'Could not start group call' });
    }
  });

  socket.on(GROUP_CALL_EVENTS.join, (payload = {}, ack = () => {}) => {
    const username = getSocketUsername(socket);

    try {
      const { callId } = payload;

      debug('Received group-call:join', {
        callId,
        username,
        socketId: socket.id,
      });

      const beforeParticipantsResult = groupCallService.getParticipants(callId);
      const beforeParticipants = beforeParticipantsResult.ok
        ? beforeParticipantsResult.data
        : [];

      const result = groupCallService.joinGroupCall({
        callId,
        username,
        socketId: socket.id,
      });

      if (!result.ok) {
        emitError(socket, result.error, { eventName: GROUP_CALL_EVENTS.join, callId });
        return ack({ ok: false, message: result.error });
      }

      const call = result.data;

      socket.emit(GROUP_CALL_EVENTS.joined, {
        callId: call.callId,
        groupId: call.groupId,
        call,
        participants: call.participants,
      });

      emitToParticipants(
        io,
        beforeParticipants,
        GROUP_CALL_EVENTS.userJoined,
        {
          callId: call.callId,
          groupId: call.groupId,
          username,
          participant: groupCallService.getParticipant({ callId, username }),
          participants: call.participants,
        },
        username
      );

      debug('User joined group call', {
        username,
        call: summarizeCall(call),
        beforeParticipantUsernames: beforeParticipants.map(
          (participant) => participant.username
        ),
      });

      return ack({
        ok: true,
        call,
      });
    } catch (error) {
      errorLog('group-call:join failed', error, {
        username,
        socketId: socket.id,
        payload,
      });

      emitError(socket, 'Could not join group call');
      return ack({ ok: false, message: 'Could not join group call' });
    }
  });

  socket.on(GROUP_CALL_EVENTS.leave, (payload = {}, ack = () => {}) => {
    const username = getSocketUsername(socket);

    try {
      const { callId } = payload;

      debug('Received group-call:leave', {
        callId,
        username,
        socketId: socket.id,
      });

      const result = groupCallService.leaveGroupCall({
        callId,
        username,
      });

      if (!result.ok) {
        emitError(socket, result.error, { eventName: GROUP_CALL_EVENTS.leave, callId });
        return ack({ ok: false, message: result.error });
      }

      const { call, previousParticipants, isEnded } = result.data;

      if (isEnded) {
        emitToParticipants(io, previousParticipants, GROUP_CALL_EVENTS.ended, {
          callId,
          reason: 'empty',
          endedBy: username,
        });
      } else {
        emitToParticipants(
          io,
          previousParticipants,
          GROUP_CALL_EVENTS.userLeft,
          {
            callId,
            groupId: call.groupId,
            username,
            participants: call.participants,
          },
          username
        );
      }

      debug('User left group call', {
        callId,
        username,
        isEnded,
        remainingCall: summarizeCall(call),
      });

      return ack({
        ok: true,
        call,
        isEnded,
      });
    } catch (error) {
      errorLog('group-call:leave failed', error, {
        username,
        socketId: socket.id,
        payload,
      });

      emitError(socket, 'Could not leave group call');
      return ack({ ok: false, message: 'Could not leave group call' });
    }
  });

  socket.on(GROUP_CALL_EVENTS.end, (payload = {}, ack = () => {}) => {
    const username = getSocketUsername(socket);

    try {
      const { callId } = payload;

      debug('Received group-call:end', {
        callId,
        username,
        socketId: socket.id,
      });

      const result = groupCallService.endGroupCall({
        callId,
        username,
      });

      if (!result.ok) {
        emitError(socket, result.error, { eventName: GROUP_CALL_EVENTS.end, callId });
        return ack({ ok: false, message: result.error });
      }

      const { call, previousParticipants } = result.data;

      emitToParticipants(io, previousParticipants, GROUP_CALL_EVENTS.ended, {
        callId,
        groupId: call?.groupId || null,
        call,
        reason: 'ended',
        endedBy: username,
      });

      debug('Group call ended', {
        callId,
        endedBy: username,
        call: summarizeCall(call),
      });

      return ack({
        ok: true,
        call,
      });
    } catch (error) {
      errorLog('group-call:end failed', error, {
        username,
        socketId: socket.id,
        payload,
      });

      emitError(socket, 'Could not end group call');
      return ack({ ok: false, message: 'Could not end group call' });
    }
  });

  socket.on(GROUP_CALL_EVENTS.offer, (payload = {}, ack = () => {}) => {
    const fromUsername = getSocketUsername(socket);

    try {
      const { callId, targetUsername, offer } = payload;

      debug('Received group-call:offer', {
        callId,
        fromUsername,
        targetUsername,
        offer: describeSessionDescription(offer),
      });

      if (!offer) {
        emitError(socket, 'offer is required', { callId, targetUsername });
        return ack({ ok: false, message: 'offer is required' });
      }

      const valid = validateSignalingParticipant({
        callId,
        fromUsername,
        targetUsername,
        socket,
      });

      if (!valid) {
        return ack({ ok: false, message: 'Invalid group call offer relay' });
      }

      emitToUser(io, targetUsername, GROUP_CALL_EVENTS.offer, {
        callId,
        fromUsername,
        offer,
      });

      return ack({ ok: true });
    } catch (error) {
      errorLog('group-call:offer failed', error, {
        fromUsername,
        payload: {
          callId: payload.callId,
          targetUsername: payload.targetUsername,
          offer: describeSessionDescription(payload.offer),
        },
      });

      emitError(socket, 'Could not relay group call offer');
      return ack({ ok: false, message: 'Could not relay group call offer' });
    }
  });

  socket.on(GROUP_CALL_EVENTS.answer, (payload = {}, ack = () => {}) => {
    const fromUsername = getSocketUsername(socket);

    try {
      const { callId, targetUsername, answer } = payload;

      debug('Received group-call:answer', {
        callId,
        fromUsername,
        targetUsername,
        answer: describeSessionDescription(answer),
      });

      if (!answer) {
        emitError(socket, 'answer is required', { callId, targetUsername });
        return ack({ ok: false, message: 'answer is required' });
      }

      const valid = validateSignalingParticipant({
        callId,
        fromUsername,
        targetUsername,
        socket,
      });

      if (!valid) {
        return ack({ ok: false, message: 'Invalid group call answer relay' });
      }

      emitToUser(io, targetUsername, GROUP_CALL_EVENTS.answer, {
        callId,
        fromUsername,
        answer,
      });

      return ack({ ok: true });
    } catch (error) {
      errorLog('group-call:answer failed', error, {
        fromUsername,
        payload: {
          callId: payload.callId,
          targetUsername: payload.targetUsername,
          answer: describeSessionDescription(payload.answer),
        },
      });

      emitError(socket, 'Could not relay group call answer');
      return ack({ ok: false, message: 'Could not relay group call answer' });
    }
  });

  socket.on(GROUP_CALL_EVENTS.iceCandidate, (payload = {}, ack = () => {}) => {
    const fromUsername = getSocketUsername(socket);

    try {
      const { callId, targetUsername, candidate } = payload;

      debug('Received group-call:ice-candidate', {
        callId,
        fromUsername,
        targetUsername,
        candidate: describeCandidate(candidate),
      });

      if (!candidate) {
        emitError(socket, 'candidate is required', { callId, targetUsername });
        return ack({ ok: false, message: 'candidate is required' });
      }

      const valid = validateSignalingParticipant({
        callId,
        fromUsername,
        targetUsername,
        socket,
      });

      if (!valid) {
        return ack({ ok: false, message: 'Invalid group call ice candidate relay' });
      }

      emitToUser(io, targetUsername, GROUP_CALL_EVENTS.iceCandidate, {
        callId,
        fromUsername,
        candidate,
      });

      return ack({ ok: true });
    } catch (error) {
      errorLog('group-call:ice-candidate failed', error, {
        fromUsername,
        payload: {
          callId: payload.callId,
          targetUsername: payload.targetUsername,
          candidate: describeCandidate(payload.candidate),
        },
      });

      emitError(socket, 'Could not relay group call ice candidate');
      return ack({
        ok: false,
        message: 'Could not relay group call ice candidate',
      });
    }
  });

  socket.on(GROUP_CALL_EVENTS.mediaState, (payload = {}, ack = () => {}) => {
    const username = getSocketUsername(socket);

    try {
      const { callId, audioEnabled, videoEnabled } = payload;

      debug('Received group-call:media-state', {
        callId,
        username,
        audioEnabled,
        videoEnabled,
      });

      const result = groupCallService.updateMediaState({
        callId,
        username,
        audioEnabled,
        videoEnabled,
      });

      if (!result.ok) {
        emitError(socket, result.error, {
          eventName: GROUP_CALL_EVENTS.mediaState,
          callId,
        });
        return ack({ ok: false, message: result.error });
      }

      const call = result.data;

      emitToParticipants(
        io,
        call.participants,
        GROUP_CALL_EVENTS.mediaState,
        {
          callId,
          groupId: call.groupId,
          username,
          audioEnabled,
          videoEnabled,
          participants: call.participants,
        },
        username
      );

      debug('Group call media state broadcasted', {
        callId,
        username,
        audioEnabled,
        videoEnabled,
      });

      return ack({
        ok: true,
        call,
      });
    } catch (error) {
      errorLog('group-call:media-state failed', error, {
        username,
        socketId: socket.id,
        payload,
      });

      emitError(socket, 'Could not update group call media state');
      return ack({
        ok: false,
        message: 'Could not update group call media state',
      });
    }
  });

  socket.on('disconnect', (reason) => {
    const username = getSocketUsername(socket);

    try {
      debug('Socket disconnected for group call handler', {
        username,
        socketId: socket.id,
        reason,
        stillOnline: presenceStore.isOnline(username),
      });

      if (presenceStore.isOnline(username)) {
        debug('Skip group call cleanup because user still has other sockets online', {
          username,
          socketId: socket.id,
        });
        return;
      }

      const result = groupCallService.removeParticipantFromAllCalls(username);

      if (!result.ok) {
        warn('removeParticipantFromAllCalls failed on disconnect', {
          username,
          error: result.error,
        });
        return;
      }

      result.data.forEach((call) => {
        if (!call) return;

        emitToParticipants(
          io,
          call.participants,
          GROUP_CALL_EVENTS.userLeft,
          {
            callId: call.callId,
            groupId: call.groupId,
            username,
            participants: call.participants,
            reason: 'disconnect',
          },
          username
        );
      });

      debug('Group call disconnect cleanup finished', {
        username,
        affectedCalls: result.data.length,
      });
    } catch (error) {
      errorLog('group call disconnect cleanup failed', error, {
        username,
        socketId: socket.id,
        reason,
      });
    }
  });
};