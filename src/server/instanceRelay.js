import {
  makeInstanceChannel,
} from './redis.js';

const INTERNAL_MESSAGE_TYPE =
  'peer-message';

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function isNonEmptyString(
  value,
  maxLength = 128,
) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength
  );
}

export function parseRelayMessage(
  raw,
) {
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

  if (
    message.type !==
    INTERNAL_MESSAGE_TYPE
  ) {
    return {
      ok: false,
      error:
        'unsupported_message_type',
    };
  }

  if (
    !isNonEmptyString(
      message.targetPeerId,
    )
  ) {
    return {
      ok: false,
      error:
        'invalid_target_peer_id',
    };
  }

  if (!isPlainObject(message.payload)) {
    return {
      ok: false,
      error: 'invalid_payload',
    };
  }

  return {
    ok: true,
    value: {
      type:
        INTERNAL_MESSAGE_TYPE,

      targetPeerId:
        message.targetPeerId,

      payload:
        message.payload,
    },
  };
}

export function createInstanceRelay({
  redisContext,
  keyPrefix,
  peerRegistry,
  deliver,
}) {
  if (!redisContext) {
    throw new TypeError(
      'redisContext is required',
    );
  }

  if (
    typeof keyPrefix !== 'string' ||
    keyPrefix.length === 0
  ) {
    throw new TypeError(
      'keyPrefix is required',
    );
  }

  if (
    !peerRegistry ||
    typeof peerRegistry.getSocket !==
      'function'
  ) {
    throw new TypeError(
      'peerRegistry is required',
    );
  }

  if (typeof deliver !== 'function') {
    throw new TypeError(
      'deliver must be a function',
    );
  }

  let started = false;

  const onMessage = (
    channel,
    raw,
  ) => {
    if (
      channel !==
      redisContext.instanceChannel
    ) {
      return;
    }

    const parsed =
      parseRelayMessage(raw);

    if (!parsed.ok) {
      return;
    }

    const {
      targetPeerId,
      payload,
    } = parsed.value;

    const ws =
      peerRegistry.getSocket(
        targetPeerId,
      );

    if (!ws) {
      return;
    }

    deliver(
      ws,
      payload,
    );
  };

  async function start() {
    if (started) {
      return;
    }

    await redisContext.subscriber.subscribe(
      redisContext.instanceChannel,
    );

    redisContext.subscriber.on(
      'message',
      onMessage,
    );

    started = true;
  }

  async function stop() {
    if (!started) {
      return;
    }

    redisContext.subscriber.off(
      'message',
      onMessage,
    );

    await redisContext.subscriber.unsubscribe(
      redisContext.instanceChannel,
    );

    started = false;
  }

  async function sendToInstance({
    targetInstanceId,
    targetPeerId,
    payload,
  }) {
    if (
      !isNonEmptyString(
        targetInstanceId,
      )
    ) {
      throw new TypeError(
        'targetInstanceId is required',
      );
    }

    if (
      !isNonEmptyString(
        targetPeerId,
      )
    ) {
      throw new TypeError(
        'targetPeerId is required',
      );
    }

    if (!isPlainObject(payload)) {
      throw new TypeError(
        'payload must be an object',
      );
    }

    const channel =
      makeInstanceChannel(
        keyPrefix,
        targetInstanceId,
      );

    const message =
      JSON.stringify({
        type:
          INTERNAL_MESSAGE_TYPE,

        targetPeerId,
        payload,
      });

    return redisContext.publisher.publish(
      channel,
      message,
    );
  }

  return Object.freeze({
    start,
    stop,
    sendToInstance,
  });
}