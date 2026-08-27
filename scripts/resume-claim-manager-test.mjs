import assert from 'node:assert/strict';

import {
  generateResumeToken,
} from '../src/server/resumeToken.js';

import {
  createResumeClaimManager,
} from '../src/server/resumeClaimManager.js';

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

function createFakeStore() {
  const refreshed = [];
  const released = [];

  let refreshResult =
    true;

  let refreshError =
    null;

  return {
    refreshed,
    released,

    setRefreshResult(
      value,
    ) {
      refreshResult =
        value;
    },

    setRefreshError(
      error,
    ) {
      refreshError =
        error;
    },

    async refresh(
      session,
    ) {
      refreshed.push(
        session,
      );

      if (refreshError) {
        throw refreshError;
      }

      return refreshResult;
    },

    async release(
      session,
    ) {
      released.push(
        session,
      );

      return true;
    },
  };
}

await test(
  'track active claim',
  async () => {
    const store =
      createFakeStore();

    const manager =
      createResumeClaimManager({
        store,
        refreshMs:
          2_000,
      });

    const token =
      generateResumeToken();

    assert.equal(
      manager.track({
        token,
        claimId:
          'claim-a',
      }),
      true,
    );

    assert.equal(
      manager.getActiveCount(),
      1,
    );
  },
);

await test(
  'duplicate track is idempotent',
  async () => {
    const store =
      createFakeStore();

    const manager =
      createResumeClaimManager({
        store,
        refreshMs:
          2_000,
      });

    const token =
      generateResumeToken();

    assert.equal(
      manager.track({
        token,
        claimId:
          'claim-a',
      }),
      true,
    );

    assert.equal(
      manager.track({
        token,
        claimId:
          'claim-a',
      }),
      false,
    );

    assert.equal(
      manager.getActiveCount(),
      1,
    );
  },
);

await test(
  'reject claim id collision',
  async () => {
    const store =
      createFakeStore();

    const manager =
      createResumeClaimManager({
        store,
        refreshMs:
          2_000,
      });

    manager.track({
      token:
        generateResumeToken(),
      claimId:
        'claim-a',
    });

    assert.throws(
      () => {
        manager.track({
          token:
            generateResumeToken(),
          claimId:
            'claim-a',
        });
      },
      /claimId collision/,
    );
  },
);

await test(
  'refresh active claim',
  async () => {
    const store =
      createFakeStore();

    const manager =
      createResumeClaimManager({
        store,
        refreshMs:
          2_000,
      });

    const token =
      generateResumeToken();

    manager.track({
      token,
      claimId:
        'claim-a',
    });

    assert.equal(
      await manager.refreshNow(),
      true,
    );

    assert.deepEqual(
      store.refreshed,
      [
        {
          token,
          claimId:
            'claim-a',
        },
      ],
    );

    assert.equal(
      manager.getActiveCount(),
      1,
    );
  },
);

await test(
  'lost claim is removed and reported',
  async () => {
    const store =
      createFakeStore();

    store.setRefreshResult(
      false,
    );

    const manager =
      createResumeClaimManager({
        store,
        refreshMs:
          2_000,
      });

    const lost = [];

    manager.track({
      token:
        generateResumeToken(),

      claimId:
        'claim-a',

      onLost:
        async (event) => {
          lost.push(
            event,
          );
        },
    });

    await manager.refreshNow();

    assert.equal(
      manager.getActiveCount(),
      0,
    );

    assert.deepEqual(
      lost,
      [
        {
          claimId:
            'claim-a',
          reason:
            'claim-lost',
          error:
            null,
        },
      ],
    );
  },
);

await test(
  'refresh error fails closed',
  async () => {
    const store =
      createFakeStore();

    const failure =
      new Error(
        'redis unavailable',
      );

    store.setRefreshError(
      failure,
    );

    const manager =
      createResumeClaimManager({
        store,
        refreshMs:
          2_000,
      });

    const lost = [];

    manager.track({
      token:
        generateResumeToken(),

      claimId:
        'claim-a',

      onLost:
        async (event) => {
          lost.push(
            event,
          );
        },
    });

    await manager.refreshNow();

    assert.equal(
      manager.getActiveCount(),
      0,
    );

    assert.equal(
      lost.length,
      1,
    );

    assert.equal(
      lost[0].claimId,
      'claim-a',
    );

    assert.equal(
      lost[0].reason,
      'refresh-error',
    );

    assert.equal(
      lost[0].error,
      failure,
    );
  },
);

await test(
  'release active claim',
  async () => {
    const store =
      createFakeStore();

    const manager =
      createResumeClaimManager({
        store,
        refreshMs:
          2_000,
      });

    const token =
      generateResumeToken();

    manager.track({
      token,
      claimId:
        'claim-a',
    });

    assert.equal(
      await manager.release(
        'claim-a',
      ),
      true,
    );

    assert.equal(
      manager.getActiveCount(),
      0,
    );

    assert.deepEqual(
      store.released,
      [
        {
          token,
          claimId:
            'claim-a',
        },
      ],
    );
  },
);

await test(
  'release all active claims',
  async () => {
    const store =
      createFakeStore();

    const manager =
      createResumeClaimManager({
        store,
        refreshMs:
          2_000,
      });

    const tokenA =
      generateResumeToken();

    const tokenB =
      generateResumeToken();

    manager.track({
      token:
        tokenA,
      claimId:
        'claim-a',
    });

    manager.track({
      token:
        tokenB,
      claimId:
        'claim-b',
    });

    const results =
      await manager.releaseAll();

    assert.equal(
      results.length,
      2,
    );

    assert.equal(
      manager.getActiveCount(),
      0,
    );

    assert.deepEqual(
      store.released,
      [
        {
          token:
            tokenA,
          claimId:
            'claim-a',
        },
        {
          token:
            tokenB,
          claimId:
            'claim-b',
        },
      ],
    );
  },
);

await test(
  'start and stop refresh timer',
  async () => {
    const store =
      createFakeStore();

    const manager =
      createResumeClaimManager({
        store,
        refreshMs:
          2_000,
      });

    assert.equal(
      manager.start(),
      true,
    );

    assert.equal(
      manager.start(),
      false,
    );

    assert.equal(
      manager.stop(),
      true,
    );

    assert.equal(
      manager.stop(),
      false,
    );
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);