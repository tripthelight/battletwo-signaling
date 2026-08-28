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

function assertDueAtMs(
  dueAtMs,
) {
  if (
    !Number.isSafeInteger(dueAtMs) ||
    dueAtMs < 0
  ) {
    throw new TypeError(
      'dueAtMs must be a non-negative safe integer',
    );
  }
}

function assertCleanupLimit(
  limit,
) {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1_000
  ) {
    throw new TypeError(
      'limit must be an integer between 1 and 1000',
    );
  }
}

function parseCleanupDueResult(
  result,
) {
  if (
    !Array.isArray(result) ||
    result.length % 3 !== 0
  ) {
    throw new Error(
      'invalid room cleanup result',
    );
  }

  const cleaned = [];

  for (
    let index = 0;
    index < result.length;
    index += 3
  ) {
    const roomId =
      result[index];

    const expiredPeerId =
      result[index + 1];

    const partnerPeerId =
      result[index + 2];

    assertRoomId(
      roomId,
    );

    assertPeerId(
      expiredPeerId,
    );

    assertPeerId(
      partnerPeerId,
    );

    cleaned.push({
      roomId,
      expiredPeerId,
      partnerPeerId,
    });
  }

  return cleaned;
}

export function makePeerRoomKey(
  keyPrefix,
  peerId,
) {
  assertKeyPrefix(
    keyPrefix,
  );

  assertPeerId(
    peerId,
  );

  return (
    `${keyPrefix}:peer-room:${peerId}`
  );
}

export function makeRoomKey(
  keyPrefix,
  roomId,
) {
  assertKeyPrefix(
    keyPrefix,
  );

  assertRoomId(
    roomId,
  );

  return (
    `${keyPrefix}:room:${roomId}`
  );
}

export function makeRoomCleanupKey(
  keyPrefix,
) {
  assertKeyPrefix(
    keyPrefix,
  );

  return (
    `${keyPrefix}:room-cleanup`
  );
}

export function makeRoomCleanupRoomKey(
  keyPrefix,
) {
  assertKeyPrefix(
    keyPrefix,
  );

  return (
    `${keyPrefix}:room-cleanup-room`
  );
}

export function createRoomMembership({
  command,
  keyPrefix,
}) {
  if (
    !command ||
    typeof command.get !== 'function' ||
    typeof command.eval !== 'function'
  ) {
    throw new TypeError(
      'Redis command client is required',
    );
  }

  assertKeyPrefix(
    keyPrefix,
  );

  const cleanupKey =
    makeRoomCleanupKey(
      keyPrefix,
    );

  const cleanupRoomKey =
    makeRoomCleanupRoomKey(
      keyPrefix,
    );

  async function findRoom(
    peerId,
  ) {
    assertPeerId(
      peerId,
    );

    return command.get(
      makePeerRoomKey(
        keyPrefix,
        peerId,
      ),
    );
  }

  async function arePartners(
    peerId,
    targetPeerId,
  ) {
    assertPeerId(
      peerId,
    );

    assertPeerId(
      targetPeerId,
    );

    if (
      peerId === targetPeerId
    ) {
      return null;
    }

    const peerRoomKey =
      makePeerRoomKey(
        keyPrefix,
        peerId,
      );

    const targetRoomKey =
      makePeerRoomKey(
        keyPrefix,
        targetPeerId,
      );

    const result =
      await command.eval(
        `
          local roomId =
            redis.call(
              'GET',
              KEYS[1]
            )

          if not roomId then
            return nil
          end

          local targetRoomId =
            redis.call(
              'GET',
              KEYS[2]
            )

          if
            not targetRoomId or
            roomId ~= targetRoomId
          then
            return nil
          end

          local roomKey =
            ARGV[1] ..
            ':room:' ..
            roomId

          local members =
            redis.call(
              'HMGET',
              roomKey,
              'impolite',
              'polite'
            )

          local impolite =
            members[1]

          local polite =
            members[2]

          if
            not impolite or
            not polite
          then
            return nil
          end

          if
            (
              impolite == ARGV[2] and
              polite == ARGV[3]
            ) or
            (
              impolite == ARGV[3] and
              polite == ARGV[2]
            )
          then
            return roomId
          end

          return nil
        `,
        2,
        peerRoomKey,
        targetRoomKey,
        keyPrefix,
        peerId,
        targetPeerId,
      );

    return result;
  }

  async function scheduleDisconnect({
    peerId,
    dueAtMs,
  }) {
    assertPeerId(
      peerId,
    );

    assertDueAtMs(
      dueAtMs,
    );

    const peerRoomKey =
      makePeerRoomKey(
        keyPrefix,
        peerId,
      );

    const result =
      await command.eval(
        `
          -- room-membership:schedule-disconnect

          local roomId =
            redis.call(
              'GET',
              KEYS[1]
            )

          if not roomId then
            return nil
          end

          local roomKey =
            ARGV[1] ..
            ':room:' ..
            roomId

          local members =
            redis.call(
              'HMGET',
              roomKey,
              'impolite',
              'polite'
            )

          if
            members[1] ~= ARGV[2] and
            members[2] ~= ARGV[2]
          then
            return nil
          end

          redis.call(
            'HSET',
            KEYS[2],
            ARGV[2],
            roomId
          )

          redis.call(
            'ZADD',
            KEYS[3],
            ARGV[3],
            ARGV[2]
          )

          return roomId
        `,
        3,
        peerRoomKey,
        cleanupRoomKey,
        cleanupKey,
        keyPrefix,
        peerId,
        dueAtMs,
      );

    return (
      typeof result === 'string'
        ? result
        : null
    );
  }

  async function cancelDisconnect(
    peerId,
  ) {
    assertPeerId(
      peerId,
    );

    const removed =
      await command.eval(
        `
          -- room-membership:cancel-disconnect

          local removed =
            redis.call(
              'ZREM',
              KEYS[1],
              ARGV[1]
            )

          redis.call(
            'HDEL',
            KEYS[2],
            ARGV[1]
          )

          return removed
        `,
        2,
        cleanupKey,
        cleanupRoomKey,
        peerId,
      );

    return removed === 1;
  }

  async function cleanupDue({
    nowMs = Date.now(),
    limit = 100,
  } = {}) {
    assertDueAtMs(
      nowMs,
    );

    assertCleanupLimit(
      limit,
    );

    const result =
      await command.eval(
        `
          -- room-membership:cleanup-due

          local candidates =
            redis.call(
              'ZRANGEBYSCORE',
              KEYS[1],
              '-inf',
              ARGV[2],
              'LIMIT',
              0,
              ARGV[3]
            )

          local cleaned = {}

          for _, peerId
          in ipairs(candidates)
          do
            local scheduledRoomId =
              redis.call(
                'HGET',
                KEYS[2],
                peerId
              )

            if not scheduledRoomId
            then
              redis.call(
                'ZREM',
                KEYS[1],
                peerId
              )
            else
              local peerRoomKey =
                ARGV[1] ..
                ':peer-room:' ..
                peerId

              local currentRoomId =
                redis.call(
                  'GET',
                  peerRoomKey
                )

              if
                currentRoomId ~=
                scheduledRoomId
              then
                redis.call(
                  'ZREM',
                  KEYS[1],
                  peerId
                )

                redis.call(
                  'HDEL',
                  KEYS[2],
                  peerId
                )
              else
                local roomKey =
                  ARGV[1] ..
                  ':room:' ..
                  scheduledRoomId

                local members =
                  redis.call(
                    'HMGET',
                    roomKey,
                    'impolite',
                    'polite'
                  )

                local impolite =
                  members[1]

                local polite =
                  members[2]

                if
                  not impolite or
                  not polite or
                  (
                    peerId ~= impolite and
                    peerId ~= polite
                  )
                then
                  redis.call(
                    'ZREM',
                    KEYS[1],
                    peerId
                  )

                  redis.call(
                    'HDEL',
                    KEYS[2],
                    peerId
                  )
                else
                  local partnerPeerId

                  if
                    peerId == impolite
                  then
                    partnerPeerId =
                      polite
                  else
                    partnerPeerId =
                      impolite
                  end

                  local partnerRoomKey =
                    ARGV[1] ..
                    ':peer-room:' ..
                    partnerPeerId

                  local partnerRoomId =
                    redis.call(
                      'GET',
                      partnerRoomKey
                    )

                  if
                    partnerRoomId ~=
                    scheduledRoomId
                  then
                    redis.call(
                      'ZREM',
                      KEYS[1],
                      peerId
                    )

                    redis.call(
                      'HDEL',
                      KEYS[2],
                      peerId
                    )
                  else
                    redis.call(
                      'DEL',
                      roomKey,
                      peerRoomKey,
                      partnerRoomKey
                    )

                    redis.call(
                      'ZREM',
                      KEYS[1],
                      peerId,
                      partnerPeerId
                    )

                    redis.call(
                      'HDEL',
                      KEYS[2],
                      peerId,
                      partnerPeerId
                    )

                    table.insert(
                      cleaned,
                      scheduledRoomId
                    )

                    table.insert(
                      cleaned,
                      peerId
                    )

                    table.insert(
                      cleaned,
                      partnerPeerId
                    )
                  end
                end
              end
            end
          end

          return cleaned
        `,
        2,
        cleanupKey,
        cleanupRoomKey,
        keyPrefix,
        nowMs,
        limit,
      );

    return parseCleanupDueResult(
      result,
    );
  }

  return Object.freeze({
    findRoom,
    arePartners,
    scheduleDisconnect,
    cancelDisconnect,
    cleanupDue,
  });
}