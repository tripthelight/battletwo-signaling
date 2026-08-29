import assert from 'node:assert/strict';
import {
  randomUUID,
} from 'node:crypto';
import {
  spawn,
} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import {
  fileURLToPath,
} from 'node:url';

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
  makeRoomWatchKey,
} from '../src/server/roomMembership.js';

import {
  isValidResumeToken,
} from '../src/server/resumeToken.js';

const redisUrl =
  process.env.REDIS_URL;

if (
  typeof redisUrl !== 'string' ||
  redisUrl.length === 0
) {
  throw new Error(
    'REDIS_URL is required',
  );
}

if (process.platform === 'win32') {
  throw new Error(
    'this hard-crash live test requires SIGKILL and must run on a Unix-like host',
  );
}

const ROOM_TTL_MS =
  3_000;

const PEER_PRESENCE_TTL_MS =
  5_000;

const PEER_PRESENCE_REFRESH_MS =
  1_000;

const SHUTDOWN_CLEANUP_TIMEOUT_MS =
  2_000;

const MESSAGE_TIMEOUT_MS =
  12_000;

const REDIS_STATE_TIMEOUT_MS =
  12_000;

const REDIS_POLL_MS =
  25;

const SERVER_START_TIMEOUT_MS =
  10_000;

const SERVER_STOP_TIMEOUT_MS =
  5_000;

const POST_NOTIFICATION_OBSERVE_MS =
  1_500;

const TEST_ID =
  randomUUID();

const keyPrefix =
  `battletwo:test:hard-crash-live:${TEST_ID}`;

const scriptPath =
  fileURLToPath(
    import.meta.url,
  );

const repoRoot =
  path.resolve(
    path.dirname(
      scriptPath,
    ),
    '..',
  );

const serverScript =
  path.join(
    repoRoot,
    'src/server/signaling_server.js',
  );

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

async function getFreePort() {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const server =
        net.createServer();

      server.unref();

      server.once(
        'error',
        reject,
      );

      server.listen(
        0,
        '127.0.0.1',
        () => {
          const address =
            server.address();

          if (
            !address ||
            typeof address === 'string'
          ) {
            server.close();

            reject(
              new Error(
                'failed to allocate a test TCP port',
              ),
            );

            return;
          }

          const port =
            address.port;

          server.close(
            (error) => {
              if (error) {
                reject(
                  error,
                );

                return;
              }

              resolve(
                port,
              );
            },
          );
        },
      );
    },
  );
}

function createLogCapture(
  child,
  label,
) {
  const lines =
    [];

  function capture(
    streamName,
    chunk,
  ) {
    const text =
      chunk.toString();

    for (
      const line
      of text.split(/\r?\n/u)
    ) {
      if (line.length === 0) {
        continue;
      }

      lines.push(
        `[${label}:${streamName}] ${line}`,
      );

      if (lines.length > 200) {
        lines.shift();
      }
    }
  }

  child.stdout?.on(
    'data',
    (chunk) => {
      capture(
        'stdout',
        chunk,
      );
    },
  );

  child.stderr?.on(
    'data',
    (chunk) => {
      capture(
        'stderr',
        chunk,
      );
    },
  );

  return Object.freeze({
    dump() {
      return lines.join(
        '\n',
      );
    },
  });
}

function spawnSignalingServer({
  port,
  label,
}) {
  const child =
    spawn(
      process.execPath,
      [
        serverScript,
      ],
      {
        cwd:
          repoRoot,

        env: {
          ...process.env,
          RTC_HOST:
            '127.0.0.1',
          RTC_PORT:
            String(port),
          REDIS_URL:
            redisUrl,
          REDIS_KEY_PREFIX:
            keyPrefix,
          ROOM_TTL_MS:
            String(
              ROOM_TTL_MS,
            ),
          PEER_PRESENCE_TTL_MS:
            String(
              PEER_PRESENCE_TTL_MS,
            ),
          PEER_PRESENCE_REFRESH_MS:
            String(
              PEER_PRESENCE_REFRESH_MS,
            ),
          SHUTDOWN_CLEANUP_TIMEOUT_MS:
            String(
              SHUTDOWN_CLEANUP_TIMEOUT_MS,
            ),
        },
        stdio: [
          'ignore',
          'pipe',
          'pipe',
        ],
      },
    );

  return {
    child,
    logs:
      createLogCapture(
        child,
        label,
      ),
  };
}

async function waitForPort(
  port,
  child,
  label,
) {
  const deadline =
    Date.now() +
    SERVER_START_TIMEOUT_MS;

  while (
    Date.now() <=
    deadline
  ) {
    if (
      child.exitCode !== null ||
      child.signalCode !== null
    ) {
      throw new Error(
        `${label} exited before listening`,
      );
    }

    const opened =
      await new Promise(
        (resolve) => {
          const socket =
            net.createConnection({
              host:
                '127.0.0.1',
              port,
            });

          let settled =
            false;

          function finish(
            value,
          ) {
            if (settled) {
              return;
            }

            settled =
              true;

            socket.destroy();

            resolve(
              value,
            );
          }

          socket.setTimeout(
            250,
          );

          socket.once(
            'connect',
            () => {
              finish(
                true,
              );
            },
          );

          socket.once(
            'timeout',
            () => {
              finish(
                false,
              );
            },
          );

          socket.once(
            'error',
            () => {
              finish(
                false,
              );
            },
          );
        },
      );

    if (opened) {
      return;
    }

    await wait(
      50,
    );
  }

  throw new Error(
    `${label} did not start listening in time`,
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

function waitForClose(
  ws,
  label,
) {
  if (
    ws.readyState ===
    WebSocket.CLOSED
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
                `${label} close timeout`,
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
          'close',
          onClose,
        );
      }

      function onClose() {
        cleanup();

        resolve();
      }

      ws.once(
        'close',
        onClose,
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
    'hard-crash live test cleanup',
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
    await waitForClose(
      ws,
      'cleanup socket',
    ).catch(
      () => {},
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

async function scanPrefixKeys() {
  let cursor =
    '0';

  const keys =
    [];

  do {
    const [
      nextCursor,
      batch,
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

    keys.push(
      ...batch,
    );
  } while (
    cursor !== '0'
  );

  return keys;
}

async function deletePrefixKeys() {
  const keys =
    await scanPrefixKeys();

  if (keys.length > 0) {
    await redis.del(
      ...keys,
    );
  }

  return keys.length;
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

async function waitForChildExit(
  child,
  timeoutMs =
    SERVER_STOP_TIMEOUT_MS,
) {
  if (
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return {
      exitCode:
        child.exitCode,
      signalCode:
        child.signalCode,
    };
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
                `child process ${child.pid} did not exit in time`,
              ),
            );
          },
          timeoutMs,
        );

      function cleanup() {
        clearTimeout(
          timeout,
        );

        child.off(
          'exit',
          onExit,
        );
      }

      function onExit(
        exitCode,
        signalCode,
      ) {
        cleanup();

        resolve({
          exitCode,
          signalCode,
        });
      }

      child.once(
        'exit',
        onExit,
      );
    },
  );
}

async function stopChild(
  child,
) {
  if (!child) {
    return;
  }

  if (
    child.exitCode !== null ||
    child.signalCode !== null
  ) {
    return;
  }

  child.kill(
    'SIGTERM',
  );

  try {
    await waitForChildExit(
      child,
    );
  } catch {
    if (
      child.exitCode === null &&
      child.signalCode === null
    ) {
      child.kill(
        'SIGKILL',
      );
    }

    await waitForChildExit(
      child,
      2_000,
    ).catch(
      () => {},
    );
  }
}

let serverA =
  null;

let serverB =
  null;

let wsA =
  null;

let wsB =
  null;

let mainError =
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

  assert.deepEqual(
    await scanPrefixKeys(),
    [],
  );

  console.log(
    'PASS: isolated hard-crash redis prefix starts clean',
  );

  const portA =
    await getFreePort();

  let portB =
    await getFreePort();

  while (
    portB === portA
  ) {
    portB =
      await getFreePort();
  }

  serverA =
    spawnSignalingServer({
      port:
        portA,
      label:
        'server-a',
    });

  serverB =
    spawnSignalingServer({
      port:
        portB,
      label:
        'server-b',
    });

  await Promise.all([
    waitForPort(
      portA,
      serverA.child,
      'server-a',
    ),

    waitForPort(
      portB,
      serverB.child,
      'server-b',
    ),
  ]);

  console.log(
    `PASS: isolated signaling A/B started on ${portA}/${portB}`,
  );

  wsA =
    new WebSocket(
      `ws://127.0.0.1:${portA}`,
    );

  wsB =
    new WebSocket(
      `ws://127.0.0.1:${portB}`,
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
    'PASS: clients connected to isolated signaling A/B',
  );

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

  const roomWatchKey =
    makeRoomWatchKey(
      keyPrefix,
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

  assert.notEqual(
    await redis.zscore(
      roomWatchKey,
      roomId,
    ),
    null,
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
    'PASS: room, peer mappings, presences, and room-watch exist',
  );

  const markerB =
    inboxB.mark();

  const killedAtMs =
    Date.now();

  assert.equal(
    serverA.child.kill(
      'SIGKILL',
    ),
    true,
  );

  const killed =
    await waitForChildExit(
      serverA.child,
    );

  assert.equal(
    killed.signalCode,
    'SIGKILL',
  );

  await waitForClose(
    wsA,
    'client-a after server SIGKILL',
  );

  wsA =
    null;

  console.log(
    'PASS: signaling A was hard-killed with SIGKILL',
  );

  await wait(
    250,
  );

  assert.equal(
    await redis.hget(
      cleanupRoomKey,
      peerA,
    ),
    null,
  );

  assert.equal(
    await redis.zscore(
      cleanupKey,
      peerA,
    ),
    null,
  );

  console.log(
    'PASS: SIGKILL bypassed normal disconnect cleanup scheduling',
  );

  const initialPresencePttl =
    await redis.pttl(
      peerAPresenceKey,
    );

  assert.equal(
    initialPresencePttl > 0,
    true,
  );

  assert.equal(
    initialPresencePttl <=
      PEER_PRESENCE_TTL_MS,
    true,
  );

  console.log(
    `PASS: dead peer presence remains TTL-bound (${initialPresencePttl}ms observed)`,
  );

  const presenceExpiredAtMs =
    await waitForCondition(
      async () => {
        const [
          peerAExists,
          peerBExists,
        ] =
          await redis
            .multi()
            .exists(
              peerAPresenceKey,
            )
            .exists(
              peerBPresenceKey,
            )
            .exec();

        const aExists =
          Number(
            peerAExists?.[1],
          );

        const bExists =
          Number(
            peerBExists?.[1],
          );

        if (
          aExists === 0 &&
          bExists === 1
        ) {
          return Date.now();
        }

        return null;
      },
      'dead peer presence expiry while survivor presence remains',
      PEER_PRESENCE_TTL_MS +
        5_000,
    );

  assert.equal(
    presenceExpiredAtMs >=
      killedAtMs,
    true,
  );

  console.log(
    'PASS: dead peer presence expired while survivor presence stayed active',
  );

  const scheduled =
    await waitForCondition(
      async () => {
        const [
          roomResult,
          scoreResult,
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
          roomResult !== roomId ||
          scoreResult === null
        ) {
          return null;
        }

        const dueAtMs =
          Number(
            scoreResult,
          );

        if (
          !Number.isSafeInteger(
            dueAtMs,
          )
        ) {
          return null;
        }

        return {
          dueAtMs,
          observedAtMs:
            Date.now(),
        };
      },
      'room-watch orphan reconciliation cleanup reservation',
      5_000,
    );

  assert.equal(
    scheduled.dueAtMs >
      scheduled.observedAtMs,
    true,
  );

  assert.equal(
    scheduled.dueAtMs <=
      scheduled.observedAtMs +
      ROOM_TTL_MS +
      1_500,
    true,
  );

  console.log(
    'PASS: surviving instance reconciler scheduled durable cleanup',
  );

  const beforeDeadlineDelayMs =
    scheduled.dueAtMs -
    Date.now() -
    500;

  if (
    beforeDeadlineDelayMs > 0
  ) {
    await wait(
      beforeDeadlineDelayMs,
    );
  }

  assert.equal(
    await redis.exists(
      roomKey,
    ),
    1,
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
    'PASS: room survives until reconciler cleanup grace expires',
  );

  await inboxB.waitFor(
    (message) =>
      message?.type ===
        'partner-left' &&
      message.roomId ===
        roomId &&
      message.peerId ===
        peerA,
    'partner-left after hard-crash recovery grace',
    ROOM_TTL_MS +
      5_000,
  );

  console.log(
    'PASS: survivor received partner-left after hard-crash recovery grace',
  );

  await waitForCondition(
    async () => {
      const [
        roomExists,
        peerARoom,
        peerBRoom,
        watchScore,
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

          redis.zscore(
            roomWatchKey,
            roomId,
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
        watchScore === null &&
        cleanupRoom === null &&
        cleanupScore === null
      );
    },
    'final hard-crash room cleanup including room-watch',
    5_000,
  );

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
    'PASS: room, peer mappings, cleanup reservation, and room-watch were removed',
  );

  await wait(
    POST_NOTIFICATION_OBSERVE_MS,
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
    1,
  );

  console.log(
    'PASS: partner-left was delivered exactly once',
  );

  console.log(
    'ALL SIGNALING HARD-CRASH LIVE TESTS PASSED',
  );
} catch (error) {
  mainError =
    error;

  console.error(
    'SIGNALING HARD-CRASH LIVE TEST FAILED:',
    error,
  );

  if (serverA?.logs) {
    const logText =
      serverA.logs.dump();

    if (logText.length > 0) {
      console.error(
        '===== SERVER A LOG TAIL =====',
      );

      console.error(
        logText,
      );
    }
  }

  if (serverB?.logs) {
    const logText =
      serverB.logs.dump();

    if (logText.length > 0) {
      console.error(
        '===== SERVER B LOG TAIL =====',
      );

      console.error(
        logText,
      );
    }
  }
} finally {
  await closeSocket(
    wsA,
  ).catch(
    () => {},
  );

  await closeSocket(
    wsB,
  ).catch(
    () => {},
  );

  await stopChild(
    serverA?.child,
  );

  await stopChild(
    serverB?.child,
  );

  if (
    redis.status === 'ready' ||
    redis.status === 'connect'
  ) {
    try {
      await deletePrefixKeys();

      const remaining =
        await scanPrefixKeys();

      if (remaining.length === 0) {
        console.log(
          'PASS: hard-crash test redis namespace removed',
        );
      } else {
        console.error(
          'FAIL: hard-crash test redis namespace still has keys:',
          remaining,
        );

        if (!mainError) {
          mainError =
            new Error(
              'hard-crash test redis namespace cleanup failed',
            );
        }
      }
    } catch (error) {
      console.error(
        'FAIL: hard-crash test redis cleanup failed:',
        error,
      );

      if (!mainError) {
        mainError =
          error;
      }
    }
  }

  redis.disconnect();
}

if (mainError) {
  throw mainError;
}
