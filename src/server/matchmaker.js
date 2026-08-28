import {
  makePeerKey,
} from './peerDirectory.js';

import {
  makePeerRoomKey,
  makeRoomKey,
} from './roomMembership.js';

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

function assertNowMs(
  nowMs,
) {
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs < 0
  ) {
    throw new TypeError(
      'nowMs must be a non-negative safe integer',
    );
  }
}

export function makeWaitingKey(
  keyPrefix,
) {
  assertKeyPrefix(
    keyPrefix,
  );

  return (
    `${keyPrefix}:waiting`
  );
}

function parseResult(
  result,
) {
  if (
    !Array.isArray(result) ||
    result.length === 0
  ) {
    throw new Error(
      'invalid matchmaking result',
    );
  }

  const status =
    result[0];

  if (status === 'waiting') {
    return {
      status: 'waiting',
    };
  }

  if (status === 'unavailable') {
    return {
      status: 'unavailable',
    };
  }

  if (status === 'collision') {
    return {
      status: 'collision',
    };
  }

  if (status === 'paired') {
    const [
      ,
      roomId,
      partnerPeerId,
    ] = result;

    if (
      !isNonEmptyString(roomId) ||
      !isNonEmptyString(
        partnerPeerId,
      )
    ) {
      throw new Error(
        'invalid paired matchmaking result',
      );
    }

    return {
      status: 'paired',
      roomId,
      role: 'polite',
      partnerPeerId,
      partnerRole: 'impolite',
    };
  }

  if (status === 'existing') {
    const [
      ,
      roomId,
      role,
      partnerPeerId,
    ] = result;

    if (
      !isNonEmptyString(roomId) ||
      (
        role !== 'impolite' &&
        role !== 'polite'
      ) ||
      !isNonEmptyString(
        partnerPeerId,
      )
    ) {
      throw new Error(
        'invalid existing matchmaking result',
      );
    }

    return {
      status: 'existing',
      roomId,
      role,
      partnerPeerId,
      partnerRole:
        role === 'impolite'
          ? 'polite'
          : 'impolite',
    };
  }

  throw new Error(
    `unknown matchmaking status: ${status}`,
  );
}

export function createMatchmaker({
  command,
  keyPrefix,
}) {
  if (
    !command ||
    typeof command.eval !== 'function' ||
    typeof command.zrem !== 'function'
  ) {
    throw new TypeError(
      'Redis command client is required',
    );
  }

  assertKeyPrefix(
    keyPrefix,
  );

  const waitingKey =
    makeWaitingKey(
      keyPrefix,
    );

  async function match({
    peerId,
    proposedRoomId,
    nowMs = Date.now(),
  }) {
    assertPeerId(
      peerId,
    );

    assertRoomId(
      proposedRoomId,
    );

    assertNowMs(
      nowMs,
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

    const proposedRoomKey =
      makeRoomKey(
        keyPrefix,
        proposedRoomId,
      );

    const result =
      await command.eval(
        `
          local waitingKey =
            KEYS[1]

          local peerRoomKey =
            KEYS[2]

          local peerPresenceKey =
            KEYS[3]

          local proposedRoomKey =
            KEYS[4]

          local keyPrefix =
            ARGV[1]

          local peerId =
            ARGV[2]

          local proposedRoomId =
            ARGV[3]

          local nowMs =
            ARGV[4]

          local existingRoomId =
            redis.call(
              'GET',
              peerRoomKey
            )

          if existingRoomId then
            local existingRoomKey =
              keyPrefix ..
              ':room:' ..
              existingRoomId

            local members =
              redis.call(
                'HMGET',
                existingRoomKey,
                'impolite',
                'polite'
              )

            local impolite =
              members[1]

            local polite =
              members[2]

            if
              impolite == peerId and
              polite
            then
              return {
                'existing',
                existingRoomId,
                'impolite',
                polite
              }
            end

            if
              polite == peerId and
              impolite
            then
              return {
                'existing',
                existingRoomId,
                'polite',
                impolite
              }
            end

            return {
              'unavailable'
            }
          end

          if
            redis.call(
              'EXISTS',
              peerPresenceKey
            ) == 0
          then
            return {
              'unavailable'
            }
          end

          if
            redis.call(
              'ZSCORE',
              waitingKey,
              peerId
            )
          then
            return {
              'waiting'
            }
          end

          while true do
            local candidates =
              redis.call(
                'ZRANGE',
                waitingKey,
                0,
                0
              )

            if
              #candidates == 0
            then
              redis.call(
                'ZADD',
                waitingKey,
                nowMs,
                peerId
              )

              return {
                'waiting'
              }
            end

            local candidatePeerId =
              candidates[1]

            if
              candidatePeerId ==
              peerId
            then
              return {
                'waiting'
              }
            end

            local candidatePresenceKey =
              keyPrefix ..
              ':peer:' ..
              candidatePeerId

            local candidateRoomKey =
              keyPrefix ..
              ':peer-room:' ..
              candidatePeerId

            local candidatePresent =
              redis.call(
                'EXISTS',
                candidatePresenceKey
              )

            local candidateAssigned =
              redis.call(
                'EXISTS',
                candidateRoomKey
              )

            if
              candidatePresent == 0 or
              candidateAssigned == 1
            then
              redis.call(
                'ZREM',
                waitingKey,
                candidatePeerId
              )
            else
              if
                redis.call(
                  'EXISTS',
                  proposedRoomKey
                ) == 1
              then
                return {
                  'collision'
                }
              end

              redis.call(
                'ZREM',
                waitingKey,
                candidatePeerId
              )

              redis.call(
                'HSET',
                proposedRoomKey,
                'impolite',
                candidatePeerId,
                'polite',
                peerId
              )

              redis.call(
                'SET',
                candidateRoomKey,
                proposedRoomId
              )

              redis.call(
                'SET',
                peerRoomKey,
                proposedRoomId
              )

              return {
                'paired',
                proposedRoomId,
                candidatePeerId
              }
            end
          end
        `,
        4,
        waitingKey,
        peerRoomKey,
        peerPresenceKey,
        proposedRoomKey,
        keyPrefix,
        peerId,
        proposedRoomId,
        nowMs,
      );

    return parseResult(
      result,
    );
  }

  async function rollbackPair({
    roomId,
    peerId,
    partnerPeerId,
  }) {
    assertRoomId(
      roomId,
    );

    assertPeerId(
      peerId,
    );

    assertPeerId(
      partnerPeerId,
    );

    if (
      peerId === partnerPeerId
    ) {
      throw new TypeError(
        'paired peer ids must be different',
      );
    }

    const roomKey =
      makeRoomKey(
        keyPrefix,
        roomId,
      );

    const peerRoomKey =
      makePeerRoomKey(
        keyPrefix,
        peerId,
      );

    const partnerRoomKey =
      makePeerRoomKey(
        keyPrefix,
        partnerPeerId,
      );

    const result =
      await command.eval(
        `
          -- matchmaker:rollback-pair

          local members =
            redis.call(
              'HMGET',
              KEYS[1],
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
            return 0
          end

          local validPair =
            (
              impolite == ARGV[1] and
              polite == ARGV[2]
            ) or
            (
              impolite == ARGV[2] and
              polite == ARGV[1]
            )

          if not validPair then
            return 0
          end

          local peerRoomId =
            redis.call(
              'GET',
              KEYS[2]
            )

          local partnerRoomId =
            redis.call(
              'GET',
              KEYS[3]
            )

          if
            peerRoomId ~= ARGV[3] or
            partnerRoomId ~= ARGV[3]
          then
            return 0
          end

          redis.call(
            'DEL',
            KEYS[1],
            KEYS[2],
            KEYS[3]
          )

          redis.call(
            'ZREM',
            KEYS[4],
            ARGV[1],
            ARGV[2]
          )

          return 1
        `,
        4,
        roomKey,
        peerRoomKey,
        partnerRoomKey,
        waitingKey,
        peerId,
        partnerPeerId,
        roomId,
      );

    return result === 1;
  }

  async function cancelWaiting(
    peerId,
  ) {
    assertPeerId(
      peerId,
    );

    const removed =
      await command.zrem(
        waitingKey,
        peerId,
      );

    return removed > 0;
  }

  return Object.freeze({
    match,
    rollbackPair,
    cancelWaiting,
  });
}