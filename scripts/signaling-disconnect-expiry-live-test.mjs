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
  isValidResumeToken,
} from '../src/server/resumeToken.js';

const redisUrl =
  process.env.REDIS_URL;

const keyPrefix =
  process.env.REDIS_KEY_PREFIX;

if (
  typeof redisUrl !== 'string' ||
  redisUrl.length === 0
) {
  throw new Error(
    'REDIS_URL is required',
  );
}

if (
  typeof keyPrefix !== 'string' ||
  keyPrefix.length === 0
) {
  throw new Error(
    'REDIS_KEY_PREFIX is required',
  );
}

const URL_A =
  'ws://127.0.0.1:5101';

const URL_B =
  'ws://127.0.0.1:5102';

const MESSAGE_TIMEOUT_MS =
  10_000;

const REDIS_STATE_TIMEOUT_MS =
  5_000;

const REDIS_POLL_MS =
  25;

const POST_NOTIFICATION_OBSERVE_MS =
  1_500;

const expectedRoomTtlMs =
  Number(
    process.env.EXPECTED_ROOM_TTL_MS,
  );

if (
  !Number.isSafeInteger(
    expectedRoomTtlMs,
  ) ||
  expectedRoomTtlMs < 1_000
) {
  throw new Error(
    'EXPECTED_ROOM_TTL_MS must be a safe integer >= 1000',
  );
}

const DISCONNECT_SCHEDULE_LATE_TOLERANCE_MS =
  3_000;

const redis =
  new Redis(
    redisUrl,
    {
      lazyConnect:
        true,

      connectTimeout:
        5_000,

      maxRetriesPerRequest:
        1,

      enableOfflineQueue:
        false,
    },
  );

function wait(
  delayMs,
) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        delayMs,
      );
    },
  );
}

function waitForOpen(
  ws,
  label,
) {
  if (
    ws.readyState ===
    WebSocket.OPEN
  ) {
    return Promise.resolve();
  }

  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const timeout =
        setTimeout(
          () => {
            cleanup();

            reject(
              new Error(
                `${label} open timeout`,
              ),
            );
          },
          MESSAGE_TIMEOUT_MS,
        );

      function cleanup() {
        clearTimeout(
          timeout,
        );

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

      function onError(
        error,
      ) {
        cleanup();

        reject(
          error,
        );
      }

      ws.once(
        'open',
        onOpen,
      );

      ws.once(
        'error',
        onError,
      );
    },
  );
}

function createInbox(
  ws,
  label,
) {
  const buffered =
    [];

  const received =
    [];

  const waiters =
    [];

  function rejectAll(
    error,
  ) {
    const pending =
      waiters.splice(
        0,
        waiters.length,
      );

    for (
      const waiter
      of pending
    ) {
      clearTimeout(
        waiter.timeout,
      );

      waiter.reject(
        error,
      );
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

      received.push(
        message,
      );

      const waiterIndex =
        waiters.findIndex(
          (waiter) =>
            waiter.predicate(
              message,
            ),
        );

      if (
        waiterIndex >=
        0
      ) {
        const [
          waiter,
        ] =
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

      buffered.push(
        message,
      );
    },
  );

  ws.on(
    'error',
    (error) => {
      rejectAll(
        error,
      );
    },
  );

  function waitFor(
    predicate,
    description,
    timeoutMs =
      MESSAGE_TIMEOUT_MS,
  ) {
    const bufferedIndex =
      buffered.findIndex(
        predicate,
      );

    if (
      bufferedIndex >=
      0
    ) {
      const [
        message,
      ] =
        buffered.splice(
          bufferedIndex,
          1,
        );

      return Promise.resolve(
        message,
      );
    }

    return new Promise(
      (
        resolve,
        reject,
      ) => {
        const waiter = {
          predicate,
          resolve,
          reject,
          timeout:
            null,
        };

        waiter.timeout =
          setTimeout(
            () => {
              const index =
                waiters.indexOf(
                  waiter,
                );

              if (
                index >=
                0
              ) {
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

        waiters.push(
          waiter,
        );
      },
    );
  }

  function mark() {
    return received.length;
  }

  function messagesSince(
    marker,
  ) {
    return received.slice(
      marker,
    );
  }

  return Object.freeze({
    waitFor,
    mark,
    messagesSince,
  });
}

async function closeSocket(
  ws,
  reason =
    'live test cleanup',
) {
  if (!ws) {
    return;
  }

  if (
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
          clearTimeout(
            timeout,
          );

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
  timeoutMs =
    REDIS_STATE_TIMEOUT_MS,
) {
  const deadline =
    Date.now() +
    timeoutMs;

  while (
    Date.now() <=
    deadline
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
  let cursor =
    '0';

  let count =
    0;

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

function assertRoomAssigned(
  message,
) {
  assert.equal(
    message?.type,
    'room-assigned',
  );

  assert.equal(
    typeof message.roomId,
    'string',
  );

  assert.equal(
    message.roomId.length >
      0,
    true,
  );

  assert.equal(
    typeof message.peerId,
    'string',
  );

  assert.equal(
    message.peerId.length >
      0,
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

function assertPaired(
  message,
) {
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

function partnerLeftMessages(
  messages,
  {
    roomId,
    peerId,
  },
) {
  return messages.filter(
    (message) =>
      message?.type ===
        'partner-left' &&
      message.roomId ===
        roomId &&
      message.peerId ===
        peerId,
  );
}

let wsA =
  null;

let wsB =
  null;

try {
  await redis.connect();

  assert.equal(
    await redis.ping(),
    'PONG',
  );

  console.log(
    'PASS: redis connected',
  );

  /*
   * 이전 live test state가 남아 있으면
   * 이번 결과를 신뢰할 수 없으므로 즉시 실패한다.
   */
  assert.equal(
    await countPrefixKeys(),
    0,
  );

  console.log(
    'PASS: live redis prefix starts clean',
  );

  /*
   * client A -> signaling instance A
   * client B -> signaling instance B
   */
  wsA =
    new WebSocket(
      URL_A,
    );

  wsB =
    new WebSocket(
      URL_B,
    );

  const inboxA =
    createInbox(
      wsA,
      'client-a',
    );

  const inboxB =
    createInbox(
      wsB,
      'client-b',
    );

  await Promise.all([
    waitForOpen(
      wsA,
      'client-a',
    ),

    waitForOpen(
      wsB,
      'client-b',
    ),
  ]);

  console.log(
    'PASS: clients connected to signaling A/B',
  );

  /*
   * A를 먼저 waiting으로 만든 다음
   * 다른 signaling instance의 B가 pair를 완성한다.
   */
  wsA.send(
    JSON.stringify({
      type:
        'join',
    }),
  );

  await wait(
    200,
  );

  wsB.send(
    JSON.stringify({
      type:
        'join',
    }),
  );

  const [
    roomA,
    pairedA,
    roomB,
    pairedB,
  ] =
    await Promise.all([
      inboxA.waitFor(
        (message) =>
          message?.type ===
          'room-assigned',
        'room-assigned',
      ),

      inboxA.waitFor(
        (message) =>
          message?.type ===
          'paired',
        'paired',
      ),

      inboxB.waitFor(
        (message) =>
          message?.type ===
          'room-assigned',
        'room-assigned',
      ),

      inboxB.waitFor(
        (message) =>
          message?.type ===
          'paired',
        'paired',
      ),
    ]);

  assertRoomAssigned(
    roomA,
  );

  assertRoomAssigned(
    roomB,
  );

  assertPaired(
    pairedA,
  );

  assertPaired(
    pairedB,
  );

  assert.equal(
    roomA.roomId,
    roomB.roomId,
  );

  assert.notEqual(
    roomA.peerId,
    roomB.peerId,
  );

  assert.notEqual(
    roomA.role,
    roomB.role,
  );

  assert.equal(
    pairedA.partner.peerId,
    roomB.peerId,
  );

  assert.equal(
    pairedB.partner.peerId,
    roomA.peerId,
  );

  console.log(
    'PASS: cross-instance fresh pair created',
  );

  const roomId =
    roomA.roomId;

  const peerA =
    roomA.peerId;

  const peerB =
    roomB.peerId;

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

  const peerAPresenceKey =
    makePeerKey(
      keyPrefix,
      peerA,
    );

  const peerBPresenceKey =
    makePeerKey(
      keyPrefix,
      peerB,
    );

  const cleanupKey =
    makeRoomCleanupKey(
      keyPrefix,
    );

  const cleanupRoomKey =
    makeRoomCleanupRoomKey(
      keyPrefix,
    );

  /*
   * Fresh pair 직후 Redis room state 검증.
   */
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

  assert.equal(
    await redis.exists(
      roomKey,
    ),
    1,
  );

  assert.equal(
    await redis.exists(
      peerAPresenceKey,
    ),
    1,
  );

  assert.equal(
    await redis.exists(
      peerBPresenceKey,
    ),
    1,
  );

  console.log(
    'PASS: redis room and presence state exists',
  );

  /*
   * 여기 이후 B가 받은 메시지 중
   * peer A에 대한 partner-left를 정확히 센다.
   */
  const markerB =
    inboxB.mark();

  /*
   * A만 disconnect한다.
   *
   * B는 끝까지 연결 상태를 유지한다.
   */
  const disconnectStartedAtMs =
    Date.now();

  await closeSocket(
    wsA,
    'expiry live test disconnect',
  );

  const disconnectClosedAtMs =
    Date.now();

  wsA =
    null;

  console.log(
    'PASS: client-a disconnected without reconnect',
  );

  /*
   * A의 disconnect가 실제 Redis cleanup queue에
   * 기록될 때까지 기다린다.
   */
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
              peerA,
            ),

            redis.zscore(
              cleanupKey,
              peerA,
            ),
          ]);

        if (
          scheduledRoomId !==
            roomId ||
          score ===
            null
        ) {
          return null;
        }

        return {
          roomId:
            scheduledRoomId,

          dueAtMs:
            Number(
              score,
            ),
        };
      },
      'durable room cleanup schedule',
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

  /*
   * 서버는 disconnect cleanup deadline을 ROOM_TTL_MS로
   * 계산해야 한다.
   *
   * 이 live test를 실행할 때 서버의 ROOM_TTL_MS와 같은 값을
   * EXPECTED_ROOM_TTL_MS로 명시한다.
   *
   * disconnect 시작 이전에 deadline이 계산될 수는 없으므로
   * 최소값은 disconnectStartedAtMs + ROOM_TTL_MS이다.
   *
   * WebSocket close 처리와 서버 scheduling 사이의 작은 지연은
   * 허용하되, RESUME_SESSION_TTL_MS처럼 전혀 다른 TTL을 잘못
   * 사용하는 구현은 통과하지 못하도록 상한을 둔다.
   */
  const minimumExpectedDueAtMs =
    disconnectStartedAtMs +
    expectedRoomTtlMs;

  const maximumExpectedDueAtMs =
    disconnectClosedAtMs +
    expectedRoomTtlMs +
    DISCONNECT_SCHEDULE_LATE_TOLERANCE_MS;

  assert.equal(
    (
      scheduled.dueAtMs >=
        minimumExpectedDueAtMs &&
      scheduled.dueAtMs <=
        maximumExpectedDueAtMs
    ),
    true,
    (
      `disconnect cleanup deadline ${scheduled.dueAtMs} ` +
      `is outside expected ROOM_TTL_MS window ` +
      `${minimumExpectedDueAtMs}..${maximumExpectedDueAtMs}`
    ),
  );

  console.log(
    'PASS: disconnect cleanup deadline follows ROOM_TTL_MS',
  );

  console.log(
    'PASS: disconnect cleanup is durably scheduled',
  );

  /*
   * cleanup deadline 전에 아직 room은 살아 있어야 한다.
   */
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

  assert.equal(
    await redis.exists(
      roomKey,
    ),
    1,
  );

  assert.equal(
    partnerLeftMessages(
      inboxB.messagesSince(
        markerB,
      ),
      {
        roomId,
        peerId:
          peerA,
      },
    ).length,
    0,
  );

  console.log(
    'PASS: room remains intact before grace expiry',
  );

  /*
   * B가 실제 partner-left를 받을 때까지 기다린다.
   *
   * dueAtMs + room cleanup sweep 주기를 고려하여
   * 넉넉한 timeout을 준다.
   */
  const timeUntilDue =
    Math.max(
      0,
      scheduled.dueAtMs -
      Date.now(),
    );

  const partnerLeft =
    await inboxB.waitFor(
      (message) =>
        (
          message?.type ===
            'partner-left' &&
          message.roomId ===
            roomId &&
          message.peerId ===
            peerA
        ),
      'partner-left after grace expiry',
      timeUntilDue +
        5_000,
    );

  assert.deepEqual(
    partnerLeft,
    {
      type:
        'partner-left',

      roomId,

      peerId:
        peerA,
    },
  );

  console.log(
    'PASS: surviving partner received partner-left after grace',
  );

  /*
   * Lua cleanup이 Redis room 전체를 제거했는지 확인한다.
   */
  await waitForCondition(
    async () => {
      const [
        roomExists,
        peerARoom,
        peerBRoom,
        cleanupRoom,
        cleanupScore,
      ] =
        await Promise.all([
          redis.exists(
            roomKey,
          ),

          redis.get(
            peerARoomKey,
          ),

          redis.get(
            peerBRoomKey,
          ),

          redis.hget(
            cleanupRoomKey,
            peerA,
          ),

          redis.zscore(
            cleanupKey,
            peerA,
          ),
        ]);

      return (
        roomExists === 0 &&
        peerARoom === null &&
        peerBRoom === null &&
        cleanupRoom === null &&
        cleanupScore === null
      );
    },
    'expired room redis cleanup',
  );

  console.log(
    'PASS: expired room and peer-room mappings were removed',
  );

  /*
   * 끊어진 peer A의 presence는 없어야 한다.
   *
   * 살아 있는 B의 presence는 계속 존재해야 한다.
   */
  assert.equal(
    await redis.exists(
      peerAPresenceKey,
    ),
    0,
  );

  assert.equal(
    await redis.exists(
      peerBPresenceKey,
    ),
    1,
  );

  assert.equal(
    wsB.readyState,
    WebSocket.OPEN,
  );

  console.log(
    'PASS: disconnected presence removed and survivor remains online',
  );

  /*
   * sweeper 중복 실행이나 stale cleanup 때문에
   * partner-left가 두 번 전달되지 않는지 추가 관찰한다.
   */
  await wait(
    POST_NOTIFICATION_OBSERVE_MS,
  );

  const allPartnerLeft =
    partnerLeftMessages(
      inboxB.messagesSince(
        markerB,
      ),
      {
        roomId,
        peerId:
          peerA,
      },
    );

  assert.equal(
    allPartnerLeft.length,
    1,
  );

  console.log(
    'PASS: partner-left was delivered exactly once',
  );

  /*
   * raw resume token은 출력하지 않는다.
   */
  console.log(
    'ALL DISCONNECT EXPIRY LIVE TESTS PASSED',
  );
} finally {
  await Promise.allSettled([
    closeSocket(
      wsA,
      'expiry live test cleanup',
    ),

    closeSocket(
      wsB,
      'expiry live test cleanup',
    ),
  ]);

  redis.disconnect();
}
