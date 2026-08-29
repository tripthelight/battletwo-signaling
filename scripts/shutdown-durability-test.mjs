import assert from 'node:assert/strict';
import {
  readFile,
} from 'node:fs/promises';

const CONFIG_URL =
  new URL(
    '../src/server/config.js',
    import.meta.url,
  );

const SIGNALING_SERVER_URL =
  new URL(
    '../src/server/signaling_server.js',
    import.meta.url,
  );

const PEER_ID =
  'peer-shutdown-a';

let passed =
  0;

let failed =
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
    failed +=
      1;

    console.error(
      `FAIL: ${name}`,
    );

    console.error(
      error,
    );
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

function createSocket() {
  return {
    name:
      'shutdown-socket',
  };
}

const source =
  await readFile(
    SIGNALING_SERVER_URL,
    'utf8',
  );

const cleanupSource =
  extractFunction(
    source,
    'async function cleanupConnection(',
    '\nfunction trackConnectionCleanup(',
  );

const shutdownSource =
  extractFunction(
    source,
    'async function shutdown(',
    '\nprocess.on(\n  \'SIGTERM\'',
  );

await test(
  'configuration exposes a bounded shutdown cleanup timeout',
  async () => {
    const configSource =
      await readFile(
        CONFIG_URL,
        'utf8',
      );

    assert.match(
      configSource,
      /shutdownCleanupTimeoutMs/,
      'signaling config must expose shutdownCleanupTimeoutMs',
    );

    assert.match(
      configSource,
      /SHUTDOWN_CLEANUP_TIMEOUT_MS/,
      'signaling config must load SHUTDOWN_CLEANUP_TIMEOUT_MS from the environment',
    );
  },
);

await test(
  'permanent Redis cleanup failure stops retrying when the shutdown retry budget expires',
  async () => {
    const ws =
      createSocket();

    const meta = {
      peerId:
        PEER_ID,

      roomId:
        'room-shutdown-a',
    };

    let cleanupAttempts =
      0;

    let retryWaits =
      0;

    let retryChecks =
      0;

    const localPeers = {
      getMeta(
        socket,
      ) {
        assert.equal(
          socket,
          ws,
        );

        return meta;
      },
    };

    const resumeSocketLifecycle = {
      async cleanup(
        socket,
      ) {
        assert.equal(
          socket,
          ws,
        );

        cleanupAttempts +=
          1;

        throw new Error(
          'redis unavailable',
        );
      },
    };

    function isLegacyConnection() {
      return false;
    }

    function cleanupLegacyRoom() {}

    function shouldRetryConnectionCleanup() {
      retryChecks +=
        1;

      return retryChecks === 1;
    }

    async function waitForConnectionCleanupRetry() {
      retryWaits +=
        1;

      if (retryWaits > 2) {
        throw new Error(
          'probe detected unbounded cleanup retry',
        );
      }
    }

    const disconnectDeadlines =
      new WeakMap();

    const legacyDisconnectConnections =
      new WeakSet();

    const silentConsole = {
      error() {},
    };

    const factory =
      new Function(
        'localPeers',
        'resumeSocketLifecycle',
        'isLegacyConnection',
        'legacyDisconnectConnections',
        'cleanupLegacyRoom',
        'waitForConnectionCleanupRetry',
        'shouldRetryConnectionCleanup',
        'disconnectDeadlines',
        'console',
        `
${cleanupSource}

return cleanupConnection;
        `,
      );

    const cleanupConnection =
      factory(
        localPeers,
        resumeSocketLifecycle,
        isLegacyConnection,
        legacyDisconnectConnections,
        cleanupLegacyRoom,
        waitForConnectionCleanupRetry,
        shouldRetryConnectionCleanup,
        disconnectDeadlines,
        silentConsole,
      );

    let cleanupError =
      null;

    try {
      await cleanupConnection(
        ws,
        null,
      );
    } catch (error) {
      cleanupError =
        error;
    }

    assert.equal(
      cleanupError,
      null,
      'cleanupConnection must return after the shutdown retry budget expires instead of retrying forever',
    );

    assert.equal(
      cleanupAttempts,
      2,
      'one retry is allowed, then shutdown budget exhaustion must stop cleanup retries',
    );

    assert.equal(
      retryWaits,
      1,
      'cleanup must not sleep again after shutdown retry budget exhaustion',
    );

    assert.equal(
      retryChecks,
      2,
      'every failed durable cleanup attempt must consult the shutdown retry budget',
    );
  },
);

await test(
  'shutdown activates the cleanup retry deadline before WebSocket cleanup begins',
  async () => {
    const events =
      [];

    let shuttingDown =
      false;

    function stopPresenceRefresh() {
      events.push(
        'stop-presence',
      );
    }

    function stopRoomCleanupSweep() {
      events.push(
        'stop-room-cleanup',
      );
    }

    function stopRoomReconcileSweep() {
      events.push(
        'stop-room-reconcile',
      );
    }

    function beginConnectionCleanupShutdown() {
      events.push(
        'begin-cleanup-deadline',
      );
    }

    async function cancelAllWaitingPeers() {
      events.push(
        'cancel-waiting',
      );
    }

    async function closeWebSocketServer() {
      events.push(
        'close-wss',
      );
    }

    async function unregisterAllPeers() {
      events.push(
        'unregister-peers',
      );
    }

    const resumeClaimManager = {
      stop() {
        events.push(
          'stop-claims',
        );
      },

      async releaseAll() {
        events.push(
          'release-claims',
        );
      },
    };

    const instanceRelay = {
      async stop() {
        events.push(
          'stop-relay',
        );
      },
    };

    async function closeHttpServer() {
      events.push(
        'close-http',
      );
    }

    async function waitForConnectionCleanups() {
      events.push(
        'wait-cleanups',
      );
    }

    const redis = {
      disconnect() {
        events.push(
          'redis-disconnect',
        );
      },
    };

    const silentConsole = {
      log() {},
      error() {},
    };

    const factory =
      new Function(
        'shuttingDown',
        'console',
        'stopPresenceRefresh',
        'stopRoomCleanupSweep',
        'stopRoomReconcileSweep',
        'beginConnectionCleanupShutdown',
        'cancelAllWaitingPeers',
        'closeWebSocketServer',
        'unregisterAllPeers',
        'resumeClaimManager',
        'instanceRelay',
        'closeHttpServer',
        'waitForConnectionCleanups',
        'redis',
        `
${shutdownSource}

return shutdown;
        `,
      );

    const shutdown =
      factory(
        shuttingDown,
        silentConsole,
        stopPresenceRefresh,
        stopRoomCleanupSweep,
        stopRoomReconcileSweep,
        beginConnectionCleanupShutdown,
        cancelAllWaitingPeers,
        closeWebSocketServer,
        unregisterAllPeers,
        resumeClaimManager,
        instanceRelay,
        closeHttpServer,
        waitForConnectionCleanups,
        redis,
      );

    await shutdown(
      'SIGTERM',
    );

    const beginIndex =
      events.indexOf(
        'begin-cleanup-deadline',
      );

    const closeIndex =
      events.indexOf(
        'close-wss',
      );

    assert.ok(
      beginIndex >= 0,
      'shutdown must activate a finite cleanup retry deadline',
    );

    assert.ok(
      closeIndex > beginIndex,
      'cleanup retry deadline must be active before socket close handlers begin durable cleanup',
    );
  },
);

await test(
  'shutdown stops the orphan reconciliation sweep together with the other timers',
  async () => {
    assert.match(
      shutdownSource,
      /stopRoomReconcileSweep\s*\(\s*\)/,
      'graceful shutdown must stop the room orphan reconciliation timer',
    );
  },
);

console.log(
  `SHUTDOWN DURABILITY TESTS: ${passed} passed, ${failed} failed`,
);

if (failed > 0) {
  throw new Error(
    `SHUTDOWN DURABILITY REGRESSION FAILED: ${failed} test(s)`,
  );
}

console.log(
  `ALL SHUTDOWN DURABILITY TESTS PASSED: ${passed}`,
);
