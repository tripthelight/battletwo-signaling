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
      /*
       * missing:
       *   session이 이미 만료되었거나 존재하지 않음.
       *
       * claimed:
       *   다른 connection이 현재 claim을 보유 중.
       *
       * invalid:
       *   Redis session record 자체가 손상됨.
       */
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
     *
     * 이미 다른 connection이 token을 점유한 상태는
     * status: 'claimed'이고,
     * 이 connection이 정상적으로 claim을 획득한 상태는
     * status: 'acquired'로 구분한다.
     */
    return Object.freeze({
      status:
        'acquired',

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
       * 중요:
       *
       * 여기서 claim을 release하면 안 된다.
       *
       * 서버는 이미 같은 peerId를 localPeers와
       * peerDirectory에 활성화했을 수 있다.
       *
       * 이 상태에서 claim을 먼저 풀면 다른 connection이
       * 같은 resumeToken을 획득하여 동일 peerId가
       * 동시에 활성화될 수 있다.
       *
       * 따라서 오류를 그대로 caller에게 전달하고,
       * caller가 local/presence cleanup을 모두 끝낸 뒤
       * connection lifecycle의 마지막 단계에서
       * release()를 호출해야 한다.
       */
      throw error;
    }

    if (!restored) {
      /*
       * token은 존재하지만 실제 room 상태와 맞지 않는다.
       * 다시 사용할 수 없는 stale session이므로 삭제한다.
       *
       * remove()는 session과 claim을 함께 제거하므로
       * 같은 token을 사용한 재접속은 더 이상 불가능하다.
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