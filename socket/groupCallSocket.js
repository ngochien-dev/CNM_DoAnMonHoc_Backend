// socket/groupCallSocket.js

const groupCallService = require('../services/groupCallService');
const presenceStore = require('../store/presenceStore');
const docClient = require('../awsConfig');
const { GetCommand } = require('@aws-sdk/lib-dynamodb');

const CALL_DEBUG_ENABLED = process.env.CALL_DEBUG !== 'false';
const LOG_PREFIX = '[GROUP_CALL][BACKEND]';
const DISCONNECT_CLEANUP_DELAY_MS = Number(process.env.GROUP_CALL_DISCONNECT_CLEANUP_MS) || 15000;
const STALE_CALL_MAX_AGE_MS = Number(process.env.GROUP_CALL_STALE_MAX_AGE_MS) || 6 * 60 * 60 * 1000;

const GROUP_CALL_EVENTS = {
  start: 'group-call:start',
  incoming: 'group-call:incoming',
  started: 'group-call:started',
  join: 'group-call:join',
  rejoin: 'group-call:rejoin',
  joined: 'group-call:joined',
  rejoined: 'group-call:rejoined',
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

function normalizeUsername(value) {
  if (!value) return '';

  if (typeof value === 'string') {
    return value.trim();
  }

  const normalized = (
    value.username ||
    value.userName ||
    value.name ||
    value.id ||
    value.userId ||
    ''
  );

  return typeof normalized === 'string' ? normalized.trim() : String(normalized).trim();
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
    ok: false,
    message,
    ...extra,
  });
}

function safeAck(ack, payload) {
  if (typeof ack === 'function') {
    ack(payload);
    return true;
  }

  return false;
}

function emitGroupCallError(socket, message, extra = {}) {
  emitError(socket, message, extra);
}

function respondSuccess(ack, payload) {
  return safeAck(ack, payload);
}

function respondError(socket, ack, message, extra = {}) {
  const payload = {
    ok: false,
    message,
    ...extra,
  };

  if (safeAck(ack, payload)) {
    return true;
  }

  emitGroupCallError(socket, message, extra);
  return false;
}

function emitToUser(io, username, eventName, payload) {
  const socketIds = presenceStore.getSocketIds(username);

  debug(`Emitting ${eventName} to user`, {
    username,
    eventName,
    socketCount: socketIds.length,
    socketIds,
    callId: payload?.callId || payload?.call?.callId || null,
    room: `user:${username}`,
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

function cleanupDisconnectedGroupCallSocket(io, socket, reason) {
  const username = getSocketUsername(socket);

  try {
    debug('Running delayed group call disconnect cleanup', {
      username,
      socketId: socket.id,
      reason,
      delayMs: DISCONNECT_CLEANUP_DELAY_MS,
      activeGroupCalls: groupCallService.getDebugSnapshot(),
    });

    const bySocketResult = groupCallService.removeParticipantBySocketId(socket.id);

    if (!bySocketResult.ok) {
      warn('removeParticipantBySocketId failed on disconnect', {
        username,
        socketId: socket.id,
        error: bySocketResult.error,
      });
    } else {
      bySocketResult.data.forEach((entry) => {
        const call = entry?.call;
        if (!call) return;

        emitToParticipants(
          io,
          call.participants,
          GROUP_CALL_EVENTS.userLeft,
          {
            callId: call.callId,
            groupId: call.groupId,
            username: entry.previousUsername || username,
            participants: call.participants,
            reason: 'disconnect',
          },
          entry.previousUsername || username
        );
      });
    }

    const staleResult = groupCallService.cleanupStaleCalls({
      maxAgeMs: STALE_CALL_MAX_AGE_MS,
    });

    if (!staleResult.ok) {
      warn('cleanupStaleCalls failed on disconnect', {
        username,
        socketId: socket.id,
        error: staleResult.error,
      });
    }

    debug('Delayed group call disconnect cleanup finished', {
      username,
      socketId: socket.id,
      affectedBySocket: bySocketResult.ok ? bySocketResult.data.length : 0,
      staleRemoved: staleResult.ok ? staleResult.data.length : 0,
      activeGroupCalls: groupCallService.getDebugSnapshot(),
    });
  } catch (error) {
    errorLog('delayed group call disconnect cleanup failed', error, {
      username,
      socketId: socket.id,
      reason,
    });
  }
}

function normalizeParticipants(participants) {
  if (!Array.isArray(participants)) return [];

  return Array.from(
    new Set(participants.map(normalizeUsername).filter(Boolean))
  );
}

async function getGroupMembersFromStore(groupId) {
  if (!groupId) {
    return {
      found: false,
      members: [],
      group: null,
      error: 'groupId is required',
    };
  }

  try {
    const data = await docClient.send(
      new GetCommand({
        TableName: 'Groups',
        Key: { groupId },
      })
    );
    const group = data.Item || null;
    const members = group
      ? normalizeParticipants([group.owner, ...(group.members || [])])
      : [];

    debug('Loaded group members for group call start', {
      groupId,
      found: Boolean(group),
      owner: group?.owner || null,
      memberCount: members.length,
      members,
    });

    return {
      found: Boolean(group),
      members,
      group,
      error: null,
    };
  } catch (error) {
    errorLog('Could not load group members for group call start', error, {
      groupId,
    });

    return {
      found: false,
      members: [],
      group: null,
      error: error?.message || 'Could not load group members',
    };
  }
}

function buildInviteTargets({ payload, groupMembers, creatorUsername }) {
  const rawPayloadReceivers = [
    ...(Array.isArray(payload.invitedParticipants) ? payload.invitedParticipants : []),
    ...(Array.isArray(payload.participants) ? payload.participants : []),
    ...(Array.isArray(payload.targetUsernames) ? payload.targetUsernames : []),
    ...(Array.isArray(payload.participantUsernames) ? payload.participantUsernames : []),
    ...(Array.isArray(payload.calleeUsernames) ? payload.calleeUsernames : []),
    ...(Array.isArray(payload.members) ? payload.members : []),
  ];

  const payloadReceivers = normalizeParticipants(rawPayloadReceivers);
  const sourceMembers = groupMembers.length > 0 ? groupMembers : payloadReceivers;
  const inviteTargets = sourceMembers.filter(
    (username) => username && username !== creatorUsername
  );

  return {
    payloadReceivers,
    sourceMembers,
    inviteTargets,
  };
}

function isUserInCall(callId, username) {
  return groupCallService.isParticipant({
    callId,
    username,
  });
}

function validateSignalingParticipant({ callId, fromUsername, targetUsername, socket }) {
  if (!callId || !targetUsername) {
    warn('Invalid signaling participant: callId and targetUsername are required', {
      callId,
      targetUsername,
    });
    return false;
  }

  if (!isUserInCall(callId, fromUsername)) {
    warn('Invalid signaling participant: sender is not in call', {
      callId,
      fromUsername,
    });
    return false;
  }

  if (!isUserInCall(callId, targetUsername)) {
    warn('Invalid signaling participant: target is not in call', {
      callId,
      targetUsername,
    });
    return false;
  }

  if (!presenceStore.isOnline(targetUsername)) {
    warn('Invalid signaling participant: target user is offline', {
      callId,
      targetUsername,
      target: getUserSocketDebug(targetUsername),
    });
    return false;
  }

  return true;
}

module.exports = function registerGroupCallSocket({ io, socket }) {
  debug('Group call socket handler registered', {
    username: getSocketUsername(socket),
    socketId: socket.id,
    userRoom: `user:${getSocketUsername(socket)}`,
    rooms: Array.from(socket.rooms || []),
    connectionCount: presenceStore.getConnectionCount(getSocketUsername(socket)),
    socketIds: presenceStore.getSocketIds(getSocketUsername(socket)),
  });

  socket.on(GROUP_CALL_EVENTS.start, async (payload = {}, ack) => {
    const creatorUsername = getSocketUsername(socket);

    try {
      const groupId = payload.groupId;

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

      const groupLookup = await getGroupMembersFromStore(groupId);
      const { payloadReceivers, sourceMembers, inviteTargets } = buildInviteTargets({
        payload,
        groupMembers: groupLookup.members,
        creatorUsername,
      });

      debug('Received group-call:start', {
        from: creatorUsername,
        socketId: socket.id,
        groupId,
        groupFound: groupLookup.found,
        groupLookupError: groupLookup.error,
        payloadReceivers,
        sourceMembers,
        inviteTargets,
        inviteTargetDebug: inviteTargets.map(getUserSocketDebug),
      });

      if (!groupId) {
        return respondError(socket, ack, 'groupId is required', {
          eventName: GROUP_CALL_EVENTS.start,
        });
      }

      if (groupLookup.found && !sourceMembers.includes(creatorUsername)) {
        warn('Rejected group-call:start because caller is not a group member', {
          groupId,
          creatorUsername,
          groupMembers: sourceMembers,
        });
        return respondError(socket, ack, 'Only group members can start a group call', {
          eventName: GROUP_CALL_EVENTS.start,
          groupId,
        });
      }

      if (inviteTargets.length === 0) {
        warn('No invite targets for group-call:start; incoming will not be emitted', {
          groupId,
          creatorUsername,
          groupFound: groupLookup.found,
          groupLookupError: groupLookup.error,
          payloadReceivers,
          sourceMembers,
          onlineUsers: presenceStore.getOnlineUsernames(),
        });
        return respondError(socket, ack, 'No group members found to invite', {
          eventName: GROUP_CALL_EVENTS.start,
          groupId,
          payloadReceivers,
          sourceMembers,
        });
      }

      const result = groupCallService.startGroupCall({
        groupId,
        creatorUsername,
        socketId: socket.id,
      });

      if (!result.ok) {
        return respondError(socket, ack, result.error, {
          eventName: GROUP_CALL_EVENTS.start,
        });
      }

      const call = result.data;
      socket.join(`group-call:${call.callId}`);

      console.log('[GroupCallSocket] start normalized receivers', {
        callerUsername: creatorUsername,
        groupId,
        groupFound: groupLookup.found,
        groupMembers: groupLookup.members,
        payloadReceivers,
        sourceMembers,
        receiverUsernames: inviteTargets,
        excludedCaller: creatorUsername,
        onlineUsers: presenceStore.getOnlineUsernames(),
        receiverSocketMap: inviteTargets.map(getUserSocketDebug),
        callerRooms: Array.from(socket.rooms || []),
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
          participants: sourceMembers,
          invitedParticipants: inviteTargets,
          call: {
            callId: call.callId,
            groupId: call.groupId,
            createdBy: creatorUsername,
            creatorUsername,
            participants: sourceMembers.map((memberUsername) => ({
              username: memberUsername,
              joined: memberUsername === creatorUsername,
            })),
          },
          activeGroupCall: call,
        });
      });

      debug('Group call started and incoming emitted', {
        call: summarizeCall(call),
        inviteTargets,
        inviteTargetDebug: inviteTargets.map(getUserSocketDebug),
      });

      return respondSuccess(ack, {
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

      return respondError(socket, ack, 'Could not start group call');
    }
  });

  socket.on(GROUP_CALL_EVENTS.join, (payload = {}, ack) => {
    const username = getSocketUsername(socket);

    try {
      const { callId, groupId, roomId } = payload;
      const activeCallsBefore = groupCallService.getDebugSnapshot();
      const foundCallResult = groupCallService.getGroupCall(callId);
      const foundCall = foundCallResult.ok ? foundCallResult.data : null;
      const existingParticipant = groupCallService.getParticipant({ callId, username });

      debug('Received group-call:join', {
        callId,
        groupId: groupId || null,
        roomId: roomId || null,
        username,
        socketId: socket.id,
        activeGroupCalls: activeCallsBefore,
        callFound: Boolean(foundCall),
        existingParticipant: Boolean(existingParticipant),
        participantsBeforeJoin: foundCall?.participants || [],
        roomsBeforeJoin: Array.from(socket.rooms || []),
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
        return respondError(socket, ack, result.error, {
          eventName: GROUP_CALL_EVENTS.join,
          callId,
        });
      }

      const call = result.data;
      socket.join(`group-call:${call.callId}`);

      debug('group-call:join store after addParticipant', {
        username,
        socketId: socket.id,
        callId: call.callId,
        groupId: call.groupId,
        activeGroupCalls: groupCallService.getDebugSnapshot(),
        participantsBeforeJoin: beforeParticipants,
        participantsAfterJoin: call.participants,
        roomsAfterJoin: Array.from(socket.rooms || []),
      });

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
        callRoom: `group-call:${call.callId}`,
        rooms: Array.from(socket.rooms || []),
        beforeParticipantUsernames: beforeParticipants.map(
          (participant) => participant.username
        ),
      });

      return respondSuccess(ack, {
        ok: true,
        call,
      });
    } catch (error) {
      errorLog('group-call:join failed', error, {
        username,
        socketId: socket.id,
        payload,
      });

      return respondError(socket, ack, 'Could not join group call');
    }
  });

  socket.on(GROUP_CALL_EVENTS.rejoin, (payload = {}, ack) => {
    const username = getSocketUsername(socket);

    try {
      const { callId, groupId, roomId } = payload;
      const activeCallsBefore = groupCallService.getDebugSnapshot();
      const foundCallResult = groupCallService.getGroupCall(callId);
      const foundCall = foundCallResult.ok ? foundCallResult.data : null;
      const existingParticipant = groupCallService.getParticipant({ callId, username });

      debug('Received group-call:rejoin', {
        callId,
        groupId: groupId || null,
        roomId: roomId || null,
        username,
        socketId: socket.id,
        userSockets: getUserSocketDebug(username),
        activeGroupCalls: activeCallsBefore,
        callFound: Boolean(foundCall),
        existingParticipant: Boolean(existingParticipant),
        participantsBeforeRejoin: foundCall?.participants || [],
        roomsBeforeRejoin: Array.from(socket.rooms || []),
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
        return respondError(socket, ack, result.error, {
          eventName: GROUP_CALL_EVENTS.rejoin,
          callId,
        });
      }

      const call = result.data;
      const participant = groupCallService.getParticipant({ callId, username });
      socket.join(`group-call:${call.callId}`);

      socket.emit(GROUP_CALL_EVENTS.rejoined, {
        callId: call.callId,
        groupId: call.groupId,
        call,
        participant,
        participants: call.participants,
        rejoined: true,
      });

      emitToParticipants(
        io,
        beforeParticipants,
        GROUP_CALL_EVENTS.userJoined,
        {
          callId: call.callId,
          groupId: call.groupId,
          username,
          participant,
          participants: call.participants,
          rejoined: true,
        },
        username
      );

      debug('User rejoined group call', {
        username,
        call: summarizeCall(call),
        callRoom: `group-call:${call.callId}`,
        rooms: Array.from(socket.rooms || []),
        previousParticipantUsernames: beforeParticipants.map(
          (participantItem) => participantItem.username
        ),
        receiverSocketMap: beforeParticipants
          .filter((participantItem) => participantItem.username !== username)
          .map((participantItem) => getUserSocketDebug(participantItem.username)),
      });

      return respondSuccess(ack, {
        ok: true,
        call,
        participant,
        rejoined: true,
      });
    } catch (error) {
      errorLog('group-call:rejoin failed', error, {
        username,
        socketId: socket.id,
        payload,
      });

      return respondError(socket, ack, 'Could not rejoin group call');
    }
  });

  socket.on(GROUP_CALL_EVENTS.leave, (payload = {}, ack) => {
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
        return respondError(socket, ack, result.error, {
          eventName: GROUP_CALL_EVENTS.leave,
          callId,
        });
      }

      const { call, previousParticipants, isEnded } = result.data;
      socket.leave(`group-call:${callId}`);

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

      return respondSuccess(ack, {
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

      return respondError(socket, ack, 'Could not leave group call');
    }
  });

  socket.on(GROUP_CALL_EVENTS.end, (payload = {}, ack) => {
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
        return respondError(socket, ack, result.error, {
          eventName: GROUP_CALL_EVENTS.end,
          callId,
        });
      }

      const { call, previousParticipants } = result.data;
      socket.leave(`group-call:${callId}`);

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

      return respondSuccess(ack, {
        ok: true,
        call,
      });
    } catch (error) {
      errorLog('group-call:end failed', error, {
        username,
        socketId: socket.id,
        payload,
      });

      return respondError(socket, ack, 'Could not end group call');
    }
  });

  socket.on(GROUP_CALL_EVENTS.offer, (payload = {}, ack) => {
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
        return respondError(socket, ack, 'offer is required', {
          callId,
          targetUsername,
        });
      }

      const valid = validateSignalingParticipant({
        callId,
        fromUsername,
        targetUsername,
        socket,
      });

      if (!valid) {
        return respondError(socket, ack, 'Invalid group call offer relay', {
          callId,
          targetUsername,
        });
      }

      debug('SEND OFFER', {
        callId,
        fromUsername,
        targetUsername,
        target: getUserSocketDebug(targetUsername),
      });

      emitToUser(io, targetUsername, GROUP_CALL_EVENTS.offer, {
        callId,
        fromUsername,
        offer,
      });

      return respondSuccess(ack, { ok: true });
    } catch (error) {
      errorLog('group-call:offer failed', error, {
        fromUsername,
        payload: {
          callId: payload.callId,
          targetUsername: payload.targetUsername,
          offer: describeSessionDescription(payload.offer),
        },
      });

      return respondError(socket, ack, 'Could not relay group call offer');
    }
  });

  socket.on(GROUP_CALL_EVENTS.answer, (payload = {}, ack) => {
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
        return respondError(socket, ack, 'answer is required', {
          callId,
          targetUsername,
        });
      }

      const valid = validateSignalingParticipant({
        callId,
        fromUsername,
        targetUsername,
        socket,
      });

      if (!valid) {
        return respondError(socket, ack, 'Invalid group call answer relay', {
          callId,
          targetUsername,
        });
      }

      debug('SEND ANSWER', {
        callId,
        fromUsername,
        targetUsername,
        target: getUserSocketDebug(targetUsername),
      });

      emitToUser(io, targetUsername, GROUP_CALL_EVENTS.answer, {
        callId,
        fromUsername,
        answer,
      });

      return respondSuccess(ack, { ok: true });
    } catch (error) {
      errorLog('group-call:answer failed', error, {
        fromUsername,
        payload: {
          callId: payload.callId,
          targetUsername: payload.targetUsername,
          answer: describeSessionDescription(payload.answer),
        },
      });

      return respondError(socket, ack, 'Could not relay group call answer');
    }
  });

  socket.on(GROUP_CALL_EVENTS.iceCandidate, (payload = {}, ack) => {
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
        return respondError(socket, ack, 'candidate is required', {
          callId,
          targetUsername,
        });
      }

      const valid = validateSignalingParticipant({
        callId,
        fromUsername,
        targetUsername,
        socket,
      });

      if (!valid) {
        return respondError(socket, ack, 'Invalid group call ice candidate relay', {
          callId,
          targetUsername,
        });
      }

      debug('SEND ICE', {
        callId,
        fromUsername,
        targetUsername,
        candidate: describeCandidate(candidate),
        target: getUserSocketDebug(targetUsername),
      });

      emitToUser(io, targetUsername, GROUP_CALL_EVENTS.iceCandidate, {
        callId,
        fromUsername,
        candidate,
      });

      return respondSuccess(ack, { ok: true });
    } catch (error) {
      errorLog('group-call:ice-candidate failed', error, {
        fromUsername,
        payload: {
          callId: payload.callId,
          targetUsername: payload.targetUsername,
          candidate: describeCandidate(payload.candidate),
        },
      });

      return respondError(socket, ack, 'Could not relay group call ice candidate');
    }
  });

  socket.on(GROUP_CALL_EVENTS.mediaState, (payload = {}, ack) => {
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
        return respondError(socket, ack, result.error, {
          eventName: GROUP_CALL_EVENTS.mediaState,
          callId,
        });
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

      return respondSuccess(ack, {
        ok: true,
        call,
      });
    } catch (error) {
      errorLog('group-call:media-state failed', error, {
        username,
        socketId: socket.id,
        payload,
      });

      return respondError(socket, ack, 'Could not update group call media state');
    }
  });

  // Group Screen Share UI events (only notify UI, does not affect WebRTC)
  function handleGroupScreenShareEvent(isSharing) {
    return (payload = {}, ack) => {
      const username = getSocketUsername(socket);
      const { callId, groupId } = payload;
      const eventName = isSharing
        ? 'group-call:screen-share-started'
        : 'group-call:screen-share-stopped';

      try {
        debug('Received group screen-share event', {
          username,
          socketId: socket.id,
          callId,
          groupId,
          isSharing,
        });

        if (!callId) {
          return respondError(socket, ack, 'callId is required', {
            eventName,
          });
        }

        if (!isUserInCall(callId, username)) {
          return respondError(socket, ack, 'Sender is not in group call', {
            callId,
            groupId,
            username,
          });
        }

        const participantsResult = groupCallService.getParticipants(callId);
        if (!participantsResult.ok) {
          return respondError(
            socket,
            ack,
            participantsResult.error || 'Could not get group call participants',
            {
              callId,
              groupId,
            }
          );
        }

        const broadcastPayload = {
          callId,
          groupId: groupId || null,
          username,
          socketId: socket.id,
          isScreenSharing: isSharing,
          timestamp: Date.now(),
        };

        emitToParticipants(
          io,
          participantsResult.data,
          eventName,
          broadcastPayload,
          username
        );

        safeAck(ack, {
          ok: true,
          ...broadcastPayload,
        });

        debug(`${eventName} broadcast`, {
          callId,
          groupId: broadcastPayload.groupId,
          username,
          isSharing,
        });
      } catch (error) {
        errorLog('group screen-share event failed', error, {
          username,
          callId,
          groupId,
          isSharing,
        });

        return respondError(socket, ack, 'Could not update group screen share state', {
          callId,
          groupId,
          isSharing,
        });
      }
    };
  }

  socket.on('group-call:screen-share-started', handleGroupScreenShareEvent(true));
  socket.on('group-call:screen-share-stopped', handleGroupScreenShareEvent(false));

  socket.on('disconnect', (reason) => {
    const username = getSocketUsername(socket);

    try {
      debug('Socket disconnected for group call handler', {
        username,
        socketId: socket.id,
        reason,
        stillOnline: presenceStore.isOnline(username),
        cleanupDelayMs: DISCONNECT_CLEANUP_DELAY_MS,
      });

      setTimeout(() => {
        cleanupDisconnectedGroupCallSocket(io, socket, reason);
      }, DISCONNECT_CLEANUP_DELAY_MS);

      debug('Group call disconnect cleanup scheduled', {
        username,
        socketId: socket.id,
        delayMs: DISCONNECT_CLEANUP_DELAY_MS,
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
