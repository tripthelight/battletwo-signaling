import assert from 'node:assert/strict';

import {
  createResumeSocketLifecycle,
} from '../src/server/resumeSocketLifecycle.js';

const TOKEN =
  'A'.repeat(
    43,
  );

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
  claimResults = [
    {
      status:
        'acquired',

      token:
        TOKEN,

      peerId:
        'peer-a',

      roomId:
        'room-1',

      role:
        'impolite',
    },
  ],

  restoreResult = {
    status:
      'restored',

    token:
      TOKEN,

    peerId:
      'peer-a',

    roomId:
      'room-1',

    role:
      'impolite',

    partnerPeerId:
      'peer-b',
  },

  restoreError =
    null,

  peerRegisterError =
    null,

  setRoomResult =
    true,

  closeAfterPresenceRegister =
    false,

  closeAfterRestore =
    false,
} = {}) {
  const events =
    [];

  const activeResume =
    new WeakMap();

  const socketMeta =
    new WeakMap();

  const peerSockets =
    new Map();

  const activeSet =
    new Set();

  const connection = {
    open:
      true,
  };

  let claimIndex =
    0;

  let shuttingDown =
    false;

  const resumeJoinManager = {
    async claim({
      connection:
        currentConnection,
      token,
    }) {
      events.push(
        'claim',
      );

      assert.equal(
        token,
        TOKEN,
      );

      const index =
        Math.min(
          claimIndex,
          claimResults.length -
            1,
        );

      const result =
        claimResults[
          index
        ];

      claimIndex +=
        1;

      if (
        result.status ===
        'acquired'
      ) {
        activeResume.set(
          currentConnection,
          {
            ...result,
          },
        );
      }

      return {
        ...result,
      };
    },

    async restore(
      currentConnection,
    ) {
      events.push(
        'restore',
      );

      if (restoreError) {
        throw restoreError;
      }

      if (
        closeAfterRestore
      ) {
        currentConnection.open =
          false;
      }

      if (
        restoreResult.status !==
        'restored'
      ) {
        activeResume.delete(
          currentConnection,
        );
      }

      return {
        ...restoreResult,
      };
    },

    async release(
      currentConnection,
    ) {
      events.push(
        'release',
      );

      const existed =
        activeResume.has(
          currentConnection,
        );

      activeResume.delete(
        currentConnection,
      );

      return existed;
    },

    get(
      currentConnection,
    ) {
      return (
        activeResume.get(
          currentConnection,
        ) ??
        null
      );
    },
  };

  const localPeers = {
    hasPeer(
      peerId,
    ) {
      return peerSockets.has(
        peerId,
      );
    },

    register(
      currentConnection,
      peerId,
    ) {
      events.push(
        'local-register',
      );

      if (
        peerSockets.has(
          peerId,
        )
      ) {
        throw new Error(
          'peer already registered',
        );
      }

      const meta = {
        peerId,
        roomId:
          null,
      };

      socketMeta.set(
        currentConnection,
        meta,
      );

      peerSockets.set(
        peerId,
        currentConnection,
      );

      return meta;
    },

    getMeta(
      currentConnection,
    ) {
      return (
        socketMeta.get(
          currentConnection,
        ) ??
        null
      );
    },

    setRoomId(
      currentConnection,
      roomId,
    ) {
      events.push(
        'local-room',
      );

      if (
        !setRoomResult
      ) {
        return false;
      }

      const meta =
        socketMeta.get(
          currentConnection,
        );

      if (!meta) {
        return false;
      }

      meta.roomId =
        roomId;

      return true;
    },

    remove(
      currentConnection,
    ) {
      events.push(
        'local-remove',
      );

      const meta =
        socketMeta.get(
          currentConnection,
        );

      if (!meta) {
        return null;
      }

      socketMeta.delete(
        currentConnection,
      );

      if (
        peerSockets.get(
          meta.peerId,
        ) ===
        currentConnection
      ) {
        peerSockets.delete(
          meta.peerId,
        );
      }

      return {
        ...meta,
      };
    },
  };

  const peerDirectory = {
    async register(
      peerId,
    ) {
      events.push(
        'presence-register',
      );

      if (
        peerRegisterError
      ) {
        throw peerRegisterError;
      }

      if (
        closeAfterPresenceRegister
      ) {
        connection.open =
          false;
      }

      return {
        peerId,
      };
    },

    async unregister() {
      events.push(
        'presence-unregister',
      );

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

  async function scheduleDisconnect(
    peerId,
  ) {
    events.push(
      'schedule',
    );

    return peerId;
  }

  async function cancelWaiting(
    peerId,
  ) {
    events.push(
      'cancel-waiting',
    );

    return peerId;
  }

  async function wait(
    delayMs,
  ) {
    events.push(
      `wait:${delayMs}`,
    );
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
        (currentConnection) =>
          currentConnection.open,

      isShuttingDown:
        () =>
          shuttingDown,

      claimRetryAttempts:
        3,

      claimRetryDelayMs:
        25,

      wait,
    });

  return {
    lifecycle,
    connection,
    events,
    activeResume,
    socketMeta,
    peerSockets,
    activeSet,

    setShuttingDown(
      value,
    ) {
      shuttingDown =
        value;
    },

    registerExistingPeer(
      peerId,
    ) {
      const existingConnection = {
        open:
          true,
      };

      socketMeta.set(
        existingConnection,
        {
          peerId,
          roomId:
            'room-old',
        },
      );

      peerSockets.set(
        peerId,
        existingConnection,
      );

      activeSet.add(
        peerId,
      );

      return existingConnection;
    },
  };
}

await test(
  'retry occupied claim then restore',
  async () => {
    const fixture =
      createFixture({
        claimResults: [
          {
            status:
              'claimed',
          },

          {
            status:
              'claimed',
          },

          {
            status:
              'acquired',

            token:
              TOKEN,

            peerId:
              'peer-a',

            roomId:
              'room-1',

            role:
              'impolite',
          },
        ],
      });

    const result =
      await fixture.lifecycle.resume({
        connection:
          fixture.connection,

        token:
          TOKEN,
      });

    assert.equal(
      result.status,
      'restored',
    );

    assert.deepEqual(
      fixture.events,
      [
        'claim',
        'wait:25',
        'claim',
        'wait:25',
        'claim',
        'presence-register',
        'local-register',
        'active-add',
        'restore',
        'local-room',
      ],
    );

    assert.equal(
      fixture.activeSet.has(
        'peer-a',
      ),
      true,
    );

    assert.equal(
      fixture.socketMeta.get(
        fixture.connection,
      ).roomId,
      'room-1',
    );

    assert.equal(
      fixture.activeResume.has(
        fixture.connection,
      ),
      true,
    );
  },
);

await test(
  'return missing without creating identity',
  async () => {
    const fixture =
      createFixture({
        claimResults: [
          {
            status:
              'missing',
          },
        ],
      });

    const result =
      await fixture.lifecycle.resume({
        connection:
          fixture.connection,

        token:
          TOKEN,
      });

    assert.deepEqual(
      result,
      {
        status:
          'missing',
      },
    );

    assert.deepEqual(
      fixture.events,
      [
        'claim',
      ],
    );
  },
);

await test(
  'reject duplicate local peer before presence overwrite',
  async () => {
    const fixture =
      createFixture();

    fixture.registerExistingPeer(
      'peer-a',
    );

    fixture.events.length =
      0;

    const result =
      await fixture.lifecycle.resume({
        connection:
          fixture.connection,

        token:
          TOKEN,
      });

    assert.deepEqual(
      result,
      {
        status:
          'peer-active',

        peerId:
          'peer-a',
      },
    );

    assert.deepEqual(
      fixture.events,
      [
        'claim',
        'release',
      ],
    );

    assert.equal(
      fixture.activeResume.has(
        fixture.connection,
      ),
      false,
    );
  },
);

await test(
  'cleanup presence when socket closes before local registration',
  async () => {
    const fixture =
      createFixture({
        closeAfterPresenceRegister:
          true,
      });

    const result =
      await fixture.lifecycle.resume({
        connection:
          fixture.connection,

        token:
          TOKEN,
      });

    assert.equal(
      result.status,
      'aborted',
    );

    assert.deepEqual(
      fixture.events,
      [
        'claim',
        'presence-register',
        'local-remove',
        'active-delete',
        'cancel-waiting',
        'presence-unregister',
        'release',
      ],
    );

    assert.equal(
      fixture.activeResume.has(
        fixture.connection,
      ),
      false,
    );
  },
);

await test(
  'cleanup claim when presence registration throws',
  async () => {
    const registerError =
      new Error(
        'redis presence unavailable',
      );

    const fixture =
      createFixture({
        peerRegisterError:
          registerError,
      });

    await assert.rejects(
      fixture.lifecycle.resume({
        connection:
          fixture.connection,

        token:
          TOKEN,
      }),
      (
        error,
      ) =>
        error ===
        registerError,
    );

    assert.deepEqual(
      fixture.events,
      [
        'claim',
        'presence-register',
        'presence-unregister',
        'release',
      ],
    );

    assert.equal(
      fixture.activeResume.has(
        fixture.connection,
      ),
      false,
    );
  },
);

await test(
  'restore error reschedules cleanup before claim release',
  async () => {
    const restoreError =
      new Error(
        'redis restore unavailable',
      );

    const fixture =
      createFixture({
        restoreError,
      });

    await assert.rejects(
      fixture.lifecycle.resume({
        connection:
          fixture.connection,

        token:
          TOKEN,
      }),
      (
        error,
      ) =>
        error ===
        restoreError,
    );

    assert.deepEqual(
      fixture.events,
      [
        'claim',
        'presence-register',
        'local-register',
        'active-add',
        'restore',
        'schedule',
        'local-remove',
        'active-delete',
        'cancel-waiting',
        'presence-unregister',
        'release',
      ],
    );

    assert.equal(
      fixture.activeSet.has(
        'peer-a',
      ),
      false,
    );

    assert.equal(
      fixture.activeResume.has(
        fixture.connection,
      ),
      false,
    );
  },
);

await test(
  'invalid room state cleans identity without rescheduling',
  async () => {
    const fixture =
      createFixture({
        restoreResult: {
          status:
            'invalid-state',
        },
      });

    const result =
      await fixture.lifecycle.resume({
        connection:
          fixture.connection,

        token:
          TOKEN,
      });

    assert.deepEqual(
      result,
      {
        status:
          'invalid-state',
      },
    );

    assert.deepEqual(
      fixture.events,
      [
        'claim',
        'presence-register',
        'local-register',
        'active-add',
        'restore',
        'local-remove',
        'active-delete',
        'cancel-waiting',
        'presence-unregister',
        'release',
      ],
    );

    assert.equal(
      fixture.events.includes(
        'schedule',
      ),
      false,
    );
  },
);

await test(
  'local room failure reschedules cleanup',
  async () => {
    const fixture =
      createFixture({
        setRoomResult:
          false,
      });

    const result =
      await fixture.lifecycle.resume({
        connection:
          fixture.connection,

        token:
          TOKEN,
      });

    assert.deepEqual(
      result,
      {
        status:
          'local-room-failed',

        peerId:
          'peer-a',
      },
    );

    assert.deepEqual(
      fixture.events,
      [
        'claim',
        'presence-register',
        'local-register',
        'active-add',
        'restore',
        'local-room',
        'schedule',
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
  'socket close after restore reschedules cleanup',
  async () => {
    const fixture =
      createFixture({
        closeAfterRestore:
          true,
      });

    const result =
      await fixture.lifecycle.resume({
        connection:
          fixture.connection,

        token:
          TOKEN,
      });

    assert.equal(
      result.status,
      'aborted',
    );

    assert.deepEqual(
      fixture.events,
      [
        'claim',
        'presence-register',
        'local-register',
        'active-add',
        'restore',
        'schedule',
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
  'successful close cleanup releases claim last',
  async () => {
    const fixture =
      createFixture();

    const restored =
      await fixture.lifecycle.resume({
        connection:
          fixture.connection,

        token:
          TOKEN,
      });

    assert.equal(
      restored.status,
      'restored',
    );

    fixture.events.length =
      0;

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
      fixture.events.at(
        -1,
      ),
      'release',
    );

    assert.equal(
      fixture.activeSet.has(
        'peer-a',
      ),
      false,
    );

    assert.equal(
      fixture.activeResume.has(
        fixture.connection,
      ),
      false,
    );
  },
);

await test(
  'inactive connection cleanup is no-op',
  async () => {
    const fixture =
      createFixture();

    const result =
      await fixture.lifecycle.cleanup(
        fixture.connection,
      );

    assert.deepEqual(
      result,
      {
        status:
          'inactive',
      },
    );

    assert.deepEqual(
      fixture.events,
      [],
    );
  },
);

await test(
  'shutdown aborts before claiming token',
  async () => {
    const fixture =
      createFixture();

    fixture.setShuttingDown(
      true,
    );

    const result =
      await fixture.lifecycle.resume({
        connection:
          fixture.connection,

        token:
          TOKEN,
      });

    assert.deepEqual(
      result,
      {
        status:
          'aborted',
      },
    );

    assert.deepEqual(
      fixture.events,
      [],
    );
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);