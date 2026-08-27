import assert from 'node:assert/strict';

import {
  generateResumeToken,
  makeResumeSessionKey,
} from '../src/server/resumeToken.js';

import {
  createResumeSessionStore,
  makeResumeClaimKey,
} from '../src/server/resumeSession.js';

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

function createFakeCommand() {
  const sessions =
    new Map();

  const claims =
    new Map();

  return {
    sessions,
    claims,

    async eval(
      script,
      numberOfKeys,
      sessionKey,
      claimKey,
      ...args
    ) {
      assert.equal(
        numberOfKeys,
        2,
      );

      if (
        script.includes(
          '-- resume:create',
        )
      ) {
        if (
          sessions.has(
            sessionKey,
          ) ||
          claims.has(
            claimKey,
          )
        ) {
          return [
            'collision',
          ];
        }

        const [
          peerId,
          roomId,
          role,
          claimId,
        ] = args;

        sessions.set(
          sessionKey,
          {
            peerId,
            roomId,
            role,
          },
        );

        claims.set(
          claimKey,
          claimId,
        );

        return [
          'created',
        ];
      }

      if (
        script.includes(
          '-- resume:claim',
        )
      ) {
        const [
          claimId,
        ] = args;

        const session =
          sessions.get(
            sessionKey,
          );

        if (!session) {
          return [
            'missing',
          ];
        }

        const currentClaim =
          claims.get(
            claimKey,
          );

        if (
          currentClaim &&
          currentClaim !==
            claimId
        ) {
          return [
            'claimed',
          ];
        }

        if (
          !session.peerId ||
          !session.roomId ||
          !session.role
        ) {
          return [
            'invalid',
          ];
        }

        claims.set(
          claimKey,
          claimId,
        );

        return [
          'acquired',
          session.peerId,
          session.roomId,
          session.role,
        ];
      }

      if (
        script.includes(
          '-- resume:refresh',
        )
      ) {
        const [
          claimId,
        ] = args;

        if (
          claims.get(
            claimKey,
          ) !== claimId
        ) {
          return 0;
        }

        if (
          !sessions.has(
            sessionKey,
          )
        ) {
          claims.delete(
            claimKey,
          );

          return 0;
        }

        return 1;
      }

      if (
        script.includes(
          '-- resume:release',
        )
      ) {
        const [
          claimId,
        ] = args;

        if (
          claims.get(
            claimKey,
          ) !== claimId
        ) {
          return 0;
        }

        claims.delete(
          claimKey,
        );

        return 1;
      }

      if (
        script.includes(
          '-- resume:remove',
        )
      ) {
        const [
          claimId,
        ] = args;

        if (
          claims.get(
            claimKey,
          ) !== claimId
        ) {
          return 0;
        }

        claims.delete(
          claimKey,
        );

        return (
          sessions.delete(
            sessionKey,
          )
            ? 1
            : 0
        );
      }

      throw new Error(
        'unexpected lua script',
      );
    },
  };
}

function createStore(
  command,
) {
  return createResumeSessionStore({
    command,
    keyPrefix:
      'bt:test',

    ttlMs:
      15_000,

    claimTtlMs:
      5_000,
  });
}

await test(
  'build separate claim key',
  async () => {
    const token =
      generateResumeToken();

    const sessionKey =
      makeResumeSessionKey(
        'bt:test',
        token,
      );

    const claimKey =
      makeResumeClaimKey(
        'bt:test',
        token,
      );

    assert.equal(
      claimKey,
      `${sessionKey}:claim`,
    );

    assert.equal(
      claimKey.includes(
        token,
      ),
      false,
    );
  },
);

await test(
  'create resume session',
  async () => {
    const command =
      createFakeCommand();

    const store =
      createStore(command);

    const token =
      generateResumeToken();

    assert.equal(
      await store.create({
        token,
        peerId:
          'peer-a',
        roomId:
          'room-1',
        role:
          'impolite',
        claimId:
          'claim-a',
      }),
      true,
    );

    const sessionKey =
      makeResumeSessionKey(
        'bt:test',
        token,
      );

    const claimKey =
      makeResumeClaimKey(
        'bt:test',
        token,
      );

    assert.deepEqual(
      command.sessions.get(
        sessionKey,
      ),
      {
        peerId:
          'peer-a',
        roomId:
          'room-1',
        role:
          'impolite',
      },
    );

    assert.equal(
      command.claims.get(
        claimKey,
      ),
      'claim-a',
    );
  },
);

await test(
  'reject token collision',
  async () => {
    const command =
      createFakeCommand();

    const store =
      createStore(command);

    const token =
      generateResumeToken();

    const session = {
      token,
      peerId:
        'peer-a',
      roomId:
        'room-1',
      role:
        'impolite',
      claimId:
        'claim-a',
    };

    assert.equal(
      await store.create(
        session,
      ),
      true,
    );

    assert.equal(
      await store.create(
        session,
      ),
      false,
    );
  },
);

await test(
  'reject claim while owned',
  async () => {
    const command =
      createFakeCommand();

    const store =
      createStore(command);

    const token =
      generateResumeToken();

    await store.create({
      token,
      peerId:
        'peer-a',
      roomId:
        'room-1',
      role:
        'impolite',
      claimId:
        'claim-a',
    });

    assert.deepEqual(
      await store.claim({
        token,
        claimId:
          'claim-b',
      }),
      {
        status:
          'claimed',
      },
    );
  },
);

await test(
  'same owner claim is idempotent',
  async () => {
    const command =
      createFakeCommand();

    const store =
      createStore(command);

    const token =
      generateResumeToken();

    await store.create({
      token,
      peerId:
        'peer-a',
      roomId:
        'room-1',
      role:
        'impolite',
      claimId:
        'claim-a',
    });

    assert.deepEqual(
      await store.claim({
        token,
        claimId:
          'claim-a',
      }),
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
    );
  },
);

await test(
  'release allows new owner',
  async () => {
    const command =
      createFakeCommand();

    const store =
      createStore(command);

    const token =
      generateResumeToken();

    await store.create({
      token,
      peerId:
        'peer-a',
      roomId:
        'room-1',
      role:
        'polite',
      claimId:
        'claim-a',
    });

    assert.equal(
      await store.release({
        token,
        claimId:
          'claim-a',
      }),
      true,
    );

    assert.deepEqual(
      await store.claim({
        token,
        claimId:
          'claim-b',
      }),
      {
        status:
          'acquired',
        peerId:
          'peer-a',
        roomId:
          'room-1',
        role:
          'polite',
      },
    );
  },
);

await test(
  'expired claim allows takeover while session remains',
  async () => {
    const command =
      createFakeCommand();

    const store =
      createStore(command);

    const token =
      generateResumeToken();

    await store.create({
      token,
      peerId:
        'peer-a',
      roomId:
        'room-1',
      role:
        'impolite',
      claimId:
        'claim-a',
    });

    const claimKey =
      makeResumeClaimKey(
        'bt:test',
        token,
      );

    command.claims.delete(
      claimKey,
    );

    assert.deepEqual(
      await store.claim({
        token,
        claimId:
          'claim-b',
      }),
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
    );
  },
);

await test(
  'wrong owner cannot release',
  async () => {
    const command =
      createFakeCommand();

    const store =
      createStore(command);

    const token =
      generateResumeToken();

    await store.create({
      token,
      peerId:
        'peer-a',
      roomId:
        'room-1',
      role:
        'impolite',
      claimId:
        'claim-a',
    });

    assert.equal(
      await store.release({
        token,
        claimId:
          'claim-b',
      }),
      false,
    );
  },
);

await test(
  'owner can refresh',
  async () => {
    const command =
      createFakeCommand();

    const store =
      createStore(command);

    const token =
      generateResumeToken();

    await store.create({
      token,
      peerId:
        'peer-a',
      roomId:
        'room-1',
      role:
        'impolite',
      claimId:
        'claim-a',
    });

    assert.equal(
      await store.refresh({
        token,
        claimId:
          'claim-a',
      }),
      true,
    );
  },
);

await test(
  'wrong owner cannot refresh',
  async () => {
    const command =
      createFakeCommand();

    const store =
      createStore(command);

    const token =
      generateResumeToken();

    await store.create({
      token,
      peerId:
        'peer-a',
      roomId:
        'room-1',
      role:
        'impolite',
      claimId:
        'claim-a',
    });

    assert.equal(
      await store.refresh({
        token,
        claimId:
          'claim-b',
      }),
      false,
    );
  },
);

await test(
  'claim missing session',
  async () => {
    const command =
      createFakeCommand();

    const store =
      createStore(command);

    assert.deepEqual(
      await store.claim({
        token:
          generateResumeToken(),
        claimId:
          'claim-a',
      }),
      {
        status:
          'missing',
      },
    );
  },
);

await test(
  'owner can remove session',
  async () => {
    const command =
      createFakeCommand();

    const store =
      createStore(command);

    const token =
      generateResumeToken();

    await store.create({
      token,
      peerId:
        'peer-a',
      roomId:
        'room-1',
      role:
        'impolite',
      claimId:
        'claim-a',
    });

    assert.equal(
      await store.remove({
        token,
        claimId:
          'claim-a',
      }),
      true,
    );

    assert.deepEqual(
      await store.claim({
        token,
        claimId:
          'claim-a',
      }),
      {
        status:
          'missing',
      },
    );
  },
);

await test(
  'reject claim ttl not shorter than session ttl',
  async () => {
    const command =
      createFakeCommand();

    assert.throws(
      () => {
        createResumeSessionStore({
          command,
          keyPrefix:
            'bt:test',
          ttlMs:
            5_000,
          claimTtlMs:
            5_000,
        });
      },
      /claimTtlMs must be less than ttlMs/,
    );
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);