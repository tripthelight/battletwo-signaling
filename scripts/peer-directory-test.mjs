import assert from 'node:assert/strict';

import {
  createPeerDirectory,
  makePeerKey,
} from '../src/server/peerDirectory.js';

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

function createFakeRedis() {
  const values =
    new Map();

  return {
    async set(
      key,
      value,
      mode,
      ttlMs,
    ) {
      assert.equal(
        mode,
        'PX',
      );

      assert.ok(
        ttlMs >= 1000,
      );

      values.set(
        key,
        value,
      );

      return 'OK';
    },

    async get(key) {
      return (
        values.get(key) ??
        null
      );
    },

    async eval(
      script,
      numberOfKeys,
      key,
      instanceId,
      ttlMs,
    ) {
      assert.equal(
        numberOfKeys,
        1,
      );

      if (
        values.get(key) !==
        instanceId
      ) {
        return 0;
      }

      if (
        script.includes(
          'PEXPIRE',
        )
      ) {
        assert.ok(
          Number(ttlMs) >=
            1000,
        );

        return 1;
      }

      if (
        script.includes(
          "'DEL'",
        )
      ) {
        values.delete(key);

        return 1;
      }

      throw new Error(
        'unexpected script',
      );
    },

    values,
  };
}

await test(
  'build peer key',
  async () => {
    assert.equal(
      makePeerKey(
        'bt:test',
        'peer-1',
      ),
      'bt:test:peer:peer-1',
    );
  },
);

await test(
  'register peer instance',
  async () => {
    const command =
      createFakeRedis();

    const directory =
      createPeerDirectory({
        command,
        keyPrefix:
          'bt:test',
        instanceId:
          'signaling-a',
        ttlMs: 30_000,
      });

    const result =
      await directory.register(
        'peer-1',
      );

    assert.deepEqual(
      result,
      {
        peerId: 'peer-1',
        instanceId:
          'signaling-a',
      },
    );

    assert.equal(
      await directory.findInstance(
        'peer-1',
      ),
      'signaling-a',
    );
  },
);

await test(
  'refresh owned peer',
  async () => {
    const command =
      createFakeRedis();

    const directory =
      createPeerDirectory({
        command,
        keyPrefix:
          'bt:test',
        instanceId:
          'signaling-a',
        ttlMs: 30_000,
      });

    await directory.register(
      'peer-1',
    );

    assert.equal(
      await directory.refresh(
        'peer-1',
      ),
      true,
    );
  },
);

await test(
  'do not refresh peer owned elsewhere',
  async () => {
    const command =
      createFakeRedis();

    command.values.set(
      'bt:test:peer:peer-1',
      'signaling-b',
    );

    const directory =
      createPeerDirectory({
        command,
        keyPrefix:
          'bt:test',
        instanceId:
          'signaling-a',
        ttlMs: 30_000,
      });

    assert.equal(
      await directory.refresh(
        'peer-1',
      ),
      false,
    );
  },
);

await test(
  'unregister owned peer',
  async () => {
    const command =
      createFakeRedis();

    const directory =
      createPeerDirectory({
        command,
        keyPrefix:
          'bt:test',
        instanceId:
          'signaling-a',
        ttlMs: 30_000,
      });

    await directory.register(
      'peer-1',
    );

    assert.equal(
      await directory.unregister(
        'peer-1',
      ),
      true,
    );

    assert.equal(
      await directory.findInstance(
        'peer-1',
      ),
      null,
    );
  },
);

await test(
  'do not unregister peer owned elsewhere',
  async () => {
    const command =
      createFakeRedis();

    command.values.set(
      'bt:test:peer:peer-1',
      'signaling-b',
    );

    const directory =
      createPeerDirectory({
        command,
        keyPrefix:
          'bt:test',
        instanceId:
          'signaling-a',
        ttlMs: 30_000,
      });

    assert.equal(
      await directory.unregister(
        'peer-1',
      ),
      false,
    );

    assert.equal(
      await directory.findInstance(
        'peer-1',
      ),
      'signaling-b',
    );
  },
);

await test(
  'reject invalid peer id',
  async () => {
    const command =
      createFakeRedis();

    const directory =
      createPeerDirectory({
        command,
        keyPrefix:
          'bt:test',
        instanceId:
          'signaling-a',
        ttlMs: 30_000,
      });

    await assert.rejects(
      async () => {
        await directory.register(
          '',
        );
      },
      /peerId/,
    );
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);