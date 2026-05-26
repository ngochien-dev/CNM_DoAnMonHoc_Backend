// services/groupCallService.js

const activeGroupCalls = require('../store/activeGroupCalls');

const LOG_PREFIX = '[GroupCallService]';

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

function errorLog(message, extra) {
  if (extra !== undefined) {
    console.error(`${LOG_PREFIX} ${message}`, extra);
  } else {
    console.error(`${LOG_PREFIX} ${message}`);
  }
}

function success(data) {
  debug('Returning success response', buildResultSnapshot(data));
  return { ok: true, data };
}

function failure(error) {
  const message = error instanceof Error ? error.message : String(error);
  warn('Returning failure response', { error: message });

  return {
    ok: false,
    error: message,
  };
}

function normalizeUsername(username) {
  const normalized = typeof username === 'string' ? username.trim() : username;

  if (username !== normalized) {
    debug('Normalized username', {
      before: username,
      after: normalized,
    });
  }

  return normalized;
}

function buildCallSnapshot(call) {
  if (!call) return null;

  return {
    callId: call.callId,
    groupId: call.groupId,
    creatorUsername: call.creatorUsername,
    status: call.status,
    participantCount: Array.isArray(call.participants)
      ? call.participants.length
      : 0,
    participantUsernames: Array.isArray(call.participants)
      ? call.participants.map((participant) => participant.username)
      : [],
  };
}

function buildResultSnapshot(data) {
  if (!data) return data;

  if (Array.isArray(data)) {
    return {
      type: 'array',
      length: data.length,
      usernames: data
        .filter((item) => item && item.username)
        .map((item) => item.username),
    };
  }

  if (data.callId && data.participants) {
    return buildCallSnapshot(data);
  }

  if (data.call || data.previousParticipants) {
    return {
      call: buildCallSnapshot(data.call),
      previousParticipantCount: Array.isArray(data.previousParticipants)
        ? data.previousParticipants.length
        : 0,
      previousParticipantUsernames: Array.isArray(data.previousParticipants)
        ? data.previousParticipants.map((participant) => participant.username)
        : [],
      isEnded: data.isEnded,
    };
  }

  return data;
}

function startGroupCall({ groupId, creatorUsername, socketId }) {
  debug('startGroupCall called', {
    groupId,
    creatorUsername,
    socketId,
  });

  try {
    const normalizedCreator = normalizeUsername(creatorUsername);

    if (!groupId || !normalizedCreator || !socketId) {
      warn('startGroupCall validation failed', {
        hasGroupId: Boolean(groupId),
        hasCreatorUsername: Boolean(normalizedCreator),
        hasSocketId: Boolean(socketId),
      });
      return failure('groupId, creatorUsername and socketId are required');
    }

    const existingCall = activeGroupCalls.getActiveCallByGroupId(groupId);

    if (existingCall) {
      warn('startGroupCall blocked because group already has active call', {
        groupId,
        existingCall: buildCallSnapshot(existingCall),
      });
      return failure('This group already has an active call');
    }

    const call = activeGroupCalls.startGroupCall({
      groupId,
      creatorUsername: normalizedCreator,
      socketId,
    });

    debug('Started group call', buildCallSnapshot(call));

    return success(call);
  } catch (error) {
    errorLog('startGroupCall crashed', {
      message: error.message,
      stack: error.stack,
    });
    return failure(error);
  }
}

function joinGroupCall({ callId, username, socketId }) {
  debug('joinGroupCall called', {
    callId,
    username,
    socketId,
  });

  try {
    const normalizedUsername = normalizeUsername(username);

    if (!callId || !normalizedUsername || !socketId) {
      warn('joinGroupCall validation failed', {
        hasCallId: Boolean(callId),
        hasUsername: Boolean(normalizedUsername),
        hasSocketId: Boolean(socketId),
      });
      return failure('callId, username and socketId are required');
    }

    const beforeParticipants = activeGroupCalls.getParticipants(callId);

    debug('joinGroupCall participants before join', {
      callId,
      participantCount: beforeParticipants.length,
      participantUsernames: beforeParticipants.map(
        (participant) => participant.username
      ),
    });

    const call = activeGroupCalls.addParticipant({
      callId,
      username: normalizedUsername,
      socketId,
    });

    debug('User joined group call', {
      callId,
      username: normalizedUsername,
      beforeParticipantCount: beforeParticipants.length,
      afterCall: buildCallSnapshot(call),
    });

    return success(call);
  } catch (error) {
    errorLog('joinGroupCall crashed', {
      message: error.message,
      stack: error.stack,
    });
    return failure(error);
  }
}

function leaveGroupCall({ callId, username }) {
  debug('leaveGroupCall called', {
    callId,
    username,
  });

  try {
    const normalizedUsername = normalizeUsername(username);

    if (!callId || !normalizedUsername) {
      warn('leaveGroupCall validation failed', {
        hasCallId: Boolean(callId),
        hasUsername: Boolean(normalizedUsername),
      });
      return failure('callId and username are required');
    }

    const beforeLeaveParticipants = activeGroupCalls.getParticipants(callId);

    debug('leaveGroupCall participants before leave', {
      callId,
      username: normalizedUsername,
      participantCount: beforeLeaveParticipants.length,
      participantUsernames: beforeLeaveParticipants.map(
        (participant) => participant.username
      ),
    });

    const isInCall = beforeLeaveParticipants.some(
      (participant) => participant.username === normalizedUsername
    );

    if (!isInCall) {
      warn('leaveGroupCall rejected because user is not participant', {
        callId,
        username: normalizedUsername,
      });
      return failure('User is not a participant in this call');
    }

    const call = activeGroupCalls.removeParticipant({
      callId,
      username: normalizedUsername,
    });

    debug('User left group call', {
      callId,
      username: normalizedUsername,
      remainingParticipants: call?.participants?.length || 0,
      isEnded: !call,
      call: buildCallSnapshot(call),
    });

    return success({
      call,
      previousParticipants: beforeLeaveParticipants,
      isEnded: !call,
    });
  } catch (error) {
    errorLog('leaveGroupCall crashed', {
      message: error.message,
      stack: error.stack,
    });
    return failure(error);
  }
}

function endGroupCall({ callId, username }) {
  debug('endGroupCall called', {
    callId,
    username,
  });

  try {
    const normalizedUsername = normalizeUsername(username);

    if (!callId || !normalizedUsername) {
      warn('endGroupCall validation failed', {
        hasCallId: Boolean(callId),
        hasUsername: Boolean(normalizedUsername),
      });
      return failure('callId and username are required');
    }

    const participants = activeGroupCalls.getParticipants(callId);

    debug('endGroupCall current participants', {
      callId,
      endedBy: normalizedUsername,
      participantCount: participants.length,
      participantUsernames: participants.map((participant) => participant.username),
    });

    if (participants.length === 0) {
      warn('endGroupCall rejected because group call not found', { callId });
      return failure('Group call not found');
    }

    const isInCall = participants.some(
      (participant) => participant.username === normalizedUsername
    );

    if (!isInCall) {
      warn('endGroupCall rejected because user is not participant', {
        callId,
        username: normalizedUsername,
      });
      return failure('Only a participant can end this call');
    }

    const endedCall = activeGroupCalls.endGroupCall(callId);

    debug('Ended group call', {
      callId,
      endedBy: normalizedUsername,
      endedCall: buildCallSnapshot(endedCall),
    });

    return success({
      call: endedCall,
      previousParticipants: participants,
    });
  } catch (error) {
    errorLog('endGroupCall crashed', {
      message: error.message,
      stack: error.stack,
    });
    return failure(error);
  }
}

function getGroupCall(callId) {
  debug('getGroupCall called', { callId });

  try {
    if (!callId) {
      warn('getGroupCall validation failed', { hasCallId: Boolean(callId) });
      return failure('callId is required');
    }

    const call = activeGroupCalls.getGroupCall(callId);

    if (!call) {
      warn('getGroupCall not found', { callId });
      return failure('Group call not found');
    }

    debug('getGroupCall found call', buildCallSnapshot(call));

    return success(call);
  } catch (error) {
    errorLog('getGroupCall crashed', {
      message: error.message,
      stack: error.stack,
    });
    return failure(error);
  }
}

function getParticipants(callId) {
  debug('getParticipants called', { callId });

  try {
    if (!callId) {
      warn('getParticipants validation failed', { hasCallId: Boolean(callId) });
      return failure('callId is required');
    }

    const participants = activeGroupCalls.getParticipants(callId);

    debug('getParticipants result', {
      callId,
      participantCount: participants.length,
      participantUsernames: participants.map((participant) => participant.username),
    });

    return success(participants);
  } catch (error) {
    errorLog('getParticipants crashed', {
      message: error.message,
      stack: error.stack,
    });
    return failure(error);
  }
}

function updateMediaState({ callId, username, audioEnabled, videoEnabled }) {
  debug('updateMediaState called', {
    callId,
    username,
    audioEnabled,
    videoEnabled,
  });

  try {
    const normalizedUsername = normalizeUsername(username);

    if (!callId || !normalizedUsername) {
      warn('updateMediaState validation failed', {
        hasCallId: Boolean(callId),
        hasUsername: Boolean(normalizedUsername),
      });
      return failure('callId and username are required');
    }

    if (
      typeof audioEnabled !== 'boolean' &&
      typeof videoEnabled !== 'boolean'
    ) {
      warn('updateMediaState called without boolean media values', {
        callId,
        username: normalizedUsername,
        audioEnabled,
        videoEnabled,
      });
    }

    const call = activeGroupCalls.updateParticipantMediaState({
      callId,
      username: normalizedUsername,
      audioEnabled,
      videoEnabled,
    });

    debug('Updated media state', {
      callId,
      username: normalizedUsername,
      audioEnabled,
      videoEnabled,
      call: buildCallSnapshot(call),
    });

    return success(call);
  } catch (error) {
    errorLog('updateMediaState crashed', {
      message: error.message,
      stack: error.stack,
    });
    return failure(error);
  }
}

function isParticipant({ callId, username }) {
  debug('isParticipant called', {
    callId,
    username,
  });

  try {
    const normalizedUsername = normalizeUsername(username);

    if (!callId || !normalizedUsername) {
      warn('isParticipant validation failed', {
        hasCallId: Boolean(callId),
        hasUsername: Boolean(normalizedUsername),
      });
      return false;
    }

    const result = activeGroupCalls.isParticipant(callId, normalizedUsername);

    debug('isParticipant result', {
      callId,
      username: normalizedUsername,
      result,
    });

    return result;
  } catch (error) {
    errorLog('isParticipant crashed', {
      message: error.message,
      stack: error.stack,
    });
    return false;
  }
}

function getParticipant({ callId, username }) {
  debug('getParticipant called', {
    callId,
    username,
  });

  try {
    const normalizedUsername = normalizeUsername(username);

    if (!callId || !normalizedUsername) {
      warn('getParticipant validation failed', {
        hasCallId: Boolean(callId),
        hasUsername: Boolean(normalizedUsername),
      });
      return null;
    }

    const participant = activeGroupCalls.getParticipant(callId, normalizedUsername);

    debug('getParticipant result', {
      callId,
      username: normalizedUsername,
      found: Boolean(participant),
      participant,
    });

    return participant;
  } catch (error) {
    errorLog('getParticipant crashed', {
      message: error.message,
      stack: error.stack,
    });
    return null;
  }
}

function removeParticipantFromAllCalls(username) {
  debug('removeParticipantFromAllCalls called', { username });

  try {
    const normalizedUsername = normalizeUsername(username);

    if (!normalizedUsername) {
      warn('removeParticipantFromAllCalls skipped because username missing');
      return success([]);
    }

    const affectedCalls = activeGroupCalls.removeParticipantFromAllCalls(
      normalizedUsername
    );

    debug('Removed user from all group calls', {
      username: normalizedUsername,
      affectedCalls: affectedCalls.length,
      affectedCallSnapshots: affectedCalls.map(buildCallSnapshot),
    });

    return success(affectedCalls);
  } catch (error) {
    errorLog('removeParticipantFromAllCalls crashed', {
      message: error.message,
      stack: error.stack,
    });
    return failure(error);
  }
}

function removeParticipantBySocketId(socketId) {
  debug('removeParticipantBySocketId called', { socketId });

  try {
    if (!socketId) {
      warn('removeParticipantBySocketId skipped because socketId missing');
      return success([]);
    }

    const affectedCalls = activeGroupCalls.removeParticipantBySocketId(socketId);

    debug('Removed socket from group calls', {
      socketId,
      affectedCalls: affectedCalls.length,
    });

    return success(affectedCalls);
  } catch (error) {
    errorLog('removeParticipantBySocketId crashed', {
      message: error.message,
      stack: error.stack,
    });
    return failure(error);
  }
}

function cleanupStaleCalls(options = {}) {
  debug('cleanupStaleCalls called', options);

  try {
    return success(activeGroupCalls.cleanupStaleCalls(options));
  } catch (error) {
    errorLog('cleanupStaleCalls crashed', {
      message: error.message,
      stack: error.stack,
    });
    return failure(error);
  }
}

function getDebugSnapshot() {
  try {
    return activeGroupCalls.getDebugSnapshot();
  } catch (error) {
    errorLog('getDebugSnapshot crashed', {
      message: error.message,
      stack: error.stack,
    });
    return {
      callIds: [],
      groupIds: [],
      groupToCallId: {},
      calls: [],
      error: error.message,
    };
  }
}

module.exports = {
  startGroupCall,
  joinGroupCall,
  leaveGroupCall,
  endGroupCall,
  getGroupCall,
  getParticipants,
  updateMediaState,
  isParticipant,
  getParticipant,
  removeParticipantFromAllCalls,
  removeParticipantBySocketId,
  cleanupStaleCalls,
  getDebugSnapshot,
};
