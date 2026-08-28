import assert from 'node:assert/strict';

import {
  createResumeJoinManager,
} from '../src/server/resumeJoin.js';

const VALID_TOKEN =
  'A'.repeat(
    43,
  );

let passed = 0;

async function test(
  name,
  fn,
) {
  try {
    await fn();

    passed += 1;

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

function createFakeConnectionManager({
  claimStatus =
    'acquired',

  peerId =
    'peer-a',

  roomId =
    'room-1',

  role =
    'impolite',
} = {}) {
  const active =
    new WeakMap();

  const calls = {
    claim:
      0,

    get:
      0,

    release:
      0,

    remove:
      0,
  };

  async function claim({
    connection,
    token,
  }) {
    calls.claim +=
      1;

    if (
      claimStatus !==
      'acquired'
    ) {
      return {
        status:
          claimStatus,
      };
    }

    const record = {
      status:
        'active',

      token,

      peerId,

      roomId,

      role,
    };

    active.set(
      connection,
      record,
    );

    return {
      status:
        'acquired',

      token,

      peerId,

      roomId,

      role,
    };
  }

  function get(
    connection,
  ) {
    calls.get +=
      1;

    return (
      active.get(
        connection,
      ) ??
      null
    );
  }

  async function release(
    connection,
  ) {
    calls.release +=
      1;

    if (
      !active.has(
        connection,
      )
    ) {
      return false;
    }

    active.delete(
      connection,
    );

    return true;
  }

  async function remove(
    connection,
  ) {
    calls.remove +=
      1;

    if (
      !active.has(
        connection,
      )
    ) {
      return false;
    }

    active.delete(
      connection,
    );

    return true;
  }

  return {
    manager: {
      claim,
      get,
      release,
      remove,
    },

    calls,

    active,
  };
}

function createFakeRoomMembership({
  result = {
    roomId:
      'room-1',

    role:
      'impolite',

    partnerPeerId:
      'peer-b',
  },

  error =
    null,
} = {}) {
  const calls = [];

  return {
    calls,

    membership: {
      async restore(
        params,
      ) {
        calls.push({
          ...params,
        });

        if (error) {
          throw error;
        }

        return result;
      },
    },
  };
}

await test(
  'reject malformed token before claim',
  async () => {
    const connection =
      {};

    const fakeConnection =
      createFakeConnectionManager();

    const fakeRoom =
      createFakeRoomMembership();

    const manager =
      createResumeJoinManager({
        connectionManager:
          fakeConnection.manager,

        roomMembership:
          fakeRoom.membership,
      });

    assert.deepEqual(
      await manager.claim({
        connection,

        token:
          'bad-token',
      }),
      {
        status:
          'invalid-token',
      },
    );

    assert.equal(
      fakeConnection.calls.claim,
      0,
    );

    assert.equal(
      fakeRoom.calls.length,
      0,
    );
  },
);

await test(
  'return missing resume session',
  async () => {
    const connection =
      {};

    const fakeConnection =
      createFakeConnectionManager({
        claimStatus:
          'missing',
      });

    const fakeRoom =
      createFakeRoomMembership();

    const manager =
      createResumeJoinManager({
        connectionManager:
          fakeConnection.manager,

        roomMembership:
          fakeRoom.membership,
      });

    assert.deepEqual(
      await manager.claim({
        connection,

        token:
          VALID_TOKEN,
      }),
      {
        status:
          'missing',
      },
    );

    assert.equal(
      fakeConnection.calls.claim,
      1,
    );

    assert.equal(
      fakeRoom.calls.length,
      0,
    );
  },
);

await test(
  'return already claimed resume session',
  async () => {
    const connection =
      {};

    const fakeConnection =
      createFakeConnectionManager({
        claimStatus:
          'claimed',
      });

    const fakeRoom =
      createFakeRoomMembership();

    const manager =
      createResumeJoinManager({
        connectionManager:
          fakeConnection.manager,

        roomMembership:
          fakeRoom.membership,
      });

    assert.deepEqual(
      await manager.claim({
        connection,

        token:
          VALID_TOKEN,
      }),
      {
        status:
          'claimed',
      },
    );

    assert.equal(
      fakeRoom.calls.length,
      0,
    );
  },
);

await test(
  'claim does not restore room yet',
  async () => {
    const connection =
      {};

    const fakeConnection =
      createFakeConnectionManager();

    const fakeRoom =
      createFakeRoomMembership();

    const manager =
      createResumeJoinManager({
        connectionManager:
          fakeConnection.manager,

        roomMembership:
          fakeRoom.membership,
      });

    assert.deepEqual(
      await manager.claim({
        connection,

        token:
          VALID_TOKEN,
      }),
      {
        status:
          'claimed',

        token:
          VALID_TOKEN,

        peerId:
          'peer-a',

        roomId:
          'room-1',

        role:
          'impolite',
      },
    );

    /*
     * 이 시점에는 server가 아직 동일 peerId를
     * local/presence에 등록할 기회를 가져야 하므로
     * room restore가 호출되면 안 된다.
     */
    assert.equal(
      fakeRoom.calls.length,
      0,
    );

    assert.equal(
      fakeConnection.active.has(
        connection,
      ),
      true,
    );
  },
);

await test(
  'restore claimed room membership',
  async () => {
    const connection =
      {};

    const fakeConnection =
      createFakeConnectionManager();

    const fakeRoom =
      createFakeRoomMembership();

    const manager =
      createResumeJoinManager({
        connectionManager:
          fakeConnection.manager,

        roomMembership:
          fakeRoom.membership,
      });

    await manager.claim({
      connection,

      token:
        VALID_TOKEN,
    });

    assert.deepEqual(
      await manager.restore(
        connection,
      ),
      {
        status:
          'restored',

        token:
          VALID_TOKEN,

        peerId:
          'peer-a',

        roomId:
          'room-1',

        role:
          'impolite',

        partnerPeerId:
          'peer-b',
      },
    );

    assert.deepEqual(
      fakeRoom.calls,
      [
        {
          peerId:
            'peer-a',

          roomId:
            'room-1',

          role:
            'impolite',
        },
      ],
    );

    assert.equal(
      fakeConnection.calls.remove,
      0,
    );

    assert.equal(
      fakeConnection.calls.release,
      0,
    );

    assert.equal(
      fakeConnection.active.has(
        connection,
      ),
      true,
    );
  },
);

await test(
  'remove session when room state is invalid',
  async () => {
    const connection =
      {};

    const fakeConnection =
      createFakeConnectionManager();

    const fakeRoom =
      createFakeRoomMembership({
        result:
          null,
      });

    const manager =
      createResumeJoinManager({
        connectionManager:
          fakeConnection.manager,

        roomMembership:
          fakeRoom.membership,
      });

    await manager.claim({
      connection,

      token:
        VALID_TOKEN,
    });

    assert.deepEqual(
      await manager.restore(
        connection,
      ),
      {
        status:
          'invalid-state',
      },
    );

    assert.equal(
      fakeConnection.calls.remove,
      1,
    );

    assert.equal(
      fakeConnection.active.has(
        connection,
      ),
      false,
    );
  },
);

await test(
  'remove session when restored identity mismatches',
  async () => {
    const connection =
      {};

    const fakeConnection =
      createFakeConnectionManager();

    const fakeRoom =
      createFakeRoomMembership({
        result: {
          roomId:
            'room-1',

          role:
            'polite',

          partnerPeerId:
            'peer-b',
        },
      });

    const manager =
      createResumeJoinManager({
        connectionManager:
          fakeConnection.manager,

        roomMembership:
          fakeRoom.membership,
      });

    await manager.claim({
      connection,

      token:
        VALID_TOKEN,
    });

    assert.deepEqual(
      await manager.restore(
        connection,
      ),
      {
        status:
          'invalid-state',
      },
    );

    assert.equal(
      fakeConnection.calls.remove,
      1,
    );

    assert.equal(
      fakeConnection.active.has(
        connection,
      ),
      false,
    );
  },
);

await test(
  'release claim when restore throws',
  async () => {
    const connection =
      {};

    const restoreError =
      new Error(
        'redis unavailable',
      );

    const fakeConnection =
      createFakeConnectionManager();

    const fakeRoom =
      createFakeRoomMembership({
        error:
          restoreError,
      });

    const manager =
      createResumeJoinManager({
        connectionManager:
          fakeConnection.manager,

        roomMembership:
          fakeRoom.membership,
      });

    await manager.claim({
      connection,

      token:
        VALID_TOKEN,
    });

    await assert.rejects(
      manager.restore(
        connection,
      ),
      (
        error,
      ) =>
        error ===
        restoreError,
    );

    assert.equal(
      fakeConnection.calls.release,
      1,
    );

    assert.equal(
      fakeConnection.calls.remove,
      0,
    );

    assert.equal(
      fakeConnection.active.has(
        connection,
      ),
      false,
    );
  },
);

await test(
  'return inactive when connection has no claim',
  async () => {
    const connection =
      {};

    const fakeConnection =
      createFakeConnectionManager();

    const fakeRoom =
      createFakeRoomMembership();

    const manager =
      createResumeJoinManager({
        connectionManager:
          fakeConnection.manager,

        roomMembership:
          fakeRoom.membership,
      });

    assert.deepEqual(
      await manager.restore(
        connection,
      ),
      {
        status:
          'inactive',
      },
    );

    assert.equal(
      fakeRoom.calls.length,
      0,
    );
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);