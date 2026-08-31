import assert from 'node:assert/strict';
import {
  randomUUID,
} from 'node:crypto';
import {
  spawn,
} from 'node:child_process';

import Redis from 'ioredis';
import WebSocket from 'ws';

const REDIS_URL =
  process.env.REDIS_URL ||
  'redis://127.0.0.1:6380';

const RTC_HOST =
  '127.0.0.1';

const RTC_PORT =
  5091;

const REDIS_KEY_PREFIX =
  `battletwo:test:storage-bootstrap:${randomUUID()}`;

const SIGNALING_URL =
  `ws://${RTC_HOST}:${RTC_PORT}`;

const redis =
  new Redis(
    REDIS_URL,
    {
      maxRetriesPerRequest:
        1,
    },
  );

let serverProcess =
  null;

const sockets =
  new Set();

function delay(ms) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        ms,
      );
    },
  );
}

async function cleanupRedis() {
  const keys = [];

  let cursor =
    '0';

  do {
    const [
      nextCursor,
      found,
    ] =
      await redis.scan(
        cursor,
        'MATCH',
        `${REDIS_KEY_PREFIX}:*`,
        'COUNT',
        100,
      );

    cursor =
      nextCursor;

    keys.push(
      ...found,
    );
  } while (
    cursor !==
    '0'
  );

  if (
    keys.length >
    0
  ) {
    await redis.del(
      ...keys,
    );
  }
}

function createInbox(
  ws,
  label,
) {
  const queue = [];

  const waiters = [];

  ws.on(
    'message',
    (buffer) => {
      let msg;

      try {
        msg =
          JSON.parse(
            buffer.toString(),
          );
      } catch {
        return;
      }

      console.log(
        `${label} <=`,
        msg.type,
      );

      const waiterIndex =
        waiters.findIndex(
          (waiter) =>
            waiter.predicate(
              msg,
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
          waiter.timeoutId,
        );

        waiter.resolve(
          msg,
        );

        return;
      }

      queue.push(
        msg,
      );
    },
  );

  function waitFor(
    predicate,
    timeoutMs = 5_000,
  ) {
    const existingIndex =
      queue.findIndex(
        predicate,
      );

    if (
      existingIndex >=
      0
    ) {
      const [
        msg,
      ] =
        queue.splice(
          existingIndex,
          1,
        );

      return Promise.resolve(
        msg,
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
          timeoutId:
            null,
        };

        waiter.timeoutId =
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
                  `${label} timed out waiting for WebSocket message`,
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

  return {
    waitFor,
  };
}

function waitForOpen(
  ws,
  label,
) {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const timeoutId =
        setTimeout(
          () => {
            reject(
              new Error(
                `${label} WebSocket open timeout`,
              ),
            );
          },
          5_000,
        );

      ws.once(
        'open',
        () => {
          clearTimeout(
            timeoutId,
          );

          resolve();
        },
      );

      ws.once(
        'error',
        (error) => {
          clearTimeout(
            timeoutId,
          );

          reject(
            error,
          );
        },
      );
    },
  );
}

async function connectClient(
  label,
) {
  const ws =
    new WebSocket(
      SIGNALING_URL,
    );

  sockets.add(
    ws,
  );

  const inbox =
    createInbox(
      ws,
      label,
    );

  await waitForOpen(
    ws,
    label,
  );

  console.log(
    `${label} connected`,
  );

  return {
    ws,
    inbox,
  };
}

function sendJson(
  ws,
  obj,
) {
  ws.send(
    JSON.stringify(
      obj,
    ),
  );
}

function startServer() {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      const child =
        spawn(
          process.execPath,
          [
            'src/server/signaling_server.js',
          ],
          {
            cwd:
              process.cwd(),

            env: {
              ...process.env,

              RTC_HOST,

              RTC_PORT:
                String(
                  RTC_PORT,
                ),

              REDIS_URL,

              REDIS_KEY_PREFIX,

              ROOM_TTL_MS:
                '5000',

              RESUME_SESSION_TTL_MS:
                '5000',

              RESUME_CLAIM_TTL_MS:
                '2000',

              RESUME_CLAIM_REFRESH_MS:
                '1000',
            },

            stdio: [
              'ignore',
              'pipe',
              'pipe',
            ],
          },
        );

      serverProcess =
        child;

      let settled =
        false;

      const timeoutId =
        setTimeout(
          () => {
            if (
              settled
            ) {
              return;
            }

            settled =
              true;

            reject(
              new Error(
                'signaling server startup timeout',
              ),
            );
          },
          10_000,
        );

      child.stdout.on(
        'data',
        (chunk) => {
          const text =
            chunk.toString();

          process.stdout.write(
            `[SERVER] ${text}`,
          );

          if (
            !settled &&
            text.includes(
              'Server is running on',
            )
          ) {
            settled =
              true;

            clearTimeout(
              timeoutId,
            );

            resolve(
              child,
            );
          }
        },
      );

      child.stderr.on(
        'data',
        (chunk) => {
          process.stderr.write(
            `[SERVER ERROR] ${chunk.toString()}`,
          );
        },
      );

      child.once(
        'exit',
        (
          code,
          signal,
        ) => {
          if (
            settled
          ) {
            return;
          }

          settled =
            true;

          clearTimeout(
            timeoutId,
          );

          reject(
            new Error(
              `signaling server exited during startup: code=${code}, signal=${signal}`,
            ),
          );
        },
      );
    },
  );
}

async function stopServer() {
  if (
    !serverProcess ||
    serverProcess.exitCode !==
      null
  ) {
    return;
  }

  const child =
    serverProcess;

  await new Promise(
    (resolve) => {
      let resolved =
        false;

      const finish =
        () => {
          if (
            resolved
          ) {
            return;
          }

          resolved =
            true;

          resolve();
        };

      child.once(
        'exit',
        finish,
      );

      child.kill(
        'SIGTERM',
      );

      setTimeout(
        () => {
          if (
            child.exitCode ===
              null
          ) {
            child.kill(
              'SIGKILL',
            );
          }

          finish();
        },
        5_000,
      );
    },
  );
}

async function closeSockets() {
  const pending = [];

  for (
    const ws
    of sockets
  ) {
    if (
      ws.readyState ===
        WebSocket.CLOSED
    ) {
      continue;
    }

    pending.push(
      new Promise(
        (resolve) => {
          const timeoutId =
            setTimeout(
              resolve,
              1_000,
            );

          ws.once(
            'close',
            () => {
              clearTimeout(
                timeoutId,
              );

              resolve();
            },
          );

          try {
            ws.close(
              1000,
              'test complete',
            );
          } catch {
            clearTimeout(
              timeoutId,
            );

            resolve();
          }
        },
      ),
    );
  }

  await Promise.allSettled(
    pending,
  );

  sockets.clear();
}

try {
  await cleanupRedis();

  await startServer();

  console.log(
    'SERVER_READY:',
    SIGNALING_URL,
  );

  const clientA =
    await connectClient(
      'CLIENT_A',
    );

  const clientB =
    await connectClient(
      'CLIENT_B',
    );

  sendJson(
    clientA.ws,
    {
      type:
        'join',

      roomHint:
        null,
    },
  );

  sendJson(
    clientB.ws,
    {
      type:
        'join',

      roomHint:
        null,
    },
  );

  const [
    assignedA,
    assignedB,
    pairedA,
    pairedB,
  ] =
    await Promise.all([
      clientA.inbox.waitFor(
        (msg) =>
          msg.type ===
          'room-assigned',
      ),

      clientB.inbox.waitFor(
        (msg) =>
          msg.type ===
          'room-assigned',
      ),

      clientA.inbox.waitFor(
        (msg) =>
          msg.type ===
          'paired',
      ),

      clientB.inbox.waitFor(
        (msg) =>
          msg.type ===
          'paired',
      ),
    ]);

  assert.ok(
    assignedA.roomId,
  );

  assert.equal(
    assignedA.roomId,
    assignedB.roomId,
  );

  assert.equal(
    pairedA.roomId,
    assignedA.roomId,
  );

  assert.equal(
    pairedB.roomId,
    assignedA.roomId,
  );

  assert.ok(
    assignedA.roomId.length >
      10,
  );

  const roles =
    new Set([
      assignedA.role,
      assignedB.role,
    ]);

  assert.deepEqual(
    roles,
    new Set([
      'impolite',
      'polite',
    ]),
  );

  console.log(
    'ROOM_ID:',
    assignedA.roomId,
  );

  console.log(
    'ROOM_ID_LENGTH:',
    assignedA.roomId.length,
  );

  console.log(
    'CLIENT_A_ROLE:',
    assignedA.role,
  );

  console.log(
    'CLIENT_B_ROLE:',
    assignedB.role,
  );

  sendJson(
    clientA.ws,
    {
      type:
        'requestStorage',

      gameName:
        'indianPocker',

      initRole:
        assignedA.role,
    },
  );

  sendJson(
    clientB.ws,
    {
      type:
        'requestStorage',

      gameName:
        'indianPocker',

      initRole:
        assignedB.role,
    },
  );

  const [
    storageA,
    storageB,
  ] =
    await Promise.all([
      clientA.inbox.waitFor(
        (msg) =>
          msg.type ===
          'responseStorage',
      ),

      clientB.inbox.waitFor(
        (msg) =>
          msg.type ===
          'responseStorage',
      ),
    ]);

  assert.ok(
    storageA.storageData &&
    typeof storageA.storageData ===
      'object',
  );

  assert.ok(
    storageB.storageData &&
    typeof storageB.storageData ===
      'object',
  );

  assert.ok(
    storageA.storageData.storageData &&
    typeof storageA.storageData.storageData ===
      'object',
  );

  assert.ok(
    storageB.storageData.storageData &&
    typeof storageB.storageData.storageData ===
      'object',
  );

  assert.ok(
    typeof storageA.keypair?.puk ===
      'string' &&
    storageA.keypair.puk.length >
      0,
  );

  assert.ok(
    typeof storageB.keypair?.puk ===
      'string' &&
    storageB.keypair.puk.length >
      0,
  );

  assert.ok(
    typeof storageA.keypair?.prk ===
      'string' &&
    storageA.keypair.prk.length >
      0,
  );

  assert.ok(
    typeof storageB.keypair?.prk ===
      'string' &&
    storageB.keypair.prk.length >
      0,
  );

  assert.equal(
    storageA.keypair.puk,
    storageB.keypair.puk,
  );

  assert.notEqual(
    storageA.keypair.prk,
    storageB.keypair.prk,
  );

  console.log(
    'INDIAN_POCKER_STORAGE_A:',
    'OK',
  );

  console.log(
    'INDIAN_POCKER_STORAGE_B:',
    'OK',
  );

  console.log(
    'PUBLIC_KEY_MATCH:',
    true,
  );

  console.log(
    'PRIVATE_KEYS_DIFFER:',
    true,
  );

  sendJson(
    clientA.ws,
    {
      type:
        'requestStorage',

      gameName:
        'blackAndWhite1',

      initRole:
        assignedA.role,
    },
  );

  const blackAndWhiteStorage =
    await clientA.inbox.waitFor(
      (msg) =>
        msg.type ===
        'responseStorage',
    );

  assert.ok(
    blackAndWhiteStorage
      .storageData
      ?.storageData &&
    typeof blackAndWhiteStorage
      .storageData
      .storageData ===
      'object',
  );

  console.log(
    'BLACK_AND_WHITE_STORAGE:',
    'OK',
  );

  sendJson(
    clientA.ws,
    {
      type:
        'requestStorage',

      gameName:
        'findTheSamePicture',

      initRole:
        assignedA.role,
    },
  );

  const unavailable =
    await clientA.inbox.waitFor(
      (msg) =>
        msg.type ===
        'storage-unavailable',
    );

  assert.equal(
    unavailable.gameName,
    'findTheSamePicture',
  );

  console.log(
    'UNSUPPORTED_GAME_RESPONSE:',
    unavailable.type,
  );

  console.log(
    'ALL STORAGE BOOTSTRAP TESTS PASSED',
  );
} finally {
  await closeSockets();

  await stopServer();

  await delay(
    100,
  );

  await cleanupRedis();

  redis.disconnect();
}
