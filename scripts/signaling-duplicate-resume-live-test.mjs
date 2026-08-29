import assert from 'node:assert/strict';

import Redis from 'ioredis';
import WebSocket from 'ws';

import {
  makePeerKey,
} from '../src/server/peerDirectory.js';
import {
  makePeerRoomKey,
  makeRoomCleanupKey,
  makeRoomCleanupRoomKey,
  makeRoomKey,
} from '../src/server/roomMembership.js';
import {
  makeResumeClaimKey,
} from '../src/server/resumeSession.js';
import {
  isValidResumeToken,
  makeResumeSessionKey,
} from '../src/server/resumeToken.js';

const redisUrl = process.env.REDIS_URL;
const keyPrefix = process.env.REDIS_KEY_PREFIX;

if (typeof redisUrl !== 'string' || redisUrl.length === 0) {
  throw new Error('REDIS_URL is required');
}

if (typeof keyPrefix !== 'string' || keyPrefix.length === 0) {
  throw new Error('REDIS_KEY_PREFIX is required');
}

const URL_A = 'ws://127.0.0.1:5101';
const URL_B = 'ws://127.0.0.1:5102';
const MESSAGE_TIMEOUT_MS = 10_000;
const REDIS_STATE_TIMEOUT_MS = 5_000;
const REDIS_POLL_MS = 25;
const POST_DEADLINE_MARGIN_MS = 2_000;

const redis = new Redis(redisUrl, {
  lazyConnect: true,
  connectTimeout: 5_000,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
});

function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function waitForOpen(ws, label) {
  if (ws.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();

      reject(
        new Error(
          `${label} open timeout`,
        ),
      );
    }, MESSAGE_TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timeout);

      ws.off(
        'open',
        onOpen,
      );

      ws.off(
        'error',
        onError,
      );
    }

    function onOpen() {
      cleanup();
      resolve();
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    ws.once(
      'open',
      onOpen,
    );

    ws.once(
      'error',
      onError,
    );
  });
}

function createInbox(ws, label) {
  const buffered = [];
  const received = [];
  const waiters = [];

  function rejectAll(error) {
    const pending =
      waiters.splice(
        0,
        waiters.length,
      );

    for (const waiter of pending) {
      clearTimeout(
        waiter.timeout,
      );

      waiter.reject(error);
    }
  }

  ws.on(
    'message',
    (raw) => {
      let message;

      try {
        message =
          JSON.parse(
            raw.toString(),
          );
      } catch {
        rejectAll(
          new Error(
            `${label} received invalid JSON`,
          ),
        );

        return;
      }

      received.push(message);

      const waiterIndex =
        waiters.findIndex(
          (waiter) =>
            waiter.predicate(
              message,
            ),
        );

      if (waiterIndex >= 0) {
        const [waiter] =
          waiters.splice(
            waiterIndex,
            1,
          );

        clearTimeout(
          waiter.timeout,
        );

        waiter.resolve(
          message,
        );

        return;
      }

      buffered.push(message);
    },
  );

  ws.on(
    'error',
    (error) => {
      rejectAll(error);
    },
  );

  function waitFor(
    predicate,
    description,
    timeoutMs = MESSAGE_TIMEOUT_MS,
  ) {
    const bufferedIndex =
      buffered.findIndex(
        predicate,
      );

    if (bufferedIndex >= 0) {
      const [message] =
        buffered.splice(
          bufferedIndex,
          1,
        );

      return Promise.resolve(
        message,
      );
    }

    return new Promise(
      (resolve, reject) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timeout: null,
        };

        waiter.timeout =
          setTimeout(
            () => {
              const index =
                waiters.indexOf(
                  waiter,
                );

              if (index >= 0) {
                waiters.splice(
                  index,
                  1,
                );
              }

              reject(
                new Error(
                  `${label} timed out waiting for ${description}`,
                ),
              );
            },
            timeoutMs,
          );

        waiters.push(waiter);
      },
    );
  }

  return Object.freeze({
    waitFor,

    mark:
      () => received.length,

    messagesSince:
      (marker) =>
        received.slice(marker),

    allMessages:
      () => received.slice(),
  });
}

function createCloseObserver(ws) {
  let closed = false;
  let result = null;

  const promise =
    new Promise(
      (resolve) => {
        ws.once(
          'close',
          (
            code,
            reason,
          ) => {
            closed = true;

            result = {
              code,

              reason:
                reason.toString(),
            };

            resolve(result);
          },
        );
      },
    );

  return Object.freeze({
    promise,

    isClosed:
      () => closed,

    getResult:
      () => result,
  });
}

async function waitForObservedClose(
  observer,
  label,
) {
  if (observer.isClosed()) {
    return observer.getResult();
  }

  let timeoutId = null;

  try {
    return await Promise.race([
      observer.promise,

      new Promise(
        (
          _resolve,
          reject,
        ) => {
          timeoutId =
            setTimeout(
              () => {
                reject(
                  new Error(
                    `${label} close timeout`,
                  ),
                );
              },
              MESSAGE_TIMEOUT_MS,
            );
        },
      ),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

async function closeSocket(
  ws,
  reason = 'live test cleanup',
) {
  if (
    !ws ||
    ws.readyState ===
      WebSocket.CLOSED
  ) {
    return;
  }

  if (
    ws.readyState ===
    WebSocket.CLOSING
  ) {
    await new Promise(
      (resolve) => {
        ws.once(
          'close',
          resolve,
        );
      },
    );

    return;
  }

  await new Promise(
    (resolve) => {
      const timeout =
        setTimeout(
          () => {
            try {
              ws.terminate();
            } finally {
              resolve();
            }
          },
          2_000,
        );

      ws.once(
        'close',
        () => {
          clearTimeout(timeout);
          resolve();
        },
      );

      ws.close(
        1000,
        reason,
      );
    },
  );
}

async function waitForCondition(
  check,
  description,
  timeoutMs = REDIS_STATE_TIMEOUT_MS,
) {
  const deadline =
    Date.now() +
    timeoutMs;

  while (
    Date.now() <= deadline
  ) {
    const result =
      await check();

    if (result) {
      return result;
    }

    await wait(
      REDIS_POLL_MS,
    );
  }

  throw new Error(
    `timed out waiting for ${description}`,
  );
}

async function countPrefixKeys() {
  let cursor = '0';
  let count = 0;

  do {
    const [
      nextCursor,
      keys,
    ] =
      await redis.scan(
        cursor,
        'MATCH',
        `${keyPrefix}:*`,
        'COUNT',
        100,
      );

    cursor =
      nextCursor;

    count +=
      keys.length;
  } while (
    cursor !== '0'
  );

  return count;
}

function assertRoomAssigned(message) {
  assert.equal(
    message?.type,
    'room-assigned',
  );

  assert.equal(
    typeof message.roomId,
    'string',
  );

  assert.equal(
    message.roomId.length > 0,
    true,
  );

  assert.equal(
    typeof message.peerId,
    'string',
  );

  assert.equal(
    message.peerId.length > 0,
    true,
  );

  assert.equal(
    (
      message.role ===
        'impolite' ||
      message.role ===
        'polite'
    ),
    true,
  );

  assert.equal(
    isValidResumeToken(
      message.resumeToken,
    ),
    true,
  );
}

function assertPaired(message) {
  assert.equal(
    message?.type,
    'paired',
  );

  assert.equal(
    typeof message.roomId,
    'string',
  );

  assert.equal(
    typeof message.you?.peerId,
    'string',
  );

  assert.equal(
    typeof message.partner?.peerId,
    'string',
  );
}

function hasPartnerLeftFor(
  messages,
  {
    roomId,
    peerId,
  },
) {
  return messages.some(
    (message) =>
      message?.type ===
        'partner-left' &&
      message.roomId ===
        roomId &&
      message.peerId ===
        peerId,
  );
}

async function assertRoomStillExists({
  roomId,
  peerA,
  peerB,
}) {
  const roomKey =
    makeRoomKey(
      keyPrefix,
      roomId,
    );

  const peerARoomKey =
    makePeerRoomKey(
      keyPrefix,
      peerA,
    );

  const peerBRoomKey =
    makePeerRoomKey(
      keyPrefix,
      peerB,
    );

  assert.equal(
    await redis.get(
      peerARoomKey,
    ),
    roomId,
  );

  assert.equal(
    await redis.get(
      peerBRoomKey,
    ),
    roomId,
  );

  const [
    impolite,
    polite,
  ] =
    await redis.hmget(
      roomKey,
      'impolite',
      'polite',
    );

  assert.equal(
    (
      impolite === peerA ||
      polite === peerA
    ),
    true,
  );

  assert.equal(
    (
      impolite === peerB ||
      polite === peerB
    ),
    true,
  );
}

async function awaitResumeOutcome(
  candidate,
) {
  const result =
    await candidate
      .inbox
      .waitFor(
        (message) =>
          (
            message?.type ===
              'room-assigned' ||
            message?.type ===
              'resume-rejected'
          ),
        'resume outcome',
      );

  if (
    result.type ===
    'resume-rejected'
  ) {
    assert.equal(
      result.reason,
      'busy',
    );

    const close =
      await waitForObservedClose(
        candidate.closeObserver,
        candidate.name,
      );

    return {
      status: 'busy',
      candidate,
      rejection: result,
      close,
    };
  }

  assertRoomAssigned(result);

  const paired =
    await candidate
      .inbox
      .waitFor(
        (message) =>
          message?.type ===
          'paired',
        'resumed paired',
      );

  assertPaired(paired);

  return {
    status: 'restored',
    candidate,
    room: result,
    paired,
  };
}

let wsFreshA = null;
let wsPartnerB = null;
let wsCandidateA = null;
let wsCandidateB = null;

try {
  await redis.connect();

  assert.equal(
    await redis.ping(),
    'PONG',
  );

  console.log(
    'PASS: redis connected',
  );

  assert.equal(
    await countPrefixKeys(),
    0,
  );

  console.log(
    'PASS: live redis prefix starts clean',
  );

  wsFreshA =
    new WebSocket(
      URL_A,
    );

  wsPartnerB =
    new WebSocket(
      URL_B,
    );

  const inboxFreshA =
    createInbox(
      wsFreshA,
      'fresh-a',
    );

  const inboxPartnerB =
    createInbox(
      wsPartnerB,
      'partner-b',
    );

  await Promise.all([
    waitForOpen(
      wsFreshA,
      'fresh-a',
    ),

    waitForOpen(
      wsPartnerB,
      'partner-b',
    ),
  ]);

  wsFreshA.send(
    JSON.stringify({
      type: 'join',
    }),
  );

  await wait(200);

  wsPartnerB.send(
    JSON.stringify({
      type: 'join',
    }),
  );

  const [
    roomA,
    pairedA,
    roomB,
    pairedB,
  ] =
    await Promise.all([
      inboxFreshA.waitFor(
        (message) =>
          message?.type ===
          'room-assigned',
        'fresh-a room-assigned',
      ),

      inboxFreshA.waitFor(
        (message) =>
          message?.type ===
          'paired',
        'fresh-a paired',
      ),

      inboxPartnerB.waitFor(
        (message) =>
          message?.type ===
          'room-assigned',
        'partner-b room-assigned',
      ),

      inboxPartnerB.waitFor(
        (message) =>
          message?.type ===
          'paired',
        'partner-b paired',
      ),
    ]);

  assertRoomAssigned(roomA);
  assertRoomAssigned(roomB);
  assertPaired(pairedA);
  assertPaired(pairedB);

  assert.equal(
    roomA.roomId,
    roomB.roomId,
  );

  assert.notEqual(
    roomA.peerId,
    roomB.peerId,
  );

  assert.notEqual(
    roomA.resumeToken,
    roomB.resumeToken,
  );

  console.log(
    'PASS: cross-instance fresh pair created',
  );

  const original = {
    roomId:
      roomA.roomId,

    peerId:
      roomA.peerId,

    role:
      roomA.role,

    resumeToken:
      roomA.resumeToken,
  };

  const partner = {
    peerId:
      roomB.peerId,

    role:
      roomB.role,
  };

  const ownerAOriginal =
    await redis.get(
      makePeerKey(
        keyPrefix,
        original.peerId,
      ),
    );

  const ownerB =
    await redis.get(
      makePeerKey(
        keyPrefix,
        partner.peerId,
      ),
    );

  assert.equal(
    typeof ownerAOriginal,
    'string',
  );

  assert.equal(
    typeof ownerB,
    'string',
  );

  assert.notEqual(
    ownerAOriginal,
    ownerB,
  );

  console.log(
    'PASS: original peers belong to different instances',
  );

  const cleanupKey =
    makeRoomCleanupKey(
      keyPrefix,
    );

  const cleanupRoomKey =
    makeRoomCleanupRoomKey(
      keyPrefix,
    );

  const partnerMarker =
    inboxPartnerB.mark();

  await closeSocket(
    wsFreshA,
    'duplicate resume race disconnect',
  );

  wsFreshA = null;

  console.log(
    'PASS: original peer disconnected',
  );

  const scheduled =
    await waitForCondition(
      async () => {
        const [
          scheduledRoomId,
          score,
        ] =
          await Promise.all([
            redis.hget(
              cleanupRoomKey,
              original.peerId,
            ),

            redis.zscore(
              cleanupKey,
              original.peerId,
            ),
          ]);

        if (
          scheduledRoomId !==
            original.roomId ||
          score === null
        ) {
          return null;
        }

        return {
          dueAtMs:
            Number(score),
        };
      },
      'durable disconnect schedule',
    );

  assert.equal(
    Number.isSafeInteger(
      scheduled.dueAtMs,
    ),
    true,
  );

  assert.equal(
    scheduled.dueAtMs >
      Date.now(),
    true,
  );

  console.log(
    'PASS: disconnect cleanup is durably scheduled',
  );

  wsCandidateA =
    new WebSocket(
      URL_A,
    );

  wsCandidateB =
    new WebSocket(
      URL_B,
    );

  const inboxCandidateA =
    createInbox(
      wsCandidateA,
      'resume-candidate-a',
    );

  const inboxCandidateB =
    createInbox(
      wsCandidateB,
      'resume-candidate-b',
    );

  const closeObserverA =
    createCloseObserver(
      wsCandidateA,
    );

  const closeObserverB =
    createCloseObserver(
      wsCandidateB,
    );

  await Promise.all([
    waitForOpen(
      wsCandidateA,
      'resume-candidate-a',
    ),

    waitForOpen(
      wsCandidateB,
      'resume-candidate-b',
    ),
  ]);

  console.log(
    'PASS: duplicate resume candidates connected to A/B',
  );

  const candidateA = {
    name:
      'resume-candidate-a',

    instanceName:
      'instance-a',

    expectedOwner:
      ownerAOriginal,

    ws:
      wsCandidateA,

    inbox:
      inboxCandidateA,

    closeObserver:
      closeObserverA,
  };

  const candidateB = {
    name:
      'resume-candidate-b',

    instanceName:
      'instance-b',

    expectedOwner:
      ownerB,

    ws:
      wsCandidateB,

    inbox:
      inboxCandidateB,

    closeObserver:
      closeObserverB,
  };

  const joinPayload =
    JSON.stringify({
      type: 'join',

      resumeToken:
        original.resumeToken,
    });

  wsCandidateA.send(
    joinPayload,
  );

  wsCandidateB.send(
    joinPayload,
  );

  const [
    outcomeA,
    outcomeB,
  ] =
    await Promise.all([
      awaitResumeOutcome(
        candidateA,
      ),

      awaitResumeOutcome(
        candidateB,
      ),
    ]);

  const outcomes = [
    outcomeA,
    outcomeB,
  ];

  const restored =
    outcomes.filter(
      (outcome) =>
        outcome.status ===
        'restored',
    );

  const busy =
    outcomes.filter(
      (outcome) =>
        outcome.status ===
        'busy',
    );

  assert.equal(
    restored.length,
    1,
  );

  assert.equal(
    busy.length,
    1,
  );

  console.log(
    'PASS: exactly one duplicate resume candidate won',
  );

  console.log(
    'PASS: exactly one duplicate resume candidate was rejected busy',
  );

  const winner =
    restored[0];

  const loser =
    busy[0];

  assert.equal(
    loser.close.code,
    1013,
  );

  assert.equal(
    winner.candidate
      .ws
      .readyState,
    WebSocket.OPEN,
  );

  assert.equal(
    winner.candidate
      .closeObserver
      .isClosed(),
    false,
  );

  console.log(
    'PASS: winner remains open while loser closes with 1013',
  );

  const loserMessages =
    loser.candidate
      .inbox
      .allMessages();

  assert.equal(
    loserMessages.some(
      (message) =>
        message?.type ===
        'room-assigned',
    ),
    false,
  );

  assert.equal(
    loserMessages.some(
      (message) =>
        message?.type ===
        'paired',
    ),
    false,
  );

  console.log(
    'PASS: losing candidate received no fresh or restored identity',
  );

  assert.equal(
    winner.room.roomId,
    original.roomId,
  );

  assert.equal(
    winner.room.peerId,
    original.peerId,
  );

  assert.equal(
    winner.room.role,
    original.role,
  );

  assert.equal(
    winner.room.resumeToken,
    original.resumeToken,
  );

  assert.equal(
    winner.paired.roomId,
    original.roomId,
  );

  assert.equal(
    winner.paired.you.peerId,
    original.peerId,
  );

  assert.equal(
    winner.paired.you.role,
    original.role,
  );

  assert.equal(
    winner.paired.partner.peerId,
    partner.peerId,
  );

  assert.equal(
    winner.paired.partner.role,
    partner.role,
  );

  console.log(
    'PASS: winning candidate restored exact original identity',
  );

  const ownerAfterRace =
    await waitForCondition(
      async () => {
        const owner =
          await redis.get(
            makePeerKey(
              keyPrefix,
              original.peerId,
            ),
          );

        if (
          owner ===
          winner.candidate
            .expectedOwner
        ) {
          return owner;
        }

        return null;
      },
      'winner presence ownership',
    );

  assert.equal(
    ownerAfterRace,
    winner.candidate
      .expectedOwner,
  );

  console.log(
    `PASS: redis presence belongs to ${winner.candidate.instanceName}`,
  );

  await waitForCondition(
    async () => {
      const [
        cleanupRoom,
        cleanupScore,
      ] =
        await Promise.all([
          redis.hget(
            cleanupRoomKey,
            original.peerId,
          ),

          redis.zscore(
            cleanupKey,
            original.peerId,
          ),
        ]);

      return (
        cleanupRoom === null &&
        cleanupScore === null
      );
    },
    'cleanup cancellation by race winner',
  );

  console.log(
    'PASS: winning restore cancelled disconnect cleanup',
  );

  await assertRoomStillExists({
    roomId:
      original.roomId,

    peerA:
      original.peerId,

    peerB:
      partner.peerId,
  });

  console.log(
    'PASS: room membership survived duplicate resume race',
  );

  const resumeSessionKey =
    makeResumeSessionKey(
      keyPrefix,
      original.resumeToken,
    );

  const resumeClaimKey =
    makeResumeClaimKey(
      keyPrefix,
      original.resumeToken,
    );

  assert.equal(
    await redis.exists(
      resumeSessionKey,
    ),
    1,
  );

  assert.equal(
    await redis.exists(
      resumeClaimKey,
    ),
    1,
  );

  assert.equal(
    (
      await redis.pttl(
        resumeSessionKey,
      )
    ) > 0,
    true,
  );

  assert.equal(
    (
      await redis.pttl(
        resumeClaimKey,
      )
    ) > 0,
    true,
  );

  console.log(
    'PASS: winner retains active resume session and claim',
  );

  assert.equal(
    hasPartnerLeftFor(
      inboxPartnerB.messagesSince(
        partnerMarker,
      ),
      {
        roomId:
          original.roomId,

        peerId:
          original.peerId,
      },
    ),
    false,
  );

  winner.candidate.ws.send(
    JSON.stringify({
      type: 'signal',

      to:
        partner.peerId,

      data: {
        probe:
          'duplicate-resume-race',
      },
    }),
  );

  const routedSignal =
    await inboxPartnerB.waitFor(
      (message) =>
        (
          message?.type ===
            'signal' &&
          message?.from ===
            original.peerId &&
          message?.data?.probe ===
            'duplicate-resume-race'
        ),
      'signal from race winner',
    );

  assert.equal(
    routedSignal.from,
    original.peerId,
  );

  console.log(
    'PASS: race winner can signal original partner',
  );

  const waitPastOriginalDeadlineMs =
    Math.max(
      0,
      scheduled.dueAtMs +
        POST_DEADLINE_MARGIN_MS -
        Date.now(),
    );

  await wait(
    waitPastOriginalDeadlineMs,
  );

  assert.equal(
    winner.candidate
      .ws
      .readyState,
    WebSocket.OPEN,
  );

  assert.equal(
    wsPartnerB.readyState,
    WebSocket.OPEN,
  );

  assert.equal(
    hasPartnerLeftFor(
      inboxPartnerB.messagesSince(
        partnerMarker,
      ),
      {
        roomId:
          original.roomId,

        peerId:
          original.peerId,
      },
    ),
    false,
  );

  await assertRoomStillExists({
    roomId:
      original.roomId,

    peerA:
      original.peerId,

    peerB:
      partner.peerId,
  });

  assert.equal(
    await redis.hget(
      cleanupRoomKey,
      original.peerId,
    ),
    null,
  );

  assert.equal(
    await redis.zscore(
      cleanupKey,
      original.peerId,
    ),
    null,
  );

  console.log(
    'PASS: original disconnect deadline passed without stale cleanup',
  );

  assert.equal(
    await redis.exists(
      resumeSessionKey,
    ),
    1,
  );

  assert.equal(
    await redis.exists(
      resumeClaimKey,
    ),
    1,
  );

  assert.equal(
    (
      await redis.pttl(
        resumeSessionKey,
      )
    ) > 0,
    true,
  );

  assert.equal(
    (
      await redis.pttl(
        resumeClaimKey,
      )
    ) > 0,
    true,
  );

  console.log(
    'PASS: winner leases remain active after original deadline',
  );

  console.log(
    'ALL DUPLICATE RESUME RACE LIVE TESTS PASSED',
  );
} finally {
  await Promise.allSettled([
    closeSocket(
      wsFreshA,
      'duplicate race cleanup',
    ),

    closeSocket(
      wsCandidateA,
      'duplicate race cleanup',
    ),

    closeSocket(
      wsCandidateB,
      'duplicate race cleanup',
    ),

    closeSocket(
      wsPartnerB,
      'duplicate race cleanup',
    ),
  ]);

  redis.disconnect();
}
