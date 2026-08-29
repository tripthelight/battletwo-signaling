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

const expectedRoomTtlMs =
  Number(
    process.env.EXPECTED_ROOM_TTL_MS,
  );

if (
  !Number.isSafeInteger(
    expectedRoomTtlMs,
  ) ||
  expectedRoomTtlMs < 3_000
) {
  throw new Error(
    'EXPECTED_ROOM_TTL_MS must be a safe integer >= 3000',
  );
}

const IMMEDIATE_RESUME_RETRY_DELAY_MS =
  75;

const IMMEDIATE_RESUME_RETRY_WINDOW_MS =
  Math.min(
    3_000,
    Math.floor(
      expectedRoomTtlMs /
        2,
    ),
  );

const POST_RACE_DEADLINE_MARGIN_MS =
  2_000;

const BUSY_CLOSE_TIMEOUT_MS =
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

function createCloseObserver(
  ws,
  label,
) {
  let closeInfo =
    null;

  let resolveClosed;

  const closed =
    new Promise(
      (resolve) => {
        resolveClosed =
          resolve;
      },
    );

  ws.once(
    'close',
    (
      code,
      reason,
    ) => {
      closeInfo = {
        code,

        reason:
          reason.toString(),
      };

      resolveClosed(
        closeInfo,
      );
    },
  );

  async function waitForClose(
    timeoutMs =
      BUSY_CLOSE_TIMEOUT_MS,
  ) {
    if (closeInfo) {
      return closeInfo;
    }

    let timeout;

    const timeoutPromise =
      new Promise(
        (
          _resolve,
          reject,
        ) => {
          timeout =
            setTimeout(
              () => {
                reject(
                  new Error(
                    `${label} close timeout`,
                  ),
                );
              },
              timeoutMs,
            );
        },
      );

    try {
      return await Promise.race([
        closed,
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(
        timeout,
      );
    }
  }

  return Object.freeze({
    waitForClose,

    getCloseInfo:
      () =>
        closeInfo,
  });
}

async function openResumeCandidate(
  url,
  label,
) {
  const ws =
    new WebSocket(
      url,
    );

  const inbox =
    createInbox(
      ws,
      label,
    );

  const closeObserver =
    createCloseObserver(
      ws,
      label,
    );

  await waitForOpen(
    ws,
    label,
  );

  return {
    ws,
    inbox,
    closeObserver,
    label,
  };
}

async function attemptResumeOnCandidate({
  candidate,
  resumeToken,
}) {
  candidate.ws.send(
    JSON.stringify({
      type:
        'join',

      resumeToken,
    }),
  );

  const firstMessage =
    await candidate.inbox.waitFor(
      (message) =>
        (
          message?.type ===
            'room-assigned' ||
          message?.type ===
            'resume-rejected'
        ),
      'resume result',
    );

  if (
    firstMessage.type ===
    'resume-rejected'
  ) {
    assert.equal(
      firstMessage.reason,
      'busy',
      `${candidate.label} unexpected resume rejection`,
    );

    const closeInfo =
      await candidate
        .closeObserver
        .waitForClose();

    assert.equal(
      closeInfo.code,
      1013,
      `${candidate.label} busy rejection must close with 1013`,
    );

    return {
      status:
        'busy',

      candidate,
    };
  }

  assertRoomAssigned(
    firstMessage,
  );

  const paired =
    await candidate.inbox.waitFor(
      (message) =>
        message?.type ===
        'paired',
      'resumed paired',
    );

  assertPaired(
    paired,
  );

  return {
    status:
      'restored',

    candidate,

    room:
      firstMessage,

    paired,
  };
}

async function resumeWithImmediateRetries({
  url,
  resumeToken,
  firstCandidate,
  label,
  onFirstAttemptSent =
    null,
}) {
  const retryDeadline =
    Date.now() +
    IMMEDIATE_RESUME_RETRY_WINDOW_MS;

  let candidate =
    firstCandidate;

  let attempt =
    0;

  let sawBusy =
    false;

  while (true) {
    attempt +=
      1;

    if (
      attempt === 1 &&
      typeof onFirstAttemptSent ===
        'function'
    ) {
      onFirstAttemptSent(
        Date.now(),
      );
    }

    const outcome =
      await attemptResumeOnCandidate({
        candidate,
        resumeToken,
      });

    if (
      outcome.status ===
      'restored'
    ) {
      return {
        ...outcome,

        attemptCount:
          attempt,

        sawBusy,
      };
    }

    sawBusy =
      true;

    if (
      Date.now() >=
      retryDeadline
    ) {
      throw new Error(
        `${label} did not restore within immediate resume retry window`,
      );
    }

    await wait(
      IMMEDIATE_RESUME_RETRY_DELAY_MS,
    );

    candidate =
      await openResumeCandidate(
        url,
        `${label}-retry-${attempt + 1}`,
      );
  }
}

async function assertCleanupCancelled({
  cleanupKey,
  cleanupRoomKey,
  peerId,
}) {
  await waitForCondition(
    async () => {
      const [
        scheduledRoomId,
        score,
      ] =
        await Promise.all([
          redis.hget(
            cleanupRoomKey,
            peerId,
          ),

          redis.zscore(
            cleanupKey,
            peerId,
          ),
        ]);

      return (
        scheduledRoomId ===
          null &&
        score ===
          null
      );
    },
    'disconnect cleanup cancellation after immediate resume',
  );
}

async function assertResumeLeases({
  resumeToken,
}) {
  const resumeSessionKey =
    makeResumeSessionKey(
      keyPrefix,
      resumeToken,
    );

  const resumeClaimKey =
    makeResumeClaimKey(
      keyPrefix,
      resumeToken,
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

  return {
    resumeSessionKey,
    resumeClaimKey,
  };
}

function assertRestoredIdentity({
  room,
  paired,
  originalIdentity,
  partnerIdentity,
}) {
  assert.equal(
    room.roomId,
    originalIdentity.roomId,
  );

  assert.equal(
    room.peerId,
    originalIdentity.peerId,
  );

  assert.equal(
    room.role,
    originalIdentity.role,
  );

  assert.equal(
    room.resumeToken,
    originalIdentity.resumeToken,
  );

  assert.equal(
    paired.roomId,
    originalIdentity.roomId,
  );

  assert.equal(
    paired.you.peerId,
    originalIdentity.peerId,
  );

  assert.equal(
    paired.you.role,
    originalIdentity.role,
  );

  assert.equal(
    paired.partner.peerId,
    partnerIdentity.peerId,
  );

  assert.equal(
    paired.partner.role,
    partnerIdentity.role,
  );
}

function assertNoPartnerLeft({
  inbox,
  marker,
  roomId,
  peerId,
}) {
  assert.equal(
    hasPartnerLeftFor(
      inbox.messagesSince(
        marker,
      ),
      {
        roomId,
        peerId,
      },
    ),
    false,
  );
}

async function sendSignalProbe({
  sender,
  receiverInbox,
  fromPeerId,
  toPeerId,
  probe,
}) {
  sender.send(
    JSON.stringify({
      type:
        'signal',

      to:
        toPeerId,

      data: {
        probe,
      },
    }),
  );

  const routedSignal =
    await receiverInbox.waitFor(
      (message) =>
        (
          message?.type ===
            'signal' &&
          message?.from ===
            fromPeerId &&
          message?.data?.probe ===
            probe
        ),
      `signal probe ${probe}`,
    );

  assert.equal(
    routedSignal.from,
    fromPeerId,
  );
}

let wsA =
  null;

let wsB =
  null;

let wsAResumed =
  null;

let wsAResumedAgain =
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
   * 단 한 번이라도 오는지 두 race가 끝날 때까지 추적한다.
   */
  const bDisconnectMarker =
    inboxB.mark();

  /*
   * ------------------------------------------------------------
   * RACE 1
   * old A는 signaling instance A에 있고,
   * immediate resume candidate는 signaling instance B에 미리
   * WebSocket 연결만 열어 둔다.
   *
   * 그 다음 old A의 close를 시작하고, close 완료를 기다리지
   * 않은 채 같은 event turn에서 resume join을 보낸다.
   *
   * old cleanup이 먼저 claim을 잡고 있으면 일시적으로 busy가
   * 나올 수 있다. busy는 정상적인 transient result이므로
   * bounded retry 후 정확한 identity로 복구되어야 한다.
   * ------------------------------------------------------------
   */
  const crossFirstCandidate =
    await openResumeCandidate(
      URL_B,
      'cross-immediate-resume-1',
    );

  let crossOldCloseFinished =
    false;

  let crossOldCloseCompletedAtMs =
    null;

  let crossFirstResumeSentAtMs =
    null;

  const crossDisconnectStartedAtMs =
    Date.now();

  const crossOldClosePromise =
    closeSocket(
      wsA,
      'cross immediate resume race disconnect',
    ).finally(
      () => {
        crossOldCloseFinished =
          true;

        crossOldCloseCompletedAtMs =
          Date.now();
      },
    );

  const crossResumePromise =
    resumeWithImmediateRetries({
      url:
        URL_B,

      resumeToken:
        originalIdentity.resumeToken,

      firstCandidate:
        crossFirstCandidate,

      label:
        'cross-immediate-resume',

      onFirstAttemptSent:
        (sentAtMs) => {
          crossFirstResumeSentAtMs =
            sentAtMs;
        },
    });

  assert.equal(
    Number.isSafeInteger(
      crossFirstResumeSentAtMs,
    ),
    true,
  );

  assert.equal(
    crossFirstResumeSentAtMs >=
      crossDisconnectStartedAtMs,
    true,
  );

  assert.equal(
    crossOldCloseFinished,
    false,
    'first cross-instance resume must be sent before old close completes',
  );

  console.log(
    'PASS: cross-instance resume request was sent before old socket close completed',
  );

  const crossResume =
    await crossResumePromise;

  await crossOldClosePromise;

  assert.equal(
    Number.isSafeInteger(
      crossOldCloseCompletedAtMs,
    ),
    true,
  );

  wsA =
    null;

  wsAResumed =
    crossResume.candidate.ws;

  const inboxAResumed =
    crossResume.candidate.inbox;

  assertRestoredIdentity({
    room:
      crossResume.room,

    paired:
      crossResume.paired,

    originalIdentity,

    partnerIdentity:
      peerBIdentity,
  });

  console.log(
    `PASS: immediate cross-instance resume restored identity after ${crossResume.attemptCount} attempt(s)`,
  );

  if (
    crossResume.sawBusy
  ) {
    console.log(
      'PASS: transient cross-instance busy result was safely retried',
    );
  }

  await assertCleanupCancelled({
    cleanupKey,
    cleanupRoomKey,

    peerId:
      originalIdentity.peerId,
  });

  console.log(
    'PASS: cross-instance immediate resume left no stale cleanup reservation',
  );

  const ownerAAfterCrossResume =
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
      'cross-instance presence takeover',
    );

  assert.equal(
    ownerAAfterCrossResume,
    ownerBBefore,
  );

  assert.notEqual(
    ownerAAfterCrossResume,
    ownerABefore,
  );

  console.log(
    'PASS: cross-instance immediate resume moved presence ownership to instance B',
  );

  await assertRoomStillExists({
    roomId:
      originalIdentity.roomId,

    peerA:
      originalIdentity.peerId,

    peerB:
      peerBIdentity.peerId,
  });

  await assertResumeLeases({
    resumeToken:
      originalIdentity.resumeToken,
  });

  assertNoPartnerLeft({
    inbox:
      inboxB,

    marker:
      bDisconnectMarker,

    roomId:
      originalIdentity.roomId,

    peerId:
      originalIdentity.peerId,
  });

  await sendSignalProbe({
    sender:
      wsAResumed,

    receiverInbox:
      inboxB,

    fromPeerId:
      originalIdentity.peerId,

    toPeerId:
      peerBIdentity.peerId,

    probe:
      'immediate-cross-instance',
  });

  console.log(
    'PASS: cross-instance resumed peer can signal its original partner',
  );

  /*
   * ------------------------------------------------------------
   * RACE 2
   * 이제 old resumed A와 partner B 모두 signaling instance B에
   * 있다.
   *
   * 같은 instance B에 두 번째 resume candidate를 미리 열고,
   * old resumed A close와 resume join을 다시 겹친다.
   *
   * 이 경우 presence owner 문자열은 old/new connection이
   * 동일한 instance ID이므로 cross-instance owner fencing만으로
   * 문제를 숨길 수 없다.
   *
   * local peer / claim cleanup 순서와 atomic restore cancellation이
   * 실제 same-instance race에서도 안전해야 한다.
   * ------------------------------------------------------------
   */
  const sameFirstCandidate =
    await openResumeCandidate(
      URL_B,
      'same-immediate-resume-1',
    );

  let sameOldCloseFinished =
    false;

  let sameOldCloseCompletedAtMs =
    null;

  let sameFirstResumeSentAtMs =
    null;

  const sameDisconnectStartedAtMs =
    Date.now();

  const sameOldClosePromise =
    closeSocket(
      wsAResumed,
      'same instance immediate resume race disconnect',
    ).finally(
      () => {
        sameOldCloseFinished =
          true;

        sameOldCloseCompletedAtMs =
          Date.now();
      },
    );

  const sameResumePromise =
    resumeWithImmediateRetries({
      url:
        URL_B,

      resumeToken:
        originalIdentity.resumeToken,

      firstCandidate:
        sameFirstCandidate,

      label:
        'same-immediate-resume',

      onFirstAttemptSent:
        (sentAtMs) => {
          sameFirstResumeSentAtMs =
            sentAtMs;
        },
    });

  assert.equal(
    Number.isSafeInteger(
      sameFirstResumeSentAtMs,
    ),
    true,
  );

  assert.equal(
    sameFirstResumeSentAtMs >=
      sameDisconnectStartedAtMs,
    true,
  );

  assert.equal(
    sameOldCloseFinished,
    false,
    'first same-instance resume must be sent before old close completes',
  );

  console.log(
    'PASS: same-instance resume request was sent before old socket close completed',
  );

  const sameResume =
    await sameResumePromise;

  await sameOldClosePromise;

  assert.equal(
    Number.isSafeInteger(
      sameOldCloseCompletedAtMs,
    ),
    true,
  );

  wsAResumed =
    null;

  wsAResumedAgain =
    sameResume.candidate.ws;

  const inboxAResumedAgain =
    sameResume.candidate.inbox;

  assertRestoredIdentity({
    room:
      sameResume.room,

    paired:
      sameResume.paired,

    originalIdentity,

    partnerIdentity:
      peerBIdentity,
  });

  console.log(
    `PASS: immediate same-instance resume restored identity after ${sameResume.attemptCount} attempt(s)`,
  );

  if (
    sameResume.sawBusy
  ) {
    console.log(
      'PASS: transient same-instance busy result was safely retried',
    );
  }

  await assertCleanupCancelled({
    cleanupKey,
    cleanupRoomKey,

    peerId:
      originalIdentity.peerId,
  });

  console.log(
    'PASS: same-instance immediate resume left no stale cleanup reservation',
  );

  const ownerAAfterSameResume =
    await redis.get(
      makePeerKey(
        keyPrefix,
        originalIdentity.peerId,
      ),
    );

  assert.equal(
    ownerAAfterSameResume,
    ownerBBefore,
  );

  console.log(
    'PASS: same-instance immediate resume preserved current presence ownership',
  );

  await assertRoomStillExists({
    roomId:
      originalIdentity.roomId,

    peerA:
      originalIdentity.peerId,

    peerB:
      peerBIdentity.peerId,
  });

  const {
    resumeSessionKey,
    resumeClaimKey,
  } =
    await assertResumeLeases({
      resumeToken:
        originalIdentity.resumeToken,
    });

  assertNoPartnerLeft({
    inbox:
      inboxB,

    marker:
      bDisconnectMarker,

    roomId:
      originalIdentity.roomId,

    peerId:
      originalIdentity.peerId,
  });

  await sendSignalProbe({
    sender:
      wsAResumedAgain,

    receiverInbox:
      inboxB,

    fromPeerId:
      originalIdentity.peerId,

    toPeerId:
      peerBIdentity.peerId,

    probe:
      'immediate-same-instance',
  });

  console.log(
    'PASS: same-instance resumed peer can signal its original partner',
  );

  /*
   * 두 race 중 더 늦게 시작된 same-instance disconnect의
   * ROOM_TTL_MS deadline + margin을 넘긴다.
   *
   * 이 시점은 첫 번째 cross-instance disconnect deadline도
   * 반드시 지난 뒤이다.
   *
   * stale old cleanup이 남아 있다면 room 삭제 또는
   * partner-left가 여기서 드러나야 한다.
   */
  const latestOldCloseCompletedAtMs =
    Math.max(
      crossOldCloseCompletedAtMs,
      sameOldCloseCompletedAtMs,
    );

  const finalDeadlineWaitMs =
    Math.max(
      0,
      (
        latestOldCloseCompletedAtMs +
        expectedRoomTtlMs +
        POST_RACE_DEADLINE_MARGIN_MS
      ) -
      Date.now(),
    );

  await wait(
    finalDeadlineWaitMs,
  );

  assert.equal(
    wsB.readyState,
    WebSocket.OPEN,
  );

  assert.equal(
    wsAResumedAgain.readyState,
    WebSocket.OPEN,
  );

  assertNoPartnerLeft({
    inbox:
      inboxB,

    marker:
      bDisconnectMarker,

    roomId:
      originalIdentity.roomId,

    peerId:
      originalIdentity.peerId,
  });

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

  assert.equal(
    await redis.get(
      makePeerKey(
        keyPrefix,
        originalIdentity.peerId,
      ),
    ),
    ownerBBefore,
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
    'PASS: both original cleanup deadlines passed without stale teardown',
  );

  await sendSignalProbe({
    sender:
      wsAResumedAgain,

    receiverInbox:
      inboxB,

    fromPeerId:
      originalIdentity.peerId,

    toPeerId:
      peerBIdentity.peerId,

    probe:
      'post-immediate-race-deadline',
  });

  console.log(
    'PASS: signaling still works after both stale-cleanup deadlines',
  );

  console.log(
    'ALL IMMEDIATE RESUME RACE LIVE TESTS PASSED',
  );
} finally {
  await Promise.allSettled([
    closeSocket(
      wsA,
      'immediate resume race live test cleanup',
    ),

    closeSocket(
      wsAResumed,
      'immediate resume race live test cleanup',
    ),

    closeSocket(
      wsAResumedAgain,
      'immediate resume race live test cleanup',
    ),

    closeSocket(
      wsB,
      'immediate resume race live test cleanup',
    ),
  ]);

  redis.disconnect();
}
