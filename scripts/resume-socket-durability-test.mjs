import assert from 'node:assert/strict';

import {
  createResumeSocketLifecycle,
} from '../src/server/resumeSocketLifecycle.js';

let passed =
  0;

async function test(
  name,
  fn,
) {
  try {
    await fn();

    passed +=
      1;

    console.log(
      `PASS: ${name}`,
    );
  } catch (error) {
    console.error(
      `FAIL: ${name}`,
    );

    throw error;
  }
}

function createFixture({
  scheduleFailures =
    0,
  cancelWaitingError =
    null,
  restoreError =
    null,
} = {}) {
  const connection =
    {};

  const events =
    [];

  let connectionOpen =
    true;

  let localActive =
    true;

  let presenceActive =
    true;

  let resumeActive =
    true;

  let scheduleCalls =
    0;

  const activeSet =
    new Set([
      'peer-a',
    ]);

  const resumeRecord = {
    status:
      'active',

    token:
      'resume-token',

    peerId:
      'peer-a',

    roomId:
      'room-1',

    role:
      'impolite',
  };

  const meta = {
    peerId:
      'peer-a',

    roomId:
      'room-1',
  };

  const resumeJoinManager = {
    async claim() {
      events.push(
        'claim',
      );

      resumeActive =
        true;

      return {
        status:
          'acquired',

        token:
          'resume-token',

        peerId:
          'peer-a',

        roomId:
          'room-1',

        role:
          'impolite',
      };
    },

    async restore() {
      events.push(
        'restore',
      );

      if (restoreError) {
        throw restoreError;
      }

      return {
        status:
          'restored',

        token:
          'resume-token',

        peerId:
          'peer-a',

        roomId:
          'room-1',

        role:
          'impolite',

        partnerPeerId:
          'peer-b',
      };
    },

    async release() {
      events.push(
        'release',
      );

      resumeActive =
        false;

      return true;
    },

    get() {
      return (
        resumeActive
          ? resumeRecord
          : null
      );
    },
  };

  const localPeers = {
    hasPeer() {
      return false;
    },

    register() {
      events.push(
        'local-register',
      );

      localActive =
        true;

      return meta;
    },

    getMeta() {
      return (
        localActive
          ? meta
          : null
      );
    },

    setRoomId() {
      events.push(
        'local-room',
      );

      return true;
    },

    remove() {
      events.push(
        'local-remove',
      );

      localActive =
        false;

      return meta;
    },
  };

  const peerDirectory = {
    async register() {
      events.push(
        'presence-register',
      );

      presenceActive =
        true;

      return {
        peerId:
          'peer-a',
      };
    },

    async unregister() {
      events.push(
        'presence-unregister',
      );

      presenceActive =
        false;

      return true;
    },
  };

  const activePeerIds = {
    add(
      peerId,
    ) {
      events.push(
        'active-add',
      );

      activeSet.add(
        peerId,
      );

      return this;
    },

    delete(
      peerId,
    ) {
      events.push(
        'active-delete',
      );

      return activeSet.delete(
        peerId,
      );
    },
  };

  async function scheduleDisconnect() {
    events.push(
      'schedule',
    );

    scheduleCalls +=
      1;

    if (
      scheduleCalls <=
      scheduleFailures
    ) {
      throw new Error(
        `schedule failure ${scheduleCalls}`,
      );
    }

    return {
      status:
        'scheduled',

      peerId:
        'peer-a',

      roomId:
        'room-1',
    };
  }

  async function cancelWaiting() {
    events.push(
      'cancel-waiting',
    );

    if (cancelWaitingError) {
      throw cancelWaitingError;
    }

    return true;
  }

  const lifecycle =
    createResumeSocketLifecycle({
      resumeJoinManager,

      localPeers,

      peerDirectory,

      activePeerIds,

      scheduleDisconnect,

      cancelWaiting,

      isConnectionOpen:
        () =>
          connectionOpen,

      isShuttingDown:
        () =>
          false,

      wait:
        async () => {},
    });

  return {
    connection,
    lifecycle,
    events,
    activeSet,

    get localActive() {
      return localActive;
    },

    get presenceActive() {
      return presenceActive;
    },

    get resumeActive() {
      return resumeActive;
    },

    get scheduleCalls() {
      return scheduleCalls;
    },

    setConnectionOpen(
      value,
    ) {
      connectionOpen =
        value;
    },

    resetEvents() {
      events.length =
        0;
    },
  };
}

await test(
  'schedule failure preserves identity and claim',
  async () => {
    const fixture =
      createFixture({
        scheduleFailures:
          1,
      });

    await assert.rejects(
      fixture.lifecycle.cleanup(
        fixture.connection,
      ),
      (
        error,
      ) => {
        assert.equal(
          error.message,
          'schedule failure 1',
        );

        return true;
      },
    );

    assert.deepEqual(
      fixture.events,
      [
        'schedule',
      ],
    );

    assert.equal(
      fixture.localActive,
      true,
    );

    assert.equal(
      fixture.presenceActive,
      true,
    );

    assert.equal(
      fixture.resumeActive,
      true,
    );

    assert.equal(
      fixture.activeSet.has(
        'peer-a',
      ),
      true,
    );
  },
);

await test(
  'cleanup can be retried after schedule failure',
  async () => {
    const fixture =
      createFixture({
        scheduleFailures:
          1,
      });

    await assert.rejects(
      fixture.lifecycle.cleanup(
        fixture.connection,
      ),
    );

    fixture.resetEvents();

    const result =
      await fixture.lifecycle.cleanup(
        fixture.connection,
      );

    assert.deepEqual(
      result,
      {
        status:
          'cleaned',

        peerId:
          'peer-a',

        roomId:
          'room-1',
      },
    );

    assert.deepEqual(
      fixture.events,
      [
        'schedule',
        'local-remove',
        'active-delete',
        'cancel-waiting',
        'presence-unregister',
        'release',
      ],
    );

    assert.equal(
      fixture.localActive,
      false,
    );

    assert.equal(
      fixture.presenceActive,
      false,
    );

    assert.equal(
      fixture.resumeActive,
      false,
    );

    assert.equal(
      fixture.activeSet.has(
        'peer-a',
      ),
      false,
    );

    assert.equal(
      fixture.scheduleCalls,
      2,
    );
  },
);

await test(
  'resolved fenced result permits cleanup',
  async () => {
    const connection =
      {};

    const events =
      [];

    let localActive =
      true;

    let resumeActive =
      true;

    const activeSet =
      new Set([
        'peer-a',
      ]);

    const lifecycle =
      createResumeSocketLifecycle({
        resumeJoinManager: {
          async claim() {
            throw new Error(
              'unused',
            );
          },

          async restore() {
            throw new Error(
              'unused',
            );
          },

          async release() {
            events.push(
              'release',
            );

            resumeActive =
              false;

            return true;
          },

          get() {
            return (
              resumeActive
                ? {
                    status:
                      'active',

                    token:
                      'resume-token',

                    peerId:
                      'peer-a',

                    roomId:
                      'room-1',

                    role:
                      'impolite',
                  }
                : null
            );
          },
        },

        localPeers: {
          hasPeer() {
            return false;
          },

          register() {
            throw new Error(
              'unused',
            );
          },

          getMeta() {
            return (
              localActive
                ? {
                    peerId:
                      'peer-a',

                    roomId:
                      'room-1',
                  }
                : null
            );
          },

          setRoomId() {
            return true;
          },

          remove() {
            events.push(
              'local-remove',
            );

            localActive =
              false;

            return true;
          },
        },

        peerDirectory: {
          async register() {
            throw new Error(
              'unused',
            );
          },

          async unregister() {
            events.push(
              'presence-unregister',
            );

            return false;
          },
        },

        activePeerIds: {
          add() {
            return this;
          },

          delete(
            peerId,
          ) {
            events.push(
              'active-delete',
            );

            return activeSet.delete(
              peerId,
            );
          },
        },

        scheduleDisconnect:
          async () => {
            events.push(
              'schedule-owner-changed',
            );

            return {
              status:
                'owner-changed',

              owner:
                'instance-b',
            };
          },

        cancelWaiting:
          async () => {
            events.push(
              'cancel-waiting',
            );

            return true;
          },

        isConnectionOpen:
          () =>
            false,
      });

    const result =
      await lifecycle.cleanup(
        connection,
      );

    assert.equal(
      result.status,
      'cleaned',
    );

    assert.deepEqual(
      events,
      [
        'schedule-owner-changed',
        'local-remove',
        'active-delete',
        'cancel-waiting',
        'presence-unregister',
        'release',
      ],
    );
  },
);

await test(
  'post-schedule cleanup error still releases claim last',
  async () => {
    const cancelError =
      new Error(
        'waiting cleanup failed',
      );

    const fixture =
      createFixture({
        cancelWaitingError:
          cancelError,
      });

    await assert.rejects(
      fixture.lifecycle.cleanup(
        fixture.connection,
      ),
      (
        error,
      ) =>
        error ===
        cancelError,
    );

    assert.deepEqual(
      fixture.events,
      [
        'schedule',
        'local-remove',
        'active-delete',
        'cancel-waiting',
        'presence-unregister',
        'release',
      ],
    );

    assert.equal(
      fixture.events.at(
        -1,
      ),
      'release',
    );

    assert.equal(
      fixture.localActive,
      false,
    );

    assert.equal(
      fixture.resumeActive,
      false,
    );
  },
);

await test(
  'restore and schedule failures preserve active takeover state',
  async () => {
    const restoreError =
      new Error(
        'restore response lost',
      );

    /*
     * 이 fixture는 처음 cleanup 테스트를 위한 active 상태로
     * 시작하므로 resume()를 테스트하기 전에 기존 상태를
     * cleanup 없이 별도 fixture로 구성한다.
     */
    const connection =
      {};

    const events =
      [];

    let resumeActive =
      false;

    let localActive =
      false;

    let presenceActive =
      false;

    const activeSet =
      new Set();

    const scheduleError =
      new Error(
        'cleanup redis unavailable',
      );

    const resumeJoinManager = {
      async claim() {
        events.push(
          'claim',
        );

        resumeActive =
          true;

        return {
          status:
            'acquired',

          token:
            'resume-token',

          peerId:
            'peer-a',

          roomId:
            'room-1',

          role:
            'impolite',
        };
      },

      async restore() {
        events.push(
          'restore',
        );

        throw restoreError;
      },

      async release() {
        events.push(
          'release',
        );

        resumeActive =
          false;

        return true;
      },

      get() {
        return (
          resumeActive
            ? {
                status:
                  'active',

                token:
                  'resume-token',

                peerId:
                  'peer-a',

                roomId:
                  'room-1',

                role:
                  'impolite',
              }
            : null
        );
      },
    };

    const lifecycle =
      createResumeSocketLifecycle({
        resumeJoinManager,

        localPeers: {
          hasPeer() {
            return false;
          },

          register() {
            events.push(
              'local-register',
            );

            localActive =
              true;

            return {
              peerId:
                'peer-a',

              roomId:
                null,
            };
          },

          getMeta() {
            return (
              localActive
                ? {
                    peerId:
                      'peer-a',

                    roomId:
                      null,
                  }
                : null
            );
          },

          setRoomId() {
            events.push(
              'local-room',
            );

            return true;
          },

          remove() {
            events.push(
              'local-remove',
            );

            localActive =
              false;

            return true;
          },
        },

        peerDirectory: {
          async register() {
            events.push(
              'presence-register',
            );

            presenceActive =
              true;

            return true;
          },

          async unregister() {
            events.push(
              'presence-unregister',
            );

            presenceActive =
              false;

            return true;
          },
        },

        activePeerIds: {
          add(
            peerId,
          ) {
            events.push(
              'active-add',
            );

            activeSet.add(
              peerId,
            );

            return this;
          },

          delete(
            peerId,
          ) {
            events.push(
              'active-delete',
            );

            return activeSet.delete(
              peerId,
            );
          },
        },

        scheduleDisconnect:
          async () => {
            events.push(
              'schedule',
            );

            throw scheduleError;
          },

        cancelWaiting:
          async () => {
            events.push(
              'cancel-waiting',
            );

            return true;
          },

        isConnectionOpen:
          () =>
            true,

        isShuttingDown:
          () =>
            false,

        wait:
          async () => {},
      });

    await assert.rejects(
      lifecycle.resume({
        connection,

        token:
          'resume-token',
      }),
      (
        error,
      ) => {
        assert.equal(
          error instanceof
            AggregateError,
          true,
        );

        assert.deepEqual(
          error.errors,
          [
            restoreError,
            scheduleError,
          ],
        );

        return true;
      },
    );

    assert.deepEqual(
      events,
      [
        'claim',
        'presence-register',
        'local-register',
        'active-add',
        'restore',
        'schedule',
      ],
    );

    /*
     * cleanup 예약이 실패했으므로 새 identity와 claim은
     * 의도적으로 유지된다.
     *
     * 이후 socket close cleanup이 다시 durable schedule을
     * 시도할 수 있어야 한다.
     */
    assert.equal(
      localActive,
      true,
    );

    assert.equal(
      presenceActive,
      true,
    );

    assert.equal(
      resumeActive,
      true,
    );

    assert.equal(
      activeSet.has(
        'peer-a',
      ),
      true,
    );
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);