import assert from 'node:assert/strict';
import {
  randomUUID,
} from 'node:crypto';

import Redis from 'ioredis';

import {
  generateResumeToken,
  makeResumeSessionKey,
} from '../src/server/resumeToken.js';

import {
  createResumeSessionStore,
  makeResumeClaimKey,
} from '../src/server/resumeSession.js';

const redisUrl =
  process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error(
    'REDIS_URL is required',
  );
}

const keyPrefix =
  (
    process.env.REDIS_KEY_PREFIX ||
    `bt:resume-real:${randomUUID()}`
  );

const ttlMs = 5_000;
const claimTtlMs = 1_000;

const setup =
  new Redis(
    redisUrl,
    {
      maxRetriesPerRequest: 1,
    },
  );

const clientB =
  new Redis(
    redisUrl,
    {
      maxRetriesPerRequest: 1,
    },
  );

const clientC =
  new Redis(
    redisUrl,
    {
      maxRetriesPerRequest: 1,
    },
  );

function makeStore(
  command,
) {
  return createResumeSessionStore({
    command,
    keyPrefix,
    ttlMs,
    claimTtlMs,
  });
}

function sleep(
  ms,
) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        ms,
      );
    },
  );
}

async function cleanup() {
  const keys = [];

  let cursor = '0';

  do {
    const [
      nextCursor,
      found,
    ] =
      await setup.scan(
        cursor,
        'MATCH',
        `${keyPrefix}:*`,
        'COUNT',
        100,
      );

    cursor =
      nextCursor;

    keys.push(
      ...found,
    );
  } while (
    cursor !== '0'
  );

  if (
    keys.length > 0
  ) {
    await setup.del(
      ...keys,
    );
  }
}

try {
  await cleanup();

  const token =
    generateResumeToken();

  const sessionKey =
    makeResumeSessionKey(
      keyPrefix,
      token,
    );

  const claimKey =
    makeResumeClaimKey(
      keyPrefix,
      token,
    );

  const storeA =
    makeStore(setup);

  const storeB =
    makeStore(clientB);

  const storeC =
    makeStore(clientC);

  assert.equal(
    await storeA.create({
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

  console.log(
    'SESSION_CREATED: true',
  );

  const initialSessionTtl =
    await setup.pttl(
      sessionKey,
    );

  const initialClaimTtl =
    await setup.pttl(
      claimKey,
    );

  console.log(
    'SESSION_TTL_INITIAL:',
    initialSessionTtl,
  );

  console.log(
    'CLAIM_TTL_INITIAL:',
    initialClaimTtl,
  );

  assert.ok(
    initialSessionTtl > 0,
  );

  assert.ok(
    initialClaimTtl > 0,
  );

  assert.ok(
    initialSessionTtl >
      initialClaimTtl,
  );

  await sleep(
    claimTtlMs + 300,
  );

  const sessionExistsAfterClaimExpiry =
    await setup.exists(
      sessionKey,
    );

  const claimExistsAfterExpiry =
    await setup.exists(
      claimKey,
    );

  console.log(
    'SESSION_AFTER_CLAIM_EXPIRY:',
    sessionExistsAfterClaimExpiry,
  );

  console.log(
    'CLAIM_AFTER_EXPIRY:',
    claimExistsAfterExpiry,
  );

  assert.equal(
    sessionExistsAfterClaimExpiry,
    1,
  );

  assert.equal(
    claimExistsAfterExpiry,
    0,
  );

  const [
    resultB,
    resultC,
  ] =
    await Promise.all([
      storeB.claim({
        token,
        claimId:
          'claim-b',
      }),

      storeC.claim({
        token,
        claimId:
          'claim-c',
      }),
    ]);

  console.log(
    'CLAIM_B:',
    resultB,
  );

  console.log(
    'CLAIM_C:',
    resultC,
  );

  const results = [
    {
      claimId:
        'claim-b',
      store:
        storeB,
      result:
        resultB,
    },
    {
      claimId:
        'claim-c',
      store:
        storeC,
      result:
        resultC,
    },
  ];

  const acquired =
    results.filter(
      ({
        result,
      }) =>
        result.status ===
        'acquired',
    );

  const rejected =
    results.filter(
      ({
        result,
      }) =>
        result.status ===
        'claimed',
    );

  assert.equal(
    acquired.length,
    1,
  );

  assert.equal(
    rejected.length,
    1,
  );

  console.log(
    'ACQUIRED_COUNT:',
    acquired.length,
  );

  console.log(
    'CLAIMED_COUNT:',
    rejected.length,
  );

  const winner =
    acquired[0];

  const loser =
    rejected[0];

  console.log(
    'WINNER:',
    winner.claimId,
  );

  assert.deepEqual(
    winner.result,
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

  const redisClaimOwner =
    await setup.get(
      claimKey,
    );

  console.log(
    'REDIS_CLAIM_OWNER:',
    redisClaimOwner,
  );

  assert.equal(
    redisClaimOwner,
    winner.claimId,
  );

  assert.equal(
    await loser.store.refresh({
      token,
      claimId:
        loser.claimId,
    }),
    false,
  );

  assert.equal(
    await winner.store.refresh({
      token,
      claimId:
        winner.claimId,
    }),
    true,
  );

  console.log(
    'WINNER_REFRESH: true',
  );

  assert.equal(
    await winner.store.release({
      token,
      claimId:
        winner.claimId,
    }),
    true,
  );

  console.log(
    'WINNER_RELEASE: true',
  );

  const takeover =
    await loser.store.claim({
      token,
      claimId:
        loser.claimId,
    });

  console.log(
    'LOSER_TAKEOVER:',
    takeover,
  );

  assert.deepEqual(
    takeover,
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

  assert.equal(
    await loser.store.remove({
      token,
      claimId:
        loser.claimId,
    }),
    true,
  );

  console.log(
    'SESSION_REMOVED: true',
  );

  assert.equal(
    await setup.exists(
      sessionKey,
    ),
    0,
  );

  assert.equal(
    await setup.exists(
      claimKey,
    ),
    0,
  );

  console.log(
    'FINAL_SESSION_EXISTS: 0',
  );

  console.log(
    'FINAL_CLAIM_EXISTS: 0',
  );

  console.log(
    'ALL TESTS PASSED',
  );
} finally {
  await cleanup();

  clientB.disconnect();
  clientC.disconnect();
  setup.disconnect();
}