function assertObject(
  value,
  name,
) {
  if (
    value === null ||
    (
      typeof value !== 'object' &&
      typeof value !== 'function'
    )
  ) {
    throw new TypeError(
      `${name} must be an object`,
    );
  }
}

function assertFunction(
  value,
  name,
) {
  if (
    typeof value !==
    'function'
  ) {
    throw new TypeError(
      `${name} must be a function`,
    );
  }
}

function assertPositiveInteger(
  value,
  name,
) {
  if (
    !Number.isInteger(
      value,
    ) ||
    value < 1
  ) {
    throw new TypeError(
      `${name} must be a positive integer`,
    );
  }
}

function assertNonNegativeInteger(
  value,
  name,
) {
  if (
    !Number.isInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new TypeError(
      `${name} must be a non-negative integer`,
    );
  }
}

function assertResumeJoinManager(
  resumeJoinManager,
) {
  assertObject(
    resumeJoinManager,
    'resumeJoinManager',
  );

  assertFunction(
    resumeJoinManager.claim,
    'resumeJoinManager.claim',
  );

  assertFunction(
    resumeJoinManager.restore,
    'resumeJoinManager.restore',
  );

  assertFunction(
    resumeJoinManager.release,
    'resumeJoinManager.release',
  );

  assertFunction(
    resumeJoinManager.get,
    'resumeJoinManager.get',
  );
}

function assertLocalPeers(
  localPeers,
) {
  assertObject(
    localPeers,
    'localPeers',
  );

  assertFunction(
    localPeers.hasPeer,
    'localPeers.hasPeer',
  );

  assertFunction(
    localPeers.register,
    'localPeers.register',
  );

  assertFunction(
    localPeers.getMeta,
    'localPeers.getMeta',
  );

  assertFunction(
    localPeers.setRoomId,
    'localPeers.setRoomId',
  );

  assertFunction(
    localPeers.remove,
    'localPeers.remove',
  );
}

function assertPeerDirectory(
  peerDirectory,
) {
  assertObject(
    peerDirectory,
    'peerDirectory',
  );

  assertFunction(
    peerDirectory.register,
    'peerDirectory.register',
  );

  assertFunction(
    peerDirectory.unregister,
    'peerDirectory.unregister',
  );
}

function assertActivePeerIds(
  activePeerIds,
) {
  assertObject(
    activePeerIds,
    'activePeerIds',
  );

  assertFunction(
    activePeerIds.add,
    'activePeerIds.add',
  );

  assertFunction(
    activePeerIds.delete,
    'activePeerIds.delete',
  );
}

function defaultWait(
  delayMs,
) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        delayMs,
      );
    },
  );
}

function makeAggregateError(
  primaryError,
  cleanupError,
) {
  return new AggregateError(
    [
      primaryError,
      cleanupError,
    ],
    'resume lifecycle operation and cleanup both failed',
  );
}

export function createResumeSocketLifecycle({
  resumeJoinManager,
  localPeers,
  peerDirectory,
  activePeerIds,
  scheduleDisconnect,
  cancelWaiting,
  isConnectionOpen,
  isShuttingDown =
    () => false,
  claimRetryAttempts =
    20,
  claimRetryDelayMs =
    50,
  wait =
    defaultWait,
}) {
  assertResumeJoinManager(
    resumeJoinManager,
  );

  assertLocalPeers(
    localPeers,
  );

  assertPeerDirectory(
    peerDirectory,
  );

  assertActivePeerIds(
    activePeerIds,
  );

  assertFunction(
    scheduleDisconnect,
    'scheduleDisconnect',
  );

  assertFunction(
    cancelWaiting,
    'cancelWaiting',
  );

  assertFunction(
    isConnectionOpen,
    'isConnectionOpen',
  );

  assertFunction(
    isShuttingDown,
    'isShuttingDown',
  );

  assertFunction(
    wait,
    'wait',
  );

  assertPositiveInteger(
    claimRetryAttempts,
    'claimRetryAttempts',
  );

  assertNonNegativeInteger(
    claimRetryDelayMs,
    'claimRetryDelayMs',
  );

  function isUsable(
    connection,
  ) {
    return (
      !isShuttingDown() &&
      isConnectionOpen(
        connection,
      )
    );
  }

  async function releaseOnly(
    connection,
  ) {
    return resumeJoinManager.release(
      connection,
    );
  }

  /*
   * 동일 peerId가 local/presence에 활성화된 뒤의
   * 정리 절차를 한 곳에서 보장한다.
   *
   * 가장 중요한 규칙:
   *
   * 1. room cleanup 예약이 필요한 경우에는
   *    반드시 그 예약이 먼저 성공해야 한다.
   *
   * 2. cleanup 예약 자체가 실패하면 fail-closed한다.
   *    local identity / presence / resume claim을
   *    그대로 유지하여 상위 계층이 같은 cleanup을
   *    안전하게 다시 시도할 수 있게 한다.
   *
   * 3. 예약이 성공했거나 예약할 room이 없는 것이
   *    정상적으로 확인된 이후에만 identity cleanup을
   *    진행한다.
   *
   * 4. resume claim release는 반드시 마지막이다.
   */
  async function cleanupActivatedIdentity({
    connection,
    peerId,
    scheduleRoomCleanup,
  }) {
    /*
     * 이 단계는 아래 runStep()으로 감싸지 않는다.
     *
     * scheduleDisconnect()가 throw하면
     * 그 즉시 cleanup 전체를 중단해야 한다.
     *
     * 그렇지 않고 local/presence/claim을 먼저 제거하면
     * Redis room cleanup 예약이 없는 orphan room을
     * 만들 수 있기 때문이다.
     */
    if (
      scheduleRoomCleanup
    ) {
      await scheduleDisconnect(
        peerId,
      );
    }

    let firstError =
      null;

    async function runStep(
      fn,
    ) {
      try {
        await fn();
      } catch (error) {
        if (
          firstError ===
          null
        ) {
          firstError =
            error;
        }
      }
    }

    await runStep(
      async () => {
        localPeers.remove(
          connection,
        );
      },
    );

    await runStep(
      async () => {
        activePeerIds.delete(
          peerId,
        );
      },
    );

    await runStep(
      () =>
        cancelWaiting(
          peerId,
        ),
    );

    await runStep(
      () =>
        peerDirectory.unregister(
          peerId,
        ),
    );

    /*
     * 반드시 마지막.
     */
    await runStep(
      () =>
        resumeJoinManager.release(
          connection,
        ),
    );

    if (firstError) {
      throw firstError;
    }

    return true;
  }

  async function claimWithRetry({
    connection,
    token,
    onLost,
  }) {
    let result =
      null;

    for (
      let attempt = 0;
      attempt <
      claimRetryAttempts;
      attempt += 1
    ) {
      if (
        !isUsable(
          connection,
        )
      ) {
        return Object.freeze({
          status:
            'aborted',
        });
      }

      result =
        await resumeJoinManager.claim({
          connection,
          token,
          onLost,
        });

      if (
        result.status !==
        'claimed'
      ) {
        return result;
      }

      if (
        attempt + 1 >=
        claimRetryAttempts
      ) {
        break;
      }

      await wait(
        claimRetryDelayMs,
      );
    }

    return (
      result ??
      Object.freeze({
        status:
          'claimed',
      })
    );
  }

  async function resume({
    connection,
    token,
    onLost = null,
  }) {
    assertObject(
      connection,
      'connection',
    );

    if (
      onLost !== null
    ) {
      assertFunction(
        onLost,
        'onLost',
      );
    }

    const claimed =
      await claimWithRetry({
        connection,
        token,
        onLost,
      });

    if (
      claimed.status !==
      'acquired'
    ) {
      return claimed;
    }

    const {
      peerId,
    } = claimed;

    /*
     * claim을 얻는 동안 socket이 닫혔을 수 있다.
     * 아직 local/presence identity는 만들지 않았으므로
     * claim만 해제하면 된다.
     */
    if (
      !isUsable(
        connection,
      )
    ) {
      await releaseOnly(
        connection,
      );

      return Object.freeze({
        status:
          'aborted',
      });
    }

    /*
     * 같은 instance에 이전 socket이 아직 남아 있다면
     * Redis presence를 덮어쓰기 전에 중단한다.
     *
     * 정상 disconnect cleanup에서는 claim release가
     * 마지막이므로 즉시 reconnect는 claimed 상태로
     * 잠시 기다렸다가 이 지점을 통과하게 된다.
     */
    if (
      localPeers.hasPeer(
        peerId,
      )
    ) {
      await releaseOnly(
        connection,
      );

      return Object.freeze({
        status:
          'peer-active',

        peerId,
      });
    }

    /*
     * Presence 등록.
     *
     * Redis SET이 서버에서 실행된 뒤 응답만 유실됐을
     * 가능성까지 고려하여 register() 자체가 throw해도
     * unregister()를 한 번 시도한다.
     */
    try {
      await peerDirectory.register(
        peerId,
      );
    } catch (error) {
      let cleanupError =
        null;

      try {
        await peerDirectory.unregister(
          peerId,
        );
      } catch (currentError) {
        cleanupError =
          currentError;
      }

      try {
        await releaseOnly(
          connection,
        );
      } catch (currentError) {
        if (
          cleanupError ===
          null
        ) {
          cleanupError =
            currentError;
        }
      }

      if (cleanupError) {
        throw makeAggregateError(
          error,
          cleanupError,
        );
      }

      throw error;
    }

    /*
     * Presence를 만든 직후 socket이 닫혔다면
     * room cleanup은 기존 disconnect 예약을 그대로
     * 사용하고 새 identity만 제거한다.
     */
    if (
      !isUsable(
        connection,
      )
    ) {
      await cleanupActivatedIdentity({
        connection,
        peerId,
        scheduleRoomCleanup:
          false,
      });

      return Object.freeze({
        status:
          'aborted',
      });
    }

    try {
      localPeers.register(
        connection,
        peerId,
      );

      activePeerIds.add(
        peerId,
      );
    } catch (error) {
      let cleanupError =
        null;

      try {
        await cleanupActivatedIdentity({
          connection,
          peerId,
          scheduleRoomCleanup:
            false,
        });
      } catch (currentError) {
        cleanupError =
          currentError;
      }

      if (cleanupError) {
        throw makeAggregateError(
          error,
          cleanupError,
        );
      }

      throw error;
    }

    if (
      !isUsable(
        connection,
      )
    ) {
      await cleanupActivatedIdentity({
        connection,
        peerId,
        scheduleRoomCleanup:
          false,
      });

      return Object.freeze({
        status:
          'aborted',
      });
    }

    let restored;

    try {
      restored =
        await resumeJoinManager.restore(
          connection,
        );
    } catch (error) {
      /*
       * restore Lua가 실제 Redis에서는 성공했지만
       * 응답만 유실됐을 수 있다.
       *
       * cleanup 예약이 이미 취소됐을 가능성이 있으므로
       * 반드시 다시 disconnect cleanup을 예약한다.
       */
      let cleanupError =
        null;

      try {
        await cleanupActivatedIdentity({
          connection,
          peerId,
          scheduleRoomCleanup:
            true,
        });
      } catch (currentError) {
        cleanupError =
          currentError;
      }

      if (cleanupError) {
        throw makeAggregateError(
          error,
          cleanupError,
        );
      }

      throw error;
    }

    if (
      restored.status !==
      'restored'
    ) {
      /*
       * invalid-state라면 restore()가 session/claim을
       * 이미 제거했을 수 있다.
       *
       * room restore가 실패했으므로 기존 cleanup 예약은
       * 취소되지 않았고 다시 예약할 필요가 없다.
       */
      await cleanupActivatedIdentity({
        connection,
        peerId,
        scheduleRoomCleanup:
          false,
      });

      return restored;
    }

    /*
     * 여기까지 왔으면 Redis restore Lua가 cleanup 예약을
     * 취소했다.
     *
     * 따라서 이 이후 실패에서는 새 cleanup 예약이 필요하다.
     */
    if (
      !isUsable(
        connection,
      )
    ) {
      await cleanupActivatedIdentity({
        connection,
        peerId,
        scheduleRoomCleanup:
          true,
      });

      return Object.freeze({
        status:
          'aborted',
      });
    }

    if (
      !localPeers.setRoomId(
        connection,
        restored.roomId,
      )
    ) {
      await cleanupActivatedIdentity({
        connection,
        peerId,
        scheduleRoomCleanup:
          true,
      });

      return Object.freeze({
        status:
          'local-room-failed',

        peerId,
      });
    }

    if (
      !isUsable(
        connection,
      )
    ) {
      await cleanupActivatedIdentity({
        connection,
        peerId,
        scheduleRoomCleanup:
          true,
      });

      return Object.freeze({
        status:
          'aborted',
      });
    }

    /*
     * 성공한 connection은 claim을 계속 보유한다.
     *
     * 이후 socket close 시 cleanup()이
     * identity를 먼저 제거하고 claim을 마지막에 해제한다.
     */
    return restored;
  }

  async function cleanup(
    connection,
  ) {
    assertObject(
      connection,
      'connection',
    );

    const resumeRecord =
      resumeJoinManager.get(
        connection,
      );

    const meta =
      localPeers.getMeta(
        connection,
      );

    if (
      !meta &&
      !resumeRecord
    ) {
      return Object.freeze({
        status:
          'inactive',
      });
    }

    /*
     * claim은 얻었지만 local identity 등록 전
     * connection이 닫힌 경우.
     */
    if (!meta) {
      await releaseOnly(
        connection,
      );

      return Object.freeze({
        status:
          'claim-released',

        peerId:
          resumeRecord.peerId,
      });
    }

    await cleanupActivatedIdentity({
      connection,
      peerId:
        meta.peerId,
      scheduleRoomCleanup:
        true,
    });

    return Object.freeze({
      status:
        'cleaned',

      peerId:
        meta.peerId,

      roomId:
        meta.roomId,
    });
  }

  return Object.freeze({
    resume,
    cleanup,
  });
}