import {
  isValidResumeToken,
} from './resumeToken.js';

function assertConnection(
  connection,
) {
  if (
    connection === null ||
    (
      typeof connection !== 'object' &&
      typeof connection !== 'function'
    )
  ) {
    throw new TypeError(
      'connection must be an object',
    );
  }
}

function assertOnLost(
  onLost,
) {
  if (
    onLost !== null &&
    typeof onLost !== 'function'
  ) {
    throw new TypeError(
      'onLost must be a function',
    );
  }
}

function assertConnectionManager(
  connectionManager,
) {
  if (
    !connectionManager ||
    typeof connectionManager.claim !==
      'function' ||
    typeof connectionManager.get !==
      'function' ||
    typeof connectionManager.release !==
      'function' ||
    typeof connectionManager.remove !==
      'function'
  ) {
    throw new TypeError(
      'resume connection manager is required',
    );
  }
}

function assertRoomMembership(
  roomMembership,
) {
  if (
    !roomMembership ||
    typeof roomMembership.restore !==
      'function'
  ) {
    throw new TypeError(
      'room membership is required',
    );
  }
}

function isValidRole(
  role,
) {
  return (
    role === 'impolite' ||
    role === 'polite'
  );
}

function isValidActiveRecord(
  record,
) {
  return (
    record &&
    typeof record.token === 'string' &&
    typeof record.peerId === 'string' &&
    record.peerId.length > 0 &&
    typeof record.roomId === 'string' &&
    record.roomId.length > 0 &&
    isValidRole(
      record.role,
    )
  );
}

async function releaseAfterRestoreError({
  connectionManager,
  connection,
}) {
  try {
    await connectionManager.release(
      connection,
    );
  } catch (error) {
    console.error(
      '[resume] failed to release claim after restore error:',
      error,
    );
  }
}

async function removeInvalidSession({
  connectionManager,
  connection,
}) {
  const removed =
    await connectionManager.remove(
      connection,
    );

  if (!removed) {
    throw new Error(
      'failed to remove invalid resume session',
    );
  }
}

export function createResumeJoinManager({
  connectionManager,
  roomMembership,
}) {
  assertConnectionManager(
    connectionManager,
  );

  assertRoomMembership(
    roomMembership,
  );

  async function claim({
    connection,
    token,
    onLost = null,
  }) {
    assertConnection(
      connection,
    );

    assertOnLost(
      onLost,
    );

    /*
     * malformed token은 Redis까지 보내지 않는다.
     */
    if (
      !isValidResumeToken(
        token,
      )
    ) {
      return Object.freeze({
        status:
          'invalid-token',
      });
    }

    const result =
      await connectionManager.claim({
        connection,
        token,
        onLost,
      });

    if (
      result.status !==
      'acquired'
    ) {
      return Object.freeze({
        ...result,
      });
    }

    if (
      !isValidActiveRecord(
        result,
      )
    ) {
      await removeInvalidSession({
        connectionManager,
        connection,
      });

      return Object.freeze({
        status:
          'invalid-state',
      });
    }

    /*
     * 여기서는 room cleanup을 취소하지 않는다.
     *
     * 서버가 동일 peerId의 local/presence identity를
     * 정상적으로 활성화한 다음 restore()를 호출해야 한다.
     */
    return Object.freeze({
      status:
        'claimed',

      token:
        result.token,

      peerId:
        result.peerId,

      roomId:
        result.roomId,

      role:
        result.role,
    });
  }

  async function restore(
    connection,
  ) {
    assertConnection(
      connection,
    );

    const active =
      connectionManager.get(
        connection,
      );

    if (
      !isValidActiveRecord(
        active,
      )
    ) {
      return Object.freeze({
        status:
          'inactive',
      });
    }

    let restored;

    try {
      restored =
        await roomMembership.restore({
          peerId:
            active.peerId,

          roomId:
            active.roomId,

          role:
            active.role,
        });
    } catch (error) {
      /*
       * Redis 등 일시 장애라면 session 자체는 지우지 않는다.
       * claim만 풀어 두어 grace 시간 내 재시도가 가능하게 한다.
       */
      await releaseAfterRestoreError({
        connectionManager,
        connection,
      });

      throw error;
    }

    if (!restored) {
      /*
       * token은 존재하지만 실제 room 상태와 맞지 않는다.
       * 다시 사용할 수 없는 stale session이므로 삭제한다.
       */
      await removeInvalidSession({
        connectionManager,
        connection,
      });

      return Object.freeze({
        status:
          'invalid-state',
      });
    }

    if (
      restored.roomId !==
        active.roomId ||
      restored.role !==
        active.role ||
      typeof restored.partnerPeerId !==
        'string' ||
      restored.partnerPeerId.length ===
        0 ||
      restored.partnerPeerId ===
        active.peerId
    ) {
      await removeInvalidSession({
        connectionManager,
        connection,
      });

      return Object.freeze({
        status:
          'invalid-state',
      });
    }

    return Object.freeze({
      status:
        'restored',

      token:
        active.token,

      peerId:
        active.peerId,

      roomId:
        active.roomId,

      role:
        active.role,

      partnerPeerId:
        restored.partnerPeerId,
    });
  }

  async function release(
    connection,
  ) {
    assertConnection(
      connection,
    );

    return connectionManager.release(
      connection,
    );
  }

  async function remove(
    connection,
  ) {
    assertConnection(
      connection,
    );

    return connectionManager.remove(
      connection,
    );
  }

  function get(
    connection,
  ) {
    assertConnection(
      connection,
    );

    return connectionManager.get(
      connection,
    );
  }

  return Object.freeze({
    claim,
    restore,
    release,
    remove,
    get,
  });
}