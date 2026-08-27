import {
  isValidResumeToken,
  makeResumeSessionKey,
} from './resumeToken.js';

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

function assertKeyPrefix(
  keyPrefix,
) {
  if (
    typeof keyPrefix !== 'string' ||
    keyPrefix.length === 0
  ) {
    throw new TypeError(
      'keyPrefix must be a non-empty string',
    );
  }
}

function assertTtlMs(
  ttlMs,
  name,
) {
  if (
    !Number.isInteger(ttlMs) ||
    ttlMs < 1_000
  ) {
    throw new TypeError(
      `${name} must be an integer >= 1000`,
    );
  }
}

function assertPeerId(
  peerId,
) {
  if (!isNonEmptyString(peerId)) {
    throw new TypeError(
      'peerId must be a non-empty string',
    );
  }
}

function assertRoomId(
  roomId,
) {
  if (!isNonEmptyString(roomId)) {
    throw new TypeError(
      'roomId must be a non-empty string',
    );
  }
}

function assertClaimId(
  claimId,
) {
  if (!isNonEmptyString(claimId)) {
    throw new TypeError(
      'claimId must be a non-empty string',
    );
  }
}

function assertRole(
  role,
) {
  if (
    role !== 'impolite' &&
    role !== 'polite'
  ) {
    throw new TypeError(
      'role must be impolite or polite',
    );
  }
}

function assertToken(
  token,
) {
  if (
    !isValidResumeToken(
      token,
    )
  ) {
    throw new TypeError(
      'invalid resume token',
    );
  }
}

function parseClaimResult(
  result,
) {
  if (
    !Array.isArray(result) ||
    result.length === 0
  ) {
    throw new Error(
      'invalid resume claim result',
    );
  }

  const status =
    result[0];

  if (
    status === 'missing' ||
    status === 'claimed' ||
    status === 'invalid'
  ) {
    return {
      status,
    };
  }

  if (status === 'acquired') {
    const [
      ,
      peerId,
      roomId,
      role,
    ] = result;

    assertPeerId(
      peerId,
    );

    assertRoomId(
      roomId,
    );

    assertRole(
      role,
    );

    return {
      status: 'acquired',
      peerId,
      roomId,
      role,
    };
  }

  throw new Error(
    `unknown resume claim status: ${status}`,
  );
}

export function makeResumeClaimKey(
  keyPrefix,
  token,
) {
  assertKeyPrefix(
    keyPrefix,
  );

  assertToken(
    token,
  );

  return (
    `${makeResumeSessionKey(
      keyPrefix,
      token,
    )}:claim`
  );
}

export function createResumeSessionStore({
  command,
  keyPrefix,
  ttlMs,
  claimTtlMs,
}) {
  if (
    !command ||
    typeof command.eval !== 'function'
  ) {
    throw new TypeError(
      'Redis command client is required',
    );
  }

  assertKeyPrefix(
    keyPrefix,
  );

  assertTtlMs(
    ttlMs,
    'ttlMs',
  );

  assertTtlMs(
    claimTtlMs,
    'claimTtlMs',
  );

  if (
    claimTtlMs >= ttlMs
  ) {
    throw new TypeError(
      'claimTtlMs must be less than ttlMs',
    );
  }

  function sessionKeyFor(
    token,
  ) {
    assertToken(
      token,
    );

    return makeResumeSessionKey(
      keyPrefix,
      token,
    );
  }

  function claimKeyFor(
    token,
  ) {
    return makeResumeClaimKey(
      keyPrefix,
      token,
    );
  }

  async function create({
    token,
    peerId,
    roomId,
    role,
    claimId,
  }) {
    assertPeerId(
      peerId,
    );

    assertRoomId(
      roomId,
    );

    assertRole(
      role,
    );

    assertClaimId(
      claimId,
    );

    const result =
      await command.eval(
        `
          -- resume:create

          if
            redis.call(
              'EXISTS',
              KEYS[1]
            ) == 1 or
            redis.call(
              'EXISTS',
              KEYS[2]
            ) == 1
          then
            return {
              'collision'
            }
          end

          redis.call(
            'HSET',
            KEYS[1],
            'peerId',
            ARGV[1],
            'roomId',
            ARGV[2],
            'role',
            ARGV[3]
          )

          redis.call(
            'PEXPIRE',
            KEYS[1],
            ARGV[5]
          )

          redis.call(
            'SET',
            KEYS[2],
            ARGV[4],
            'PX',
            ARGV[6]
          )

          return {
            'created'
          }
        `,
        2,
        sessionKeyFor(token),
        claimKeyFor(token),
        peerId,
        roomId,
        role,
        claimId,
        ttlMs,
        claimTtlMs,
      );

    return (
      Array.isArray(result) &&
      result[0] === 'created'
    );
  }

  async function claim({
    token,
    claimId,
  }) {
    assertClaimId(
      claimId,
    );

    const result =
      await command.eval(
        `
          -- resume:claim

          if
            redis.call(
              'EXISTS',
              KEYS[1]
            ) == 0
          then
            return {
              'missing'
            }
          end

          local currentClaim =
            redis.call(
              'GET',
              KEYS[2]
            )

          if
            currentClaim and
            currentClaim ~= ARGV[1]
          then
            return {
              'claimed'
            }
          end

          local fields =
            redis.call(
              'HMGET',
              KEYS[1],
              'peerId',
              'roomId',
              'role'
            )

          if
            not fields[1] or
            not fields[2] or
            not fields[3]
          then
            return {
              'invalid'
            }
          end

          redis.call(
            'SET',
            KEYS[2],
            ARGV[1],
            'PX',
            ARGV[3]
          )

          redis.call(
            'PEXPIRE',
            KEYS[1],
            ARGV[2]
          )

          return {
            'acquired',
            fields[1],
            fields[2],
            fields[3]
          }
        `,
        2,
        sessionKeyFor(token),
        claimKeyFor(token),
        claimId,
        ttlMs,
        claimTtlMs,
      );

    return parseClaimResult(
      result,
    );
  }

  async function refresh({
    token,
    claimId,
  }) {
    assertClaimId(
      claimId,
    );

    const result =
      await command.eval(
        `
          -- resume:refresh

          if
            redis.call(
              'GET',
              KEYS[2]
            ) ~= ARGV[1]
          then
            return 0
          end

          if
            redis.call(
              'EXISTS',
              KEYS[1]
            ) == 0
          then
            redis.call(
              'DEL',
              KEYS[2]
            )

            return 0
          end

          redis.call(
            'PEXPIRE',
            KEYS[1],
            ARGV[2]
          )

          redis.call(
            'PEXPIRE',
            KEYS[2],
            ARGV[3]
          )

          return 1
        `,
        2,
        sessionKeyFor(token),
        claimKeyFor(token),
        claimId,
        ttlMs,
        claimTtlMs,
      );

    return result === 1;
  }

  async function release({
    token,
    claimId,
  }) {
    assertClaimId(
      claimId,
    );

    const result =
      await command.eval(
        `
          -- resume:release

          if
            redis.call(
              'GET',
              KEYS[2]
            ) ~= ARGV[1]
          then
            return 0
          end

          redis.call(
            'DEL',
            KEYS[2]
          )

          if
            redis.call(
              'EXISTS',
              KEYS[1]
            ) == 1
          then
            redis.call(
              'PEXPIRE',
              KEYS[1],
              ARGV[2]
            )
          end

          return 1
        `,
        2,
        sessionKeyFor(token),
        claimKeyFor(token),
        claimId,
        ttlMs,
      );

    return result === 1;
  }

  async function remove({
    token,
    claimId,
  }) {
    assertClaimId(
      claimId,
    );

    const result =
      await command.eval(
        `
          -- resume:remove

          if
            redis.call(
              'GET',
              KEYS[2]
            ) ~= ARGV[1]
          then
            return 0
          end

          redis.call(
            'DEL',
            KEYS[2]
          )

          return redis.call(
            'DEL',
            KEYS[1]
          )
        `,
        2,
        sessionKeyFor(token),
        claimKeyFor(token),
        claimId,
      );

    return result === 1;
  }

  return Object.freeze({
    create,
    claim,
    refresh,
    release,
    remove,
  });
}