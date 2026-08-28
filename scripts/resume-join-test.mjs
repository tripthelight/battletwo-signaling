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
  'acquire claim without restoring room yet',
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
          'acquired',

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
  'distinguish acquired claim from occupied claim',
  async () => {
    const acquiredConnection =
      {};

    const occupiedConnection =
      {};

    const acquiredFake =
      createFakeConnectionManager();

    const occupiedFake =
      createFakeConnectionManager({
        claimStatus:
          'claimed',
      });

    const acquiredRoom =
      createFakeRoomMembership();

    const occupiedRoom =
      createFakeRoomMembership();

    const acquiredManager =
      createResumeJoinManager({
        connectionManager:
          acquiredFake.manager,

        roomMembership:
          acquiredRoom.membership,
      });

    const occupiedManager =
      createResumeJoinManager({
        connectionManager:
          occupiedFake.manager,

        roomMembership:
          occupiedRoom.membership,
      });

    const acquired =
      await acquiredManager.claim({
        connection:
          acquiredConnection,

        token:
          VALID_TOKEN,
      });

    const occupied =
      await occupiedManager.claim({
        connection:
          occupiedConnection,

        token:
          VALID_TOKEN,
      });

    assert.equal(
      acquired.status,
      'acquired',
    );

    assert.equal(
      occupied.status,
      'claimed',
    );

    assert.notEqual(
      acquired.status,
      occupied.status,
    );
  },
);

await test(
  'restore acquired room membership',
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

    const claimed =
      await manager.claim({
        connection,

        token:
          VALID_TOKEN,
      });

    assert.equal(
      claimed.status,
      'acquired',
    );

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

    const claimed =
      await manager.claim({
        connection,

        token:
          VALID_TOKEN,
      });

    assert.equal(
      claimed.status,
      'acquired',
    );

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

    const claimed =
      await manager.claim({
        connection,

        token:
          VALID_TOKEN,
      });

    assert.equal(
      claimed.status,
      'acquired',
    );

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
  'preserve claim when restore throws',
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

    const claimed =
      await manager.claim({
        connection,

        token:
          VALID_TOKEN,
      });

    assert.equal(
      claimed.status,
      'acquired',
    );

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

    /*
     * restore 오류만으로는 claim을 풀면 안 된다.
     *
     * caller가 동일 peerId의 local/presence cleanup을
     * 완료한 다음 release()해야 한다.
     */
    assert.equal(
      fakeConnection.calls.release,
      0,
    );

    assert.equal(
      fakeConnection.calls.remove,
      0,
    );

    assert.equal(
      fakeConnection.active.has(
        connection,
      ),
      true,
    );

    assert.equal(
      await manager.release(
        connection,
      ),
      true,
    );

    assert.equal(
      fakeConnection.calls.release,
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