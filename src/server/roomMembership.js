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

  return Object.freeze({
    findRoom,
    arePartners,
  });
}