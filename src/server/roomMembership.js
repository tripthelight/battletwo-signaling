import {
  makePeerKey,
} from './peerDirectory.js';

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

function assertPresenceOwner(
  owner,
) {
  if (!isNonEmptyString(owner)) {
    throw new TypeError(
      'expectedPresenceOwner must be a non-empty string',
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

function assertPositiveMs(
  value,
  name,
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 1
  ) {
    throw new TypeError(
      `${name} must be a positive safe integer`,
    );
  }
}

function assertScanCount(
  scanCount,
) {
  if (
    !Number.isInteger(scanCount) ||
    scanCount < 1 ||
    scanCount > 10_000
  ) {
    throw new TypeError(
      'scanCount must be an integer between 1 and 10000',
    );
  }
}

function parseRestoreResult(
  result,
  roomId,
  role,
) {
  if (
    !Array.isArray(result) ||
    result.length === 0
  ) {
    throw new Error(
      'invalid room restore result',
    );
  }

  const status =
    result[0];

  if (status === 'invalid') {
    return null;
  }

  if (status !== 'restored') {
    throw new Error(
      `unknown room restore status: ${status}`,
    );
  }

  const partnerPeerId =
    result[1];

  assertPeerId(
    partnerPeerId,
  );

  return Object.freeze({
    roomId,
    role,
    partnerPeerId,
  });
}

function parseFencedScheduleResult(
  result,
) {
  if (
    !Array.isArray(result) ||
    result.length === 0
  ) {
    throw new Error(
      'invalid fenced disconnect result',
    );
  }

  const status =
    result[0];

  if (
    status ===
    'not-member'
  ) {
    return Object.freeze({
      status:
        'not-member',
    });
  }

  if (
    status ===
    'owner-changed'
  ) {
    const owner =
      result[1];

    assertPresenceOwner(
      owner,
    );

    return Object.freeze({
      status:
        'owner-changed',

      owner,
    });
  }

  if (
    status !==
    'scheduled'
  ) {
    throw new Error(
      `unknown fenced disconnect status: ${status}`,
    );
  }

  const roomId =
    result[1];

  assertRoomId(
    roomId,
  );

  return Object.freeze({
    status:
      'scheduled',

    roomId,
  });
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

export function makeRoomWatchKey(
  keyPrefix,
) {
  assertKeyPrefix(
    keyPrefix,
  );

  return (
    `${keyPrefix}:room-watch`
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

  const roomWatchKey =
    makeRoomWatchKey(
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

  async function restore({
    peerId,
    roomId,
    role,
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

    const peerRoomKey =
      makePeerRoomKey(
        keyPrefix,
        peerId,
      );

    const roomKey =
      makeRoomKey(
        keyPrefix,
        roomId,
      );

    const result =
      await command.eval(
        `
          -- room-membership:restore

          local currentRoomId =
            redis.call(
              'GET',
              KEYS[1]
            )

          if
            not currentRoomId or
            currentRoomId ~= ARGV[1]
          then
            return {
              'invalid'
            }
          end

          local members =
            redis.call(
              'HMGET',
              KEYS[2],
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
            return {
              'invalid'
            }
          end

          local partnerPeerId

          if
            ARGV[3] == 'impolite'
          then
            if
              impolite ~= ARGV[2]
            then
              return {
                'invalid'
              }
            end

            partnerPeerId =
              polite
          elseif
            ARGV[3] == 'polite'
          then
            if
              polite ~= ARGV[2]
            then
              return {
                'invalid'
              }
            end

            partnerPeerId =
              impolite
          else
            return {
              'invalid'
            }
          end

          if
            not partnerPeerId or
            partnerPeerId == ARGV[2]
          then
            return {
              'invalid'
            }
          end

          local partnerRoomKey =
            ARGV[4] ..
            ':peer-room:' ..
            partnerPeerId

          local partnerRoomId =
            redis.call(
              'GET',
              partnerRoomKey
            )

          if
            not partnerRoomId or
            partnerRoomId ~= ARGV[1]
          then
            return {
              'invalid'
            }
          end

          redis.call(
            'ZREM',
            KEYS[3],
            ARGV[2]
          )

          redis.call(
            'HDEL',
            KEYS[4],
            ARGV[2]
          )

          return {
            'restored',
            partnerPeerId
          }
        `,
        4,
        peerRoomKey,
        roomKey,
        cleanupKey,
        cleanupRoomKey,
        roomId,
        peerId,
        role,
        keyPrefix,
      );

    return parseRestoreResult(
      result,
      roomId,
      role,
    );
  }

  /*
   * 기존 비-fenced API.
   *
   * 기존 호출부와 테스트의 계약을 그대로 보존한다.
   */
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

  /*
   * Cross-instance fencing이 적용된 disconnect 예약.
   *
   * expectedPresenceOwner는 이 disconnect를 수행하는
   * signaling instance의 instanceId다.
   *
   * Redis Lua 안에서 peer presence owner와 room 상태를
   * 한 번에 검사한 뒤 cleanup 예약을 기록한다.
   *
   * 중요:
   *
   * presence가 아예 없는 경우에는 예약을 허용한다.
   *
   * 이전 instance의 presence TTL이 먼저 만료된 뒤에도
   * 아직 다른 instance가 peer를 인수하지 않았다면
   * room cleanup은 반드시 예약돼야 하기 때문이다.
   *
   * 반대로 다른 instance가 이미 presence를 등록했다면
   * 이전 instance의 늦은 cleanup 예약은 거부한다.
   */
  async function scheduleDisconnectFenced({
    peerId,
    dueAtMs,
    expectedPresenceOwner,
  }) {
    assertPeerId(
      peerId,
    );

    assertDueAtMs(
      dueAtMs,
    );

    assertPresenceOwner(
      expectedPresenceOwner,
    );

    const peerRoomKey =
      makePeerRoomKey(
        keyPrefix,
        peerId,
      );

    const peerPresenceKey =
      makePeerKey(
        keyPrefix,
        peerId,
      );

    const result =
      await command.eval(
        `
          -- room-membership:schedule-disconnect-fenced

          local currentPresenceOwner =
            redis.call(
              'GET',
              KEYS[4]
            )

          if
            currentPresenceOwner and
            currentPresenceOwner ~= ARGV[4]
          then
            return {
              'owner-changed',
              currentPresenceOwner
            }
          end

          local roomId =
            redis.call(
              'GET',
              KEYS[1]
            )

          if not roomId then
            return {
              'not-member'
            }
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
            return {
              'not-member'
            }
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

          return {
            'scheduled',
            roomId
          }
        `,
        4,
        peerRoomKey,
        cleanupRoomKey,
        cleanupKey,
        peerPresenceKey,
        keyPrefix,
        peerId,
        dueAtMs,
        expectedPresenceOwner,
      );

    return parseFencedScheduleResult(
      result,
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

  async function backfillRoomWatch({
    nowMs = Date.now(),
    scanCount = 100,
  } = {}) {
    assertDueAtMs(
      nowMs,
    );

    assertScanCount(
      scanCount,
    );

    if (
      typeof command.scan !== 'function' ||
      typeof command.zadd !== 'function'
    ) {
      throw new TypeError(
        'Redis command client must support scan and zadd',
      );
    }

    const roomKeyPrefix =
      `${keyPrefix}:room:`;

    let cursor =
      '0';

    let added =
      0;

    do {
      const scanResult =
        await command.scan(
          cursor,
          'MATCH',
          `${roomKeyPrefix}*`,
          'COUNT',
          scanCount,
        );

      if (
        !Array.isArray(scanResult) ||
        scanResult.length !== 2 ||
        !Array.isArray(scanResult[1])
      ) {
        throw new Error(
          'invalid Redis SCAN result while backfilling room-watch',
        );
      }

      cursor =
        String(scanResult[0]);

      for (
        const roomKey
        of scanResult[1]
      ) {
        if (
          typeof roomKey !== 'string' ||
          !roomKey.startsWith(
            roomKeyPrefix,
          )
        ) {
          continue;
        }

        const roomId =
          roomKey.slice(
            roomKeyPrefix.length,
          );

        if (!isNonEmptyString(roomId)) {
          continue;
        }

        const inserted =
          await command.zadd(
            roomWatchKey,
            'NX',
            nowMs,
            roomId,
          );

        if (inserted === 1) {
          added +=
            1;
        }
      }
    } while (cursor !== '0');

    return added;
  }

  async function reconcileOrphanedRooms({
    nowMs = Date.now(),
    graceMs,
    recheckMs,
    limit = 100,
  } = {}) {
    assertDueAtMs(
      nowMs,
    );

    assertPositiveMs(
      graceMs,
      'graceMs',
    );

    assertPositiveMs(
      recheckMs,
      'recheckMs',
    );

    assertCleanupLimit(
      limit,
    );

    const result =
      await command.eval(
        `
          -- room-membership:reconcile-orphaned-rooms

          local nowMs =
            tonumber(ARGV[2])

          local graceMs =
            tonumber(ARGV[3])

          local recheckMs =
            tonumber(ARGV[4])

          local candidates =
            redis.call(
              'ZRANGEBYSCORE',
              KEYS[1],
              '-inf',
              ARGV[2],
              'LIMIT',
              0,
              ARGV[5]
            )

          local scheduled = {}

          local function clearReservation(
            peerId,
            roomId
          )
            local reservationRoomId =
              redis.call(
                'HGET',
                KEYS[3],
                peerId
              )

            if reservationRoomId == roomId
            then
              redis.call(
                'ZREM',
                KEYS[2],
                peerId
              )

              redis.call(
                'HDEL',
                KEYS[3],
                peerId
              )
            end
          end

          for _, roomId
          in ipairs(candidates)
          do
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
              not polite or
              impolite == polite
            then
              redis.call(
                'ZREM',
                KEYS[1],
                roomId
              )
            else
              local impoliteRoomKey =
                ARGV[1] ..
                ':peer-room:' ..
                impolite

              local politeRoomKey =
                ARGV[1] ..
                ':peer-room:' ..
                polite

              local impoliteRoomId =
                redis.call(
                  'GET',
                  impoliteRoomKey
                )

              local politeRoomId =
                redis.call(
                  'GET',
                  politeRoomKey
                )

              if
                impoliteRoomId ~= roomId or
                politeRoomId ~= roomId
              then
                redis.call(
                  'DEL',
                  roomKey
                )

                if impoliteRoomId == roomId
                then
                  redis.call(
                    'DEL',
                    impoliteRoomKey
                  )
                end

                if politeRoomId == roomId
                then
                  redis.call(
                    'DEL',
                    politeRoomKey
                  )
                end

                clearReservation(
                  impolite,
                  roomId
                )

                clearReservation(
                  polite,
                  roomId
                )

                redis.call(
                  'ZREM',
                  KEYS[1],
                  roomId
                )
              else
                local impolitePresenceKey =
                  ARGV[1] ..
                  ':peer:' ..
                  impolite

                local politePresenceKey =
                  ARGV[1] ..
                  ':peer:' ..
                  polite

                local impolitePresent =
                  redis.call(
                    'EXISTS',
                    impolitePresenceKey
                  )

                local politePresent =
                  redis.call(
                    'EXISTS',
                    politePresenceKey
                  )

                if
                  impolitePresent == 1 and
                  politePresent == 1
                then
                  redis.call(
                    'ZADD',
                    KEYS[1],
                    nowMs + recheckMs,
                    roomId
                  )
                else
                  local missingPeerId

                  if impolitePresent == 0
                  then
                    missingPeerId =
                      impolite
                  else
                    missingPeerId =
                      polite
                  end

                  local scheduledRoomId =
                    redis.call(
                      'HGET',
                      KEYS[3],
                      missingPeerId
                    )

                  local scheduledScore =
                    redis.call(
                      'ZSCORE',
                      KEYS[2],
                      missingPeerId
                    )

                  if
                    scheduledRoomId ~= roomId or
                    not scheduledScore
                  then
                    local dueAtMs =
                      nowMs + graceMs

                    redis.call(
                      'HSET',
                      KEYS[3],
                      missingPeerId,
                      roomId
                    )

                    redis.call(
                      'ZADD',
                      KEYS[2],
                      dueAtMs,
                      missingPeerId
                    )

                    table.insert(
                      scheduled,
                      roomId
                    )

                    table.insert(
                      scheduled,
                      missingPeerId
                    )

                    table.insert(
                      scheduled,
                      tostring(dueAtMs)
                    )
                  end

                  redis.call(
                    'ZADD',
                    KEYS[1],
                    nowMs + recheckMs,
                    roomId
                  )
                end
              end
            end
          end

          return scheduled
        `,
        3,
        roomWatchKey,
        cleanupKey,
        cleanupRoomKey,
        keyPrefix,
        nowMs,
        graceMs,
        recheckMs,
        limit,
      );

    return result;
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

                    redis.call(
                      'ZREM',
                      KEYS[3],
                      scheduledRoomId
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
        3,
        cleanupKey,
        cleanupRoomKey,
        roomWatchKey,
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
    restore,
    scheduleDisconnect,
    scheduleDisconnectFenced,
    cancelDisconnect,
    backfillRoomWatch,
    reconcileOrphanedRooms,
    cleanupDue,
  });
}