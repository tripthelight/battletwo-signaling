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

const PRE_RESUME_GRACE_OBSERVE_MS =
  1_200;

const POST_DEADLINE_MARGIN_MS =
  2_000;

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
    'live test disconnect',
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
      impolite ===
        peerA ||
      polite ===
        peerA
    ),
    true,
  );

  assert.equal(
    (
      impolite ===
        peerB ||
      polite ===
        peerB
    ),
    true,
  );
}

let wsA =
  null;

let wsB =
  null;

let wsAResumed =
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
   * 이전 live test state가 하나라도 남아 있다면
   * 이번 결과를 신뢰할 수 없으므로 자동 삭제하지 않고
   * 즉시 실패한다.
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

  /*
   * Fresh client A -> signaling instance A
   * Fresh client B -> signaling instance B
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

  wsA.send(
    JSON.stringify({
      type:
        'join',
    }),
  );

  /*
   * A를 확실하게 waiting 상태로 만든 뒤
   * B가 다른 instance에서 pair를 완성한다.
   */
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

  assert.notEqual(
    roomA.resumeToken,
    roomB.resumeToken,
  );

  assert.equal(
    pairedA.you.peerId,
    roomA.peerId,
  );

  assert.equal(
    pairedA.you.role,
    roomA.role,
  );

  assert.equal(
    pairedA.partner.peerId,
    roomB.peerId,
  );

  assert.equal(
    pairedB.you.peerId,
    roomB.peerId,
  );

  assert.equal(
    pairedB.you.role,
    roomB.role,
  );

  assert.equal(
    pairedB.partner.peerId,
    roomA.peerId,
  );

  console.log(
    'PASS: cross-instance fresh pair created',
  );

  /*
   * resumeToken 원문은 절대로 로그에 출력하지 않는다.
   */
  const originalIdentity = {
    roomId:
      roomA.roomId,

    peerId:
      roomA.peerId,

    role:
      roomA.role,

    resumeToken:
      roomA.resumeToken,
  };

  const peerBIdentity = {
    roomId:
      roomB.roomId,

    peerId:
      roomB.peerId,

    role:
      roomB.role,
  };

  await assertRoomStillExists({
    roomId:
      originalIdentity.roomId,

    peerA:
      originalIdentity.peerId,

    peerB:
      peerBIdentity.peerId,
  });

  console.log(
    'PASS: redis room membership exists before disconnect',
  );

  /*
   * Fresh A는 instance A,
   * B는 instance B의 presence owner여야 한다.
   */
  const ownerABefore =
    await redis.get(
      makePeerKey(
        keyPrefix,
        originalIdentity.peerId,
      ),
    );

  const ownerBBefore =
    await redis.get(
      makePeerKey(
        keyPrefix,
        peerBIdentity.peerId,
      ),
    );

  assert.equal(
    typeof ownerABefore,
    'string',
  );

  assert.equal(
    typeof ownerBBefore,
    'string',
  );

  assert.notEqual(
    ownerABefore,
    ownerBBefore,
  );

  console.log(
    'PASS: peers initially belong to different instances',
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
   * 이 marker 이후 client B에게 partner-left가
   * 단 한 번이라도 오는지 끝까지 추적한다.
   */
  const bDisconnectMarker =
    inboxB.mark();

  /*
   * client A disconnect.
   */
  await closeSocket(
    wsA,
    'resume live test disconnect',
  );

  wsA =
    null;

  console.log(
    'PASS: client-a disconnected',
  );

  /*
   * 서버 close cleanup이 실제 Redis ZSET/HASH에
   * durable disconnect를 기록할 때까지 기다린다.
   */
  const scheduledState =
    await waitForCondition(
      async () => {
        const [
          scheduledRoomId,
          score,
        ] =
          await Promise.all([
            redis.hget(
              cleanupRoomKey,
              originalIdentity.peerId,
            ),

            redis.zscore(
              cleanupKey,
              originalIdentity.peerId,
            ),
          ]);

        if (
          scheduledRoomId !==
            originalIdentity.roomId ||
          score ===
            null
        ) {
          return null;
        }

        return {
          scheduledRoomId,
          dueAtMs:
            Number(
              score,
            ),
        };
      },
      'durable disconnect schedule',
    );

  assert.equal(
    scheduledState.scheduledRoomId,
    originalIdentity.roomId,
  );

  assert.equal(
    Number.isSafeInteger(
      scheduledState.dueAtMs,
    ),
    true,
  );

  assert.equal(
    scheduledState.dueAtMs >
      Date.now(),
    true,
  );

  console.log(
    'PASS: disconnect cleanup is durably scheduled in redis',
  );

  /*
   * 실제 disconnect 후 잠시 기다린다.
   *
   * 아직 grace deadline 전이므로 B에게
   * partner-left가 오면 안 된다.
   */
  await wait(
    PRE_RESUME_GRACE_OBSERVE_MS,
  );

  assert.equal(
    hasPartnerLeftFor(
      inboxB.messagesSince(
        bDisconnectMarker,
      ),
      {
        roomId:
          originalIdentity.roomId,

        peerId:
          originalIdentity.peerId,
      },
    ),
    false,
  );

  assert.equal(
    wsB.readyState,
    WebSocket.OPEN,
  );

  console.log(
    'PASS: partner-left is suppressed during reconnect grace',
  );

  /*
   * 끊어진 A를 반대편 signaling instance B(5102)로
   * reconnect한다.
   *
   * 즉 이제 B instance 하나가
   * 기존 client B와 resumed client A 둘 다 소유하게 된다.
   */
  wsAResumed =
    new WebSocket(
      URL_B,
    );

  const inboxAResumed =
    createInbox(
      wsAResumed,
      'client-a-resumed',
    );

  await waitForOpen(
    wsAResumed,
    'client-a-resumed',
  );

  wsAResumed.send(
    JSON.stringify({
      type:
        'join',

      resumeToken:
        originalIdentity
          .resumeToken,
    }),
  );

  const [
    resumedRoom,
    resumedPaired,
  ] =
    await Promise.all([
      inboxAResumed.waitFor(
        (message) =>
          message?.type ===
          'room-assigned',
        'resumed room-assigned',
      ),

      inboxAResumed.waitFor(
        (message) =>
          message?.type ===
          'paired',
        'resumed paired',
      ),
    ]);

  assertRoomAssigned(
    resumedRoom,
  );

  assertPaired(
    resumedPaired,
  );

  /*
   * Resume의 핵심 identity invariant.
   */
  assert.equal(
    resumedRoom.roomId,
    originalIdentity.roomId,
  );

  assert.equal(
    resumedRoom.peerId,
    originalIdentity.peerId,
  );

  assert.equal(
    resumedRoom.role,
    originalIdentity.role,
  );

  assert.equal(
    resumedRoom.resumeToken,
    originalIdentity.resumeToken,
  );

  assert.equal(
    resumedPaired.roomId,
    originalIdentity.roomId,
  );

  assert.equal(
    resumedPaired.you.peerId,
    originalIdentity.peerId,
  );

  assert.equal(
    resumedPaired.you.role,
    originalIdentity.role,
  );

  assert.equal(
    resumedPaired.partner.peerId,
    peerBIdentity.peerId,
  );

  assert.equal(
    resumedPaired.partner.role,
    peerBIdentity.role,
  );

  console.log(
    'PASS: same peerId roomId role and token restored',
  );

  /*
   * roomMembership.restore()는 같은 Lua transaction 안에서
   * cleanup ZSET/HASH를 제거해야 한다.
   */
  await waitForCondition(
    async () => {
      const [
        scheduledRoomId,
        score,
      ] =
        await Promise.all([
          redis.hget(
            cleanupRoomKey,
            originalIdentity.peerId,
          ),

          redis.zscore(
            cleanupKey,
            originalIdentity.peerId,
          ),
        ]);

      return (
        scheduledRoomId ===
          null &&
        score ===
          null
      );
    },
    'disconnect cleanup cancellation after resume',
  );

  console.log(
    'PASS: resume atomically cancelled disconnect cleanup',
  );

  /*
   * 실제 Redis presence owner가
   * instance A -> instance B로 바뀌었는지 확인한다.
   *
   * ownerBBefore는 계속 연결되어 있던 client B의
   * signaling instance B ID이므로 이를 기준으로 비교한다.
   */
  const ownerAAfterResume =
    await waitForCondition(
      async () => {
        const owner =
          await redis.get(
            makePeerKey(
              keyPrefix,
              originalIdentity.peerId,
            ),
          );

        if (
          owner ===
          ownerBBefore
        ) {
          return owner;
        }

        return null;
      },
      'presence takeover by signaling instance B',
    );

  assert.equal(
    ownerAAfterResume,
    ownerBBefore,
  );

  assert.notEqual(
    ownerAAfterResume,
    ownerABefore,
  );

  console.log(
    'PASS: redis presence ownership moved from A to B',
  );

  /*
   * room mapping 자체는 그대로 유지되어야 한다.
   */
  await assertRoomStillExists({
    roomId:
      originalIdentity.roomId,

    peerA:
      originalIdentity.peerId,

    peerB:
      peerBIdentity.peerId,
  });

  console.log(
    'PASS: room membership survived cross-instance resume',
  );

  /*
   * Resume session/claim이 실제 Redis에서 살아 있는지도
   * 확인한다.
   *
   * token 자체는 출력하지 않는다.
   */
  const resumeSessionKey =
    makeResumeSessionKey(
      keyPrefix,
      originalIdentity.resumeToken,
    );

  const resumeClaimKey =
    makeResumeClaimKey(
      keyPrefix,
      originalIdentity.resumeToken,
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
    'PASS: resumed session and claim leases are active',
  );

  /*
   * 실제 signaling 기능도 복구됐는지 확인한다.
   *
   * resumed A -> B signal을 보내고,
   * 계속 연결되어 있던 client B가 수신해야 한다.
   */
  wsAResumed.send(
    JSON.stringify({
      type:
        'signal',

      to:
        peerBIdentity.peerId,

      data: {
        probe:
          'resume-live',
      },
    }),
  );

  const routedSignal =
    await inboxB.waitFor(
      (message) =>
        (
          message?.type ===
            'signal' &&
          message?.from ===
            originalIdentity.peerId &&
          message?.data?.probe ===
            'resume-live'
        ),
      'signal from resumed peer',
    );

  assert.equal(
    routedSignal.from,
    originalIdentity.peerId,
  );

  console.log(
    'PASS: resumed peer can signal its original partner',
  );

  /*
   * 아직 지금까지 partner-left가 단 한 번도
   * 전달되지 않았어야 한다.
   */
  assert.equal(
    hasPartnerLeftFor(
      inboxB.messagesSince(
        bDisconnectMarker,
      ),
      {
        roomId:
          originalIdentity.roomId,

        peerId:
          originalIdentity.peerId,
      },
    ),
    false,
  );

  /*
   * 가장 강한 검증:
   *
   * 최초 disconnect cleanup의 원래 dueAtMs를 실제로
   * 넘길 때까지 기다린다.
   *
   * restore가 cleanup 예약을 제대로 취소하지 않았다면
   * 이 시점에 room sweeper가 partner-left를 발생시키고
   * room state를 삭제할 수 있다.
   */
  const postDeadlineWaitMs =
    Math.max(
      0,
      (
        scheduledState.dueAtMs +
        POST_DEADLINE_MARGIN_MS
      ) -
      Date.now(),
    );

  await wait(
    postDeadlineWaitMs,
  );

  assert.equal(
    wsB.readyState,
    WebSocket.OPEN,
  );

  assert.equal(
    wsAResumed.readyState,
    WebSocket.OPEN,
  );

  assert.equal(
    hasPartnerLeftFor(
      inboxB.messagesSince(
        bDisconnectMarker,
      ),
      {
        roomId:
          originalIdentity.roomId,

        peerId:
          originalIdentity.peerId,
      },
    ),
    false,
  );

  /*
   * 원래 disconnect deadline이 지나도
   * room은 그대로 있어야 한다.
   */
  await assertRoomStillExists({
    roomId:
      originalIdentity.roomId,

    peerA:
      originalIdentity.peerId,

    peerB:
      peerBIdentity.peerId,
  });

  assert.equal(
    await redis.hget(
      cleanupRoomKey,
      originalIdentity.peerId,
    ),
    null,
  );

  assert.equal(
    await redis.zscore(
      cleanupKey,
      originalIdentity.peerId,
    ),
    null,
  );

  console.log(
    'PASS: original cleanup deadline passed without partner-left',
  );

  /*
   * claim refresher가 실제로 session/claim lease를
   * 유지했는지도 deadline 이후 다시 확인한다.
   */
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
    'PASS: resume leases remain refreshed after original deadline',
  );

  console.log(
    'ALL CROSS-INSTANCE RESUME LIVE TESTS PASSED',
  );
} finally {
  await Promise.allSettled([
    closeSocket(
      wsA,
      'resume live test cleanup',
    ),

    closeSocket(
      wsAResumed,
      'resume live test cleanup',
    ),

    closeSocket(
      wsB,
      'resume live test cleanup',
    ),
  ]);

  redis.disconnect();
}
