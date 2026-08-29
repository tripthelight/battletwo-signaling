import assert from 'node:assert/strict';

import Redis from 'ioredis';
import WebSocket from 'ws';

import {
  makePeerKey,
} from '../src/server/peerDirectory.js';

import {
  makePeerRoomKey,
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
    (resolve, reject) => {
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
            MESSAGE_TIMEOUT_MS,
          );

        waiters.push(
          waiter,
        );
      },
    );
  }

  return Object.freeze({
    waitFor,
  });
}

async function closeSocket(
  ws,
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
        'live test complete',
      );
    },
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

  assert.equal(
    (
      message.you?.role ===
        'impolite' ||
      message.you?.role ===
        'polite'
    ),
    true,
  );

  assert.equal(
    (
      message.partner?.role ===
        'impolite' ||
      message.partner?.role ===
        'polite'
    ),
    true,
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
   * 이 prefix는 현재 A/B live test 전용이다.
   *
   * 이전 테스트의 찌꺼기가 있다면 결과를 신뢰할 수
   * 없으므로 자동 삭제하지 않고 즉시 실패시킨다.
   */
  const initialKeyCount =
    await countPrefixKeys();

  assert.equal(
    initialKeyCount,
    0,
  );

  console.log(
    'PASS: live redis prefix starts clean',
  );

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
   * A를 먼저 waiting 상태에 넣고,
   * B가 다른 signaling instance에서 pair를 완성한다.
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

  assert.equal(
    roomA.peerId ===
      roomB.peerId,
    false,
  );

  assert.equal(
    roomA.role ===
      roomB.role,
    false,
  );

  assert.equal(
    roomA.resumeToken ===
      roomB.resumeToken,
    false,
  );

  console.log(
    'PASS: cross-instance fresh pair created',
  );

  console.log(
    'PASS: both resume tokens are valid and distinct',
  );

  /*
   * paired 메시지의 양방향 identity가 정확한지 확인한다.
   */
  assert.equal(
    pairedA.roomId,
    roomA.roomId,
  );

  assert.equal(
    pairedB.roomId,
    roomB.roomId,
  );

  assert.equal(
    pairedA.you.peerId,
    roomA.peerId,
  );

  assert.equal(
    pairedB.you.peerId,
    roomB.peerId,
  );

  assert.equal(
    pairedA.you.role,
    roomA.role,
  );

  assert.equal(
    pairedB.you.role,
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

  assert.equal(
    pairedA.partner.role,
    roomB.role,
  );

  assert.equal(
    pairedB.partner.role,
    roomA.role,
  );

  console.log(
    'PASS: paired identities are reciprocal',
  );

  /*
   * 실제 Redis room mapping 검증.
   */
  const peerARoomKey =
    makePeerRoomKey(
      keyPrefix,
      roomA.peerId,
    );

  const peerBRoomKey =
    makePeerRoomKey(
      keyPrefix,
      roomB.peerId,
    );

  const roomKey =
    makeRoomKey(
      keyPrefix,
      roomA.roomId,
    );

  assert.equal(
    await redis.get(
      peerARoomKey,
    ),
    roomA.roomId,
  );

  assert.equal(
    await redis.get(
      peerBRoomKey,
    ),
    roomA.roomId,
  );

  const roomMembers =
    await redis.hmget(
      roomKey,
      'impolite',
      'polite',
    );

  assert.equal(
    roomMembers.includes(
      roomA.peerId,
    ),
    true,
  );

  assert.equal(
    roomMembers.includes(
      roomB.peerId,
    ),
    true,
  );

  console.log(
    'PASS: redis room membership is correct',
  );

  /*
   * A와 B는 서로 다른 signaling process에 연결되어
   * 있으므로 presence owner 역시 서로 달라야 한다.
   */
  const ownerA =
    await redis.get(
      makePeerKey(
        keyPrefix,
        roomA.peerId,
      ),
    );

  const ownerB =
    await redis.get(
      makePeerKey(
        keyPrefix,
        roomB.peerId,
      ),
    );

  assert.equal(
    typeof ownerA,
    'string',
  );

  assert.equal(
    typeof ownerB,
    'string',
  );

  assert.equal(
    ownerA ===
      ownerB,
    false,
  );

  console.log(
    'PASS: peers are owned by different signaling instances',
  );

  /*
   * raw resume token은 의도적으로 출력하지 않는다.
   */
  console.log(
    'ALL FRESH SIGNALING LIVE TESTS PASSED',
  );
} finally {
  await Promise.allSettled([
    closeSocket(
      wsA,
    ),

    closeSocket(
      wsB,
    ),
  ]);

  redis.disconnect();
}
