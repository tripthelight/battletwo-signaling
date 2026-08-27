const MESSAGE_TYPES = Object.freeze({
  JOIN: 'join',
  SIGNAL: 'signal',
  REQUEST_STORAGE: 'requestStorage',
});

const ROLES = new Set(['impolite', 'polite']);

const MAX_SIGNAL_DATA_LENGTH = 64 * 1024;
const MAX_GAME_NAME_LENGTH = 64;
const MAX_RESUME_TOKEN_LENGTH = 128;

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function isNonEmptyString(value, maxLength) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength
  );
}

function validateJoin(message) {
  if (
    message.resumeToken !== undefined &&
    message.resumeToken !== null &&
    !isNonEmptyString(
      message.resumeToken,
      MAX_RESUME_TOKEN_LENGTH,
    )
  ) {
    return {
      ok: false,
      error: 'invalid_resume_token',
    };
  }

  return {
    ok: true,
    value: {
      type: MESSAGE_TYPES.JOIN,
      resumeToken: message.resumeToken ?? null,
    },
  };
}

function validateSignal(message) {
  if (!isNonEmptyString(message.to, 64)) {
    return {
      ok: false,
      error: 'invalid_signal_target',
    };
  }

  if (!isPlainObject(message.data)) {
    return {
      ok: false,
      error: 'invalid_signal_data',
    };
  }

  let serialized;

  try {
    serialized = JSON.stringify(message.data);
  } catch {
    return {
      ok: false,
      error: 'invalid_signal_data',
    };
  }

  if (serialized.length > MAX_SIGNAL_DATA_LENGTH) {
    return {
      ok: false,
      error: 'signal_data_too_large',
    };
  }

  return {
    ok: true,
    value: {
      type: MESSAGE_TYPES.SIGNAL,
      to: message.to,
      data: message.data,
    },
  };
}

function validateRequestStorage(message) {
  if (
    !isNonEmptyString(
      message.gameName,
      MAX_GAME_NAME_LENGTH,
    )
  ) {
    return {
      ok: false,
      error: 'invalid_game_name',
    };
  }

  if (!ROLES.has(message.initRole)) {
    return {
      ok: false,
      error: 'invalid_init_role',
    };
  }

  return {
    ok: true,
    value: {
      type: MESSAGE_TYPES.REQUEST_STORAGE,
      gameName: message.gameName,
      initRole: message.initRole,
    },
  };
}

export function parseClientMessage(raw) {
  let message;

  try {
    message = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      error: 'invalid_json',
    };
  }

  if (!isPlainObject(message)) {
    return {
      ok: false,
      error: 'invalid_message',
    };
  }

  switch (message.type) {
    case MESSAGE_TYPES.JOIN:
      return validateJoin(message);

    case MESSAGE_TYPES.SIGNAL:
      return validateSignal(message);

    case MESSAGE_TYPES.REQUEST_STORAGE:
      return validateRequestStorage(message);

    default:
      return {
        ok: false,
        error: 'unsupported_message_type',
      };
  }
}

export {
  MESSAGE_TYPES,
};