import assert from 'node:assert/strict';

import {
  createResumeClaimManager,
} from '../src/server/resumeClaimManager.js';

import {
  createResumeConnectionManager,
} from '../src/server/resumeConnection.js';

import {
  generateResumeToken,
  isValidResumeToken,
} from '../src/server/resumeToken.js';

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

function createFakeStore({
  createResults = [],
  claimResults = [],
  refreshResults = [],
} = {}) {
  const calls = {
    create: [],
    claim: [],
    refresh: [],
    release: [],
    remove: [],
  };

  let createIndex = 0;
  let claimIndex = 0;
  let refreshIndex = 0;

  return {
    calls,

    async create(
      params,
    ) {
      calls.create.push({
        ...params,
      });

      const configured =
        createResults[
          createIndex
        ];

      createIndex += 1;

      return (
        configured ===
        undefined
          ? true
          : configured
      );
    },

    async claim(
      params,
    ) {
      calls.claim.push({
        ...params,
      });

      const configured =
        claimResults[
          claimIndex
        ];

      claimIndex += 1;

      if (configured) {
        return {
          ...configured,
        };
      }

      return {
        status:
          'missing',
      };
    },

    async refresh(
      params,
    ) {
      calls.refresh.push({
        ...params,
      });

      const configured =
        refreshResults[
          refreshIndex
        ];

      refreshIndex += 1;

      return (
        configured ===
        undefined
          ? true
          : configured
      );
    },

    async release(
      params,
    ) {
      calls.release.push({
        ...params,
      });

      return true;
    },

    async remove(
      params,
    ) {
      calls.remove.push({
        ...params,
      });

      return true;
    },
  };
}

function createManager({
  store,
  generateToken,
  generateClaimId,
} = {}) {
  const actualStore =
    store ??
    createFakeStore();

  const claimManager =
    createResumeClaimManager({
      store:
        actualStore,

      refreshMs:
        1_000,
    });

  const manager =
    createResumeConnectionManager({
      store:
        actualStore,

      claimManager,

      ...(generateToken
        ? {
            generateToken,
          }
        : {}),

      ...(generateClaimId
        ? {
            generateClaimId,
          }
        : {}),
    });

  return {
    store:
      actualStore,

    claimManager,

    manager,
  };
}

await test(
  'issue resume session',
  async () => {
    const {
      store,
      claimManager,
      manager,
    } =
      createManager();

    const connection =
      {};

    const result =
      await manager.issue({
        connection,

        peerId:
          'peer-a',

        roomId:
          'room-1',

        role:
          'impolite',
      });

    assert.equal(
      result.status,
      'issued',
    );

    assert.equal(
      isValidResumeToken(
        result.token,
      ),
      true,
    );

    assert.equal(
      result.peerId,
      'peer-a',
    );

    assert.equal(
      result.roomId,
      'room-1',
    );

    assert.equal(
      result.role,
      'impolite',
    );

    assert.equal(
      manager.has(
        connection,
      ),
      true,
    );

    assert.equal(
      claimManager
        .getActiveCount(),
      1,
    );

    assert.equal(
      store.calls
        .create.length,
      1,
    );

    assert.equal(
      store.calls.create[0]
        .token,
      result.token,
    );
  },
);

await test(
  'reuse active session for same connection',
  async () => {
    const {
      store,
      manager,
    } =
      createManager();

    const connection =
      {};

    const first =
      await manager.issue({
        connection,

        peerId:
          'peer-a',

        roomId:
          'room-1',

        role:
          'impolite',
      });

    const second =
      await manager.issue({
        connection,

        peerId:
          'peer-a',

        roomId:
          'room-1',

        role:
          'impolite',
      });

    assert.equal(
      first.status,
      'issued',
    );

    assert.equal(
      second.status,
      'active',
    );

    assert.equal(
      second.token,
      first.token,
    );

    assert.equal(
      store.calls
        .create.length,
      1,
    );
  },
);

await test(
  'retry token collision',
  async () => {
    const firstToken =
      generateResumeToken();

    const secondToken =
      generateResumeToken();

    const tokens = [
      firstToken,
      secondToken,
    ];

    const claimIds = [
      'claim-1',
      'claim-2',
    ];

    const store =
      createFakeStore({
        createResults: [
          false,
          true,
        ],
      });

    const {
      manager,
    } =
      createManager({
        store,

        generateToken:
          () =>
            tokens.shift(),

        generateClaimId:
          () =>
            claimIds.shift(),
      });

    const result =
      await manager.issue({
        connection:
          {},

        peerId:
          'peer-a',

        roomId:
          'room-1',

        role:
          'polite',
      });

    assert.equal(
      result.status,
      'issued',
    );

    assert.equal(
      result.token,
      secondToken,
    );

    assert.equal(
      store.calls
        .create.length,
      2,
    );
  },
);

await test(
  'claim existing resume session',
  async () => {
    const token =
      generateResumeToken();

    const store =
      createFakeStore({
        claimResults: [
          {
            status:
              'acquired',

            peerId:
              'peer-a',

            roomId:
              'room-1',

            role:
              'impolite',
          },
        ],
      });

    const {
      claimManager,
      manager,
    } =
      createManager({
        store,

        generateClaimId:
          () =>
            'claim-resume',
      });

    const connection =
      {};

    const result =
      await manager.claim({
        connection,
        token,
      });

    assert.equal(
      result.status,
      'acquired',
    );

    assert.equal(
      result.token,
      token,
    );

    assert.equal(
      result.peerId,
      'peer-a',
    );

    assert.equal(
      result.roomId,
      'room-1',
    );

    assert.equal(
      result.role,
      'impolite',
    );

    assert.equal(
      manager.has(
        connection,
      ),
      true,
    );

    assert.equal(
      claimManager
        .getActiveCount(),
      1,
    );
  },
);

await test(
  'report token already claimed',
  async () => {
    const token =
      generateResumeToken();

    const store =
      createFakeStore({
        claimResults: [
          {
            status:
              'claimed',
          },
        ],
      });

    const {
      manager,
    } =
      createManager({
        store,
      });

    const connection =
      {};

    const result =
      await manager.claim({
        connection,
        token,
      });

    assert.deepEqual(
      result,
      {
        status:
          'claimed',
      },
    );

    assert.equal(
      manager.has(
        connection,
      ),
      false,
    );
  },
);

await test(
  'release active resume session',
  async () => {
    const {
      store,
      claimManager,
      manager,
    } =
      createManager();

    const connection =
      {};

    await manager.issue({
      connection,

      peerId:
        'peer-a',

      roomId:
        'room-1',

      role:
        'impolite',
    });

    assert.equal(
      await manager.release(
        connection,
      ),
      true,
    );

    assert.equal(
      manager.has(
        connection,
      ),
      false,
    );

    assert.equal(
      claimManager
        .getActiveCount(),
      0,
    );

    assert.equal(
      store.calls
        .release.length,
      1,
    );
  },
);

await test(
  'remove active resume session',
  async () => {
    const {
      store,
      claimManager,
      manager,
    } =
      createManager();

    const connection =
      {};

    await manager.issue({
      connection,

      peerId:
        'peer-a',

      roomId:
        'room-1',

      role:
        'polite',
    });

    assert.equal(
      await manager.remove(
        connection,
      ),
      true,
    );

    assert.equal(
      manager.has(
        connection,
      ),
      false,
    );

    assert.equal(
      claimManager
        .getActiveCount(),
      0,
    );

    assert.equal(
      store.calls
        .remove.length,
      1,
    );
  },
);

await test(
  'drop connection when claim is lost',
  async () => {
    const store =
      createFakeStore({
        refreshResults: [
          false,
        ],
      });

    const {
      claimManager,
      manager,
    } =
      createManager({
        store,
      });

    const connection =
      {};

    let lostEvent =
      null;

    await manager.issue({
      connection,

      peerId:
        'peer-a',

      roomId:
        'room-1',

      role:
        'impolite',

      onLost:
        async (event) => {
          lostEvent =
            event;
        },
    });

    assert.equal(
      manager.has(
        connection,
      ),
      true,
    );

    await claimManager
      .refreshNow();

    assert.equal(
      manager.has(
        connection,
      ),
      false,
    );

    assert.equal(
      claimManager
        .getActiveCount(),
      0,
    );

    assert.ok(
      lostEvent,
    );

    assert.equal(
      lostEvent.reason,
      'claim-lost',
    );

    assert.equal(
      lostEvent.peerId,
      'peer-a',
    );

    assert.equal(
      lostEvent.roomId,
      'room-1',
    );

    assert.equal(
      lostEvent.role,
      'impolite',
    );
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);