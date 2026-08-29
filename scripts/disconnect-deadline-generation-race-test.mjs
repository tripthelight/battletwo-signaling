import assert from 'node:assert/strict';
import {
  readFile,
} from 'node:fs/promises';

const SIGNALING_SERVER_URL =
  new URL(
    '../src/server/signaling_server.js',
    import.meta.url,
  );

const PEER_ID =
  'peer-a';

const OLD_DEADLINE =
  10_000;

const NEW_DEADLINE =
  20_000;

let passed =
  0;

async function test(
  name,
  fn,
) {
  try {
    await fn();

    passed +=
      1;

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

function extractFunction(
  source,
  startMarker,
  endMarker,
) {
  const start =
    source.indexOf(
      startMarker,
    );

  if (start < 0) {
    throw new Error(
      `${startMarker} was not found in signaling_server.js`,
    );
  }

  const end =
    source.indexOf(
      endMarker,
      start,
    );

  if (end < 0) {
    throw new Error(
      `${endMarker} boundary was not found in signaling_server.js`,
    );
  }

  return source.slice(
    start,
    end,
  );
}

function createDeferred() {
  let resolve;

  const promise =
    new Promise(
      (resolvePromise) => {
        resolve =
          resolvePromise;
      },
    );

  return {
    promise,
    resolve,
  };
}

const source =
  await readFile(
    SIGNALING_SERVER_URL,
    'utf8',
  );

const scheduleSource =
  extractFunction(
    source,
    'async function schedulePeerDisconnect(',
    '\nfunction waitForConnectionCleanupRetry()',
  );

const cleanupSource =
  extractFunction(
    source,
    'async function cleanupConnection(',
    '\nfunction trackConnectionCleanup(',
  );

await test(
  'different socket generations receive independent disconnect deadlines',
  async () => {
    const disconnectDeadlines =
      new WeakMap();

    const legacyDisconnectConnections =
      new WeakSet();

    const scheduled =
      [];

    let deadlineIndex =
      0;

    function makeDisconnectDueAtMs() {
      deadlineIndex +=
        1;

      if (deadlineIndex === 1) {
        return OLD_DEADLINE;
      }

      if (deadlineIndex === 2) {
        return NEW_DEADLINE;
      }

      throw new Error(
        'unexpected deadline allocation',
      );
    }

    const disconnectScheduler = {
      async schedule(
        peerId,
        {
          dueAtMs,
        },
      ) {
        scheduled.push({
          peerId,
          dueAtMs,
        });

        return {
          status:
            'scheduled',

          peerId,

          roomId:
            'room-1',

          dueAtMs,
        };
      },
    };

    const cleanupEntered =
      createDeferred();

    const allowCleanupReturn =
      createDeferred();

    const oldSocket = {
      name:
        'old-socket',
    };

    const newSocket = {
      name:
        'new-socket',
    };

    const socketMeta =
      new Map([
        [
          oldSocket,
          {
            peerId:
              PEER_ID,

            roomId:
              null,
          },
        ],
      ]);

    const localPeers = {
      getMeta(
        socket,
      ) {
        return (
          socketMeta.get(
            socket,
          ) ??
          null
        );
      },
    };

    const resumeSocketLifecycle = {
      async cleanup(
        socket,
      ) {
        assert.equal(
          socket,
          oldSocket,
        );

        cleanupEntered.resolve();

        await allowCleanupReturn.promise;

        socketMeta.delete(
          socket,
        );
      },
    };

    function isLegacyConnection() {
      return false;
    }

    function cleanupLegacyRoom(
      meta,
    ) {
      assert.deepEqual(
        meta,
        {
          peerId:
            PEER_ID,

          roomId:
            null,
        },
      );
    }

    async function waitForConnectionCleanupRetry() {
      throw new Error(
        'cleanup retry must not run',
      );
    }

    const silentConsole = {
      log() {},
      error() {},
    };

    const factory =
      new Function(
        'disconnectDeadlines',
        'legacyDisconnectConnections',
        'makeDisconnectDueAtMs',
        'disconnectScheduler',
        'localPeers',
        'resumeSocketLifecycle',
        'isLegacyConnection',
        'cleanupLegacyRoom',
        'waitForConnectionCleanupRetry',
        'console',
        `
${scheduleSource}

${cleanupSource}

return {
  schedulePeerDisconnect,
  cleanupConnection,
};
        `,
      );

    const {
      schedulePeerDisconnect,
      cleanupConnection,
    } =
      factory(
        disconnectDeadlines,
        legacyDisconnectConnections,
        makeDisconnectDueAtMs,
        disconnectScheduler,
        localPeers,
        resumeSocketLifecycle,
        isLegacyConnection,
        cleanupLegacyRoom,
        waitForConnectionCleanupRetry,
        silentConsole,
      );

    const oldSchedule =
      await schedulePeerDisconnect(
        PEER_ID,
        {
          connection:
            oldSocket,
        },
      );

    assert.equal(
      oldSchedule.dueAtMs,
      OLD_DEADLINE,
    );

    const oldRetrySchedule =
      await schedulePeerDisconnect(
        PEER_ID,
        {
          connection:
            oldSocket,
        },
      );

    assert.equal(
      oldRetrySchedule.dueAtMs,
      OLD_DEADLINE,
      'the same socket generation must preserve its original cleanup deadline across retries',
    );

    const oldCleanupTask =
      cleanupConnection(
        oldSocket,
        null,
      );

    await cleanupEntered.promise;

    const newSchedule =
      await schedulePeerDisconnect(
        PEER_ID,
        {
          connection:
            newSocket,
        },
      );

    assert.equal(
      newSchedule.dueAtMs,
      NEW_DEADLINE,
      'a newer socket generation must not reuse the old generation cleanup deadline',
    );

    assert.deepEqual(
      scheduled.map(
        ({
          dueAtMs,
        }) =>
          dueAtMs,
      ),
      [
        OLD_DEADLINE,
        OLD_DEADLINE,
        NEW_DEADLINE,
      ],
    );

    allowCleanupReturn.resolve();

    await oldCleanupTask;

    assert.equal(
      disconnectDeadlines.has(
        oldSocket,
      ),
      false,
      'old connection deadline must be released when old cleanup finishes',
    );

    assert.equal(
      disconnectDeadlines.get(
        newSocket,
      ),
      NEW_DEADLINE,
      'old cleanup finalization must not delete the newer connection deadline',
    );
  },
);

console.log(
  `ALL DISCONNECT DEADLINE GENERATION RACE TESTS PASSED: ${passed}`,
);
