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

function assertPeerId(peerId) {
  if (!isNonEmptyString(peerId)) {
    throw new TypeError(
      'peerId must be a non-empty string',
    );
  }
}

function assertInstanceId(
  instanceId,
) {
  if (
    !isNonEmptyString(
      instanceId,
    )
  ) {
    throw new TypeError(
      'instanceId must be a non-empty string',
    );
  }
}

function assertTtlMs(ttlMs) {
  if (
    !Number.isInteger(ttlMs) ||
    ttlMs < 1_000
  ) {
    throw new TypeError(
      'ttlMs must be an integer >= 1000',
    );
  }
}

export function makePeerKey(
  keyPrefix,
  peerId,
) {
  if (
    typeof keyPrefix !== 'string' ||
    keyPrefix.length === 0
  ) {
    throw new TypeError(
      'keyPrefix must be a non-empty string',
    );
  }

  assertPeerId(peerId);

  return (
    `${keyPrefix}:peer:${peerId}`
  );
}

export function createPeerDirectory({
  command,
  keyPrefix,
  instanceId,
  ttlMs,
}) {
  if (
    !command ||
    typeof command.set !== 'function' ||
    typeof command.get !== 'function' ||
    typeof command.eval !== 'function'
  ) {
    throw new TypeError(
      'Redis command client is required',
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

  assertInstanceId(instanceId);
  assertTtlMs(ttlMs);

  function keyFor(peerId) {
    return makePeerKey(
      keyPrefix,
      peerId,
    );
  }

  async function register(
    peerId,
  ) {
    assertPeerId(peerId);

    const key =
      keyFor(peerId);

    await command.set(
      key,
      instanceId,
      'PX',
      ttlMs,
    );

    return {
      peerId,
      instanceId,
    };
  }

  async function refresh(
    peerId,
  ) {
    assertPeerId(peerId);

    const key =
      keyFor(peerId);

    const result =
      await command.eval(
        `
          if redis.call(
            'GET',
            KEYS[1]
          ) == ARGV[1] then
            return redis.call(
              'PEXPIRE',
              KEYS[1],
              ARGV[2]
            )
          end

          return 0
        `,
        1,
        key,
        instanceId,
        ttlMs,
      );

    return result === 1;
  }

  async function findInstance(
    peerId,
  ) {
    assertPeerId(peerId);

    return command.get(
      keyFor(peerId),
    );
  }

  async function unregister(
    peerId,
  ) {
    assertPeerId(peerId);

    const key =
      keyFor(peerId);

    const result =
      await command.eval(
        `
          if redis.call(
            'GET',
            KEYS[1]
          ) == ARGV[1] then
            return redis.call(
              'DEL',
              KEYS[1]
            )
          end

          return 0
        `,
        1,
        key,
        instanceId,
      );

    return result === 1;
  }

  return Object.freeze({
    register,
    refresh,
    findInstance,
    unregister,
  });
}