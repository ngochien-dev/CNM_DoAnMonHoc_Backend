// store/activeGroupCalls.js

const activeGroupCallsByCallId = new Map();
const activeGroupCallsByGroupId = new Map();

const LOG_PREFIX = '[ActiveGroupCalls]';

function debug(message, extra) {
  if (extra !== undefined) {
    console.log(`${LOG_PREFIX} ${message}`, extra);
  } else {
    console.log(`${LOG_PREFIX} ${message}`);
  }
}

function warn(message, extra) {
  if (extra !== undefined) {
    console.warn(`${LOG_PREFIX} ${message}`, extra);
  } else {
    console.warn(`${LOG_PREFIX} ${message}`);
  }
}

function snapshotCall(call) {
  if (!call) return null;

  return {
    callId: call.callId,
    groupId: call.groupId,
    creatorUsername: call.creatorUsername,
    status: call.status,
    startedAt: call.startedAt,
    endedAt: call.endedAt || null,
    participantCount: call.participants?.size || 0,
    participantUsernames: call.participants
      ? Array.from(call.participants.keys())
      : [],
  };
}

function getDebugSnapshot() {
  const calls = Array.from(activeGroupCallsByCallId.values()).map(snapshotCall);

  return {
    callIds: Array.from(activeGroupCallsByCallId.keys()),
    groupIds: Array.from(activeGroupCallsByGroupId.keys()),
    groupToCallId: Object.fromEntries(activeGroupCallsByGroupId.entries()),
    calls,
  };
}

function createCallId(groupId) {
  const callId = `group-call-${groupId}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  debug('Created callId', { groupId, callId });

  return callId;
}

function cloneParticipant(participant) {
  if (!participant) return null;

  return {
    username: participant.username,
    socketId: participant.socketId,
    joinedAt: participant.joinedAt,
    audioEnabled: participant.audioEnabled,
    videoEnabled: participant.videoEnabled,
  };
}

function serializeCall(call) {
  if (!call) return null;

  return {
    callId: call.callId,
    groupId: call.groupId,
    creatorUsername: call.creatorUsername,
    status: call.status,
    startedAt: call.startedAt,
    endedAt: call.endedAt || null,
    participants: Array.from(call.participants.values()).map(cloneParticipant),
  };
}

function transferCreatorIfNeeded(call, removedUsername) {
  if (!call || call.creatorUsername !== removedUsername || call.participants.size === 0) {
    return;
  }

  const nextCreator = Array.from(call.participants.keys())[0];
  call.creatorUsername = nextCreator;

  debug('Transferred group call creator after disconnect/leave', {
    callId: call.callId,
    groupId: call.groupId,
    removedUsername,
    nextCreator,
  });
}

function startGroupCall({ groupId, creatorUsername, socketId }) {
  debug('startGroupCall called', { groupId, creatorUsername, socketId });

  if (!groupId || !creatorUsername || !socketId) {
    warn('startGroupCall missing required fields', {
      groupId,
      creatorUsername,
      socketId,
    });
    throw new Error('groupId, creatorUsername and socketId are required');
  }

  if (activeGroupCallsByGroupId.has(groupId)) {
    const existingCallId = activeGroupCallsByGroupId.get(groupId);

    warn('startGroupCall rejected because group already has active call', {
      groupId,
      existingCallId,
    });

    throw new Error('This group already has an active call');
  }

  const callId = createCallId(groupId);
  const now = Date.now();

  const call = {
    callId,
    groupId,
    creatorUsername,
    status: 'active',
    startedAt: now,
    endedAt: null,
    participants: new Map(),
  };

  call.participants.set(creatorUsername, {
    username: creatorUsername,
    socketId,
    joinedAt: now,
    audioEnabled: true,
    videoEnabled: true,
  });

  activeGroupCallsByCallId.set(callId, call);
  activeGroupCallsByGroupId.set(groupId, callId);

  debug('Group call started', snapshotCall(call));

  return serializeCall(call);
}

function getGroupCall(callId) {
  const call = activeGroupCallsByCallId.get(callId);

  debug('getGroupCall', {
    callId,
    found: Boolean(call),
    call: snapshotCall(call),
  });

  return serializeCall(call);
}

function getRawGroupCall(callId) {
  const call = activeGroupCallsByCallId.get(callId) || null;

  debug('getRawGroupCall', {
    callId,
    found: Boolean(call),
  });

  return call;
}

function getActiveCallByGroupId(groupId) {
  const callId = activeGroupCallsByGroupId.get(groupId);

  debug('getActiveCallByGroupId', {
    groupId,
    callId: callId || null,
    found: Boolean(callId),
  });

  if (!callId) return null;

  return getGroupCall(callId);
}

function addParticipant({ callId, username, socketId }) {
  debug('addParticipant called', { callId, username, socketId });

  if (!callId || !username || !socketId) {
    warn('addParticipant missing required fields', {
      callId,
      username,
      socketId,
    });
    throw new Error('callId, username and socketId are required');
  }

  const call = activeGroupCallsByCallId.get(callId);

  if (!call || call.status !== 'active') {
    warn('addParticipant rejected because call not found or ended', {
      callId,
      username,
      found: Boolean(call),
      status: call?.status,
    });
    throw new Error('Group call not found or already ended');
  }

  const existingParticipant = call.participants.get(username);
  const now = Date.now();

  call.participants.set(username, {
    username,
    socketId,
    joinedAt: existingParticipant?.joinedAt || now,
    audioEnabled: existingParticipant?.audioEnabled ?? true,
    videoEnabled: existingParticipant?.videoEnabled ?? true,
  });

  debug(existingParticipant ? 'Participant socket updated' : 'Participant added', {
    callId,
    username,
    participantCount: call.participants.size,
    call: snapshotCall(call),
  });

  return serializeCall(call);
}

function removeParticipant({ callId, username }) {
  debug('removeParticipant called', { callId, username });

  if (!callId || !username) {
    warn('removeParticipant missing required fields', { callId, username });
    throw new Error('callId and username are required');
  }

  const call = activeGroupCallsByCallId.get(callId);

  if (!call) {
    warn('removeParticipant rejected because call not found', {
      callId,
      username,
    });
    throw new Error('Group call not found');
  }

  const existed = call.participants.delete(username);
  transferCreatorIfNeeded(call, username);

  debug('Participant removed', {
    callId,
    username,
    existed,
    remainingParticipants: call.participants.size,
    call: snapshotCall(call),
  });

  if (call.participants.size === 0) {
    debug('No participants left, ending group call', { callId });
    endGroupCall(callId);
    return null;
  }

  return serializeCall(call);
}

function updateParticipantMediaState({ callId, username, audioEnabled, videoEnabled }) {
  debug('updateParticipantMediaState called', {
    callId,
    username,
    audioEnabled,
    videoEnabled,
  });

  if (!callId || !username) {
    warn('updateParticipantMediaState missing required fields', {
      callId,
      username,
    });
    throw new Error('callId and username are required');
  }

  const call = activeGroupCallsByCallId.get(callId);

  if (!call || call.status !== 'active') {
    warn('updateParticipantMediaState rejected because call not found or ended', {
      callId,
      username,
      found: Boolean(call),
      status: call?.status,
    });
    throw new Error('Group call not found or already ended');
  }

  const participant = call.participants.get(username);

  if (!participant) {
    warn('updateParticipantMediaState rejected because user is not participant', {
      callId,
      username,
    });
    throw new Error('User is not a participant in this call');
  }

  if (typeof audioEnabled === 'boolean') {
    participant.audioEnabled = audioEnabled;
  }

  if (typeof videoEnabled === 'boolean') {
    participant.videoEnabled = videoEnabled;
  }

  debug('Participant media state updated', {
    callId,
    username,
    audioEnabled: participant.audioEnabled,
    videoEnabled: participant.videoEnabled,
  });

  return serializeCall(call);
}

function isParticipant(callId, username) {
  const call = activeGroupCallsByCallId.get(callId);
  const result = Boolean(call && call.participants.has(username));

  debug('isParticipant', {
    callId,
    username,
    result,
  });

  return result;
}

function getParticipant(callId, username) {
  const call = activeGroupCallsByCallId.get(callId);

  if (!call) {
    debug('getParticipant call not found', { callId, username });
    return null;
  }

  const participant = cloneParticipant(call.participants.get(username));

  debug('getParticipant', {
    callId,
    username,
    found: Boolean(participant),
  });

  return participant;
}

function getParticipants(callId) {
  const call = activeGroupCallsByCallId.get(callId);

  if (!call) {
    debug('getParticipants call not found', { callId });
    return [];
  }

  const participants = Array.from(call.participants.values()).map(cloneParticipant);

  debug('getParticipants', {
    callId,
    participantCount: participants.length,
    participantUsernames: participants.map((participant) => participant.username),
  });

  return participants;
}

function endGroupCall(callId) {
  debug('endGroupCall called', { callId });

  const call = activeGroupCallsByCallId.get(callId);

  if (!call) {
    warn('endGroupCall ignored because call not found', { callId });
    return null;
  }

  call.status = 'ended';
  call.endedAt = Date.now();

  const endedCall = serializeCall(call);

  activeGroupCallsByCallId.delete(callId);
  activeGroupCallsByGroupId.delete(call.groupId);

  debug('Group call ended and removed from store', {
    callId,
    groupId: call.groupId,
    endedAt: call.endedAt,
    previousParticipants: endedCall.participants.map(
      (participant) => participant.username
    ),
  });

  return endedCall;
}

function removeParticipantFromAllCalls(username) {
  debug('removeParticipantFromAllCalls called', { username });

  if (!username) {
    warn('removeParticipantFromAllCalls ignored because username missing');
    return [];
  }

  const affectedCalls = [];

  for (const call of activeGroupCallsByCallId.values()) {
    if (call.participants.has(username)) {
      call.participants.delete(username);
      transferCreatorIfNeeded(call, username);

      debug('Participant removed from active call during cleanup', {
        username,
        callId: call.callId,
        groupId: call.groupId,
        remainingParticipants: call.participants.size,
      });

      if (call.participants.size === 0) {
        debug('Cleanup ending empty group call', { callId: call.callId });
        endGroupCall(call.callId);
        affectedCalls.push(null);
      } else {
        affectedCalls.push(serializeCall(call));
      }
    }
  }

  debug('removeParticipantFromAllCalls finished', {
    username,
    affectedCallCount: affectedCalls.length,
  });

  return affectedCalls;
}

function removeParticipantBySocketId(socketId) {
  debug('removeParticipantBySocketId called', { socketId });

  if (!socketId) {
    warn('removeParticipantBySocketId ignored because socketId missing');
    return [];
  }

  const affectedCalls = [];

  for (const call of activeGroupCallsByCallId.values()) {
    const participant = Array.from(call.participants.values()).find(
      (item) => item.socketId === socketId
    );

    if (!participant) continue;

    call.participants.delete(participant.username);
    transferCreatorIfNeeded(call, participant.username);

    debug('Participant removed from active call by socket cleanup', {
      username: participant.username,
      socketId,
      callId: call.callId,
      groupId: call.groupId,
      remainingParticipants: call.participants.size,
    });

    if (call.participants.size === 0) {
      debug('Socket cleanup ending empty group call', { callId: call.callId });
      endGroupCall(call.callId);
      affectedCalls.push({
        call: null,
        previousUsername: participant.username,
        previousSocketId: socketId,
      });
    } else {
      affectedCalls.push({
        call: serializeCall(call),
        previousUsername: participant.username,
        previousSocketId: socketId,
      });
    }
  }

  return affectedCalls;
}

function cleanupStaleCalls({ maxAgeMs = 6 * 60 * 60 * 1000 } = {}) {
  const now = Date.now();
  const removedCalls = [];

  for (const call of Array.from(activeGroupCallsByCallId.values())) {
    const isEmpty = call.participants.size === 0;
    const isTooOld = now - call.startedAt > maxAgeMs;

    if (!isEmpty && !isTooOld) continue;

    const endedCall = endGroupCall(call.callId);

    removedCalls.push({
      reason: isEmpty ? 'empty' : 'stale',
      call: endedCall,
    });
  }

  if (removedCalls.length > 0) {
    debug('cleanupStaleCalls removed calls', {
      removedCount: removedCalls.length,
      removedCalls: removedCalls.map((item) => ({
        reason: item.reason,
        callId: item.call?.callId || null,
        groupId: item.call?.groupId || null,
      })),
    });
  }

  return removedCalls;
}

module.exports = {
  startGroupCall,
  getGroupCall,
  getRawGroupCall,
  getActiveCallByGroupId,
  addParticipant,
  removeParticipant,
  updateParticipantMediaState,
  isParticipant,
  getParticipant,
  getParticipants,
  endGroupCall,
  removeParticipantFromAllCalls,
  removeParticipantBySocketId,
  cleanupStaleCalls,
  getDebugSnapshot,
};
