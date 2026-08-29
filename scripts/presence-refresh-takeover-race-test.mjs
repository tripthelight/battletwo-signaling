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

const INSTANCE_A =
  'signaling-a';

const INSTANCE_B =
  'signaling-b';

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

function extractRefreshOnePeer(
  source,
) {
  const startMarker =
    'async function refreshOnePeer(';

  const endMarker =
    '\nasync function refreshPeerPresence()';

  const start =
    source.indexOf(
      startMarker,
    );

  if (start < 0) {
    throw new Error(
      'refreshOnePeer() was not found in signaling_server.js',
    );
  }

  const end =
    source.indexOf(
      endMarker,
      start,
    );

  if (end < 0) {
    throw new Error(
      'refreshPeerPresence() boundary was not found in signaling_server.js',
    );
  }

  return source.slice(
    start,
    end,
  );
}

function createSocket(
  name,
) {
  const socket = {
    name,

    OPEN:
      1,

    readyState:
      1,

    closeCalls:
      [],

    close(
      code,
      reason,
    ) {
      this.closeCalls.push({
        code,
        reason,
      });

      this.readyState =
        2;
    },
  };

  return socket;
}

function createLogger() {
  const entries =
    [];

  return {
    entries,

    warn(
      ...args
    ) {
      entries.push({
        level:
          'warn',

        args,
      });
    },

    error(
      ...args
    ) {
      entries.push({
        level:
          'error',

        args,
      });
    },
  };
}

function compileRefreshOnePeer({
  functionSource,
  activePeerIds,
  peerDirectory,
  localPeers,
  logger,
}) {
  const factory =
    new Function(
      'shuttingDown',
      'activePeerIds',
      'peerDirectory',
      'redis',
      'localPeers',
      'console',
      `
${functionSource}

return refreshOnePeer;
      `,
    );

  return factory(
    false,
    activePeerIds,
    peerDirectory,
    {
      instanceId:
        INSTANCE_A,
    },
    localPeers,
    logger,
  );
}

function makeLocalPeers(
  initialSocket,
) {
  let currentSocket =
    initialSocket;

  return {
    getSocket(
      peerId,
    ) {
      assert.equal(
        peerId,
        PEER_ID,
      );

      return currentSocket;
    },

    replaceSocket(
      socket,
    ) {
      currentSocket =
        socket;
    },
  };
}

const source =
  await readFile(
    SIGNALING_SERVER_URL,
    'utf8',
  );

const functionSource =
  extractRefreshOnePeer(
    source,
  );

await test(
  'stale missing-owner read cannot overwrite a concurrent takeover',
  async () => {
    const activePeerIds =
      new Set([
        PEER_ID,
      ]);

    const oldSocket =
      createSocket(
        'old',
      );

    const localPeers =
      makeLocalPeers(
        oldSocket,
      );

    const logger =
      createLogger();

    let owner =
      null;

    let registerCalls =
      0;

    const peerDirectory = {
      async refresh(
        peerId,
      ) {
        assert.equal(
          peerId,
          PEER_ID,
        );

        return false;
      },

      async findInstance(
        peerId,
      ) {
        assert.equal(
          peerId,
          PEER_ID,
        );

        const staleSnapshot =
          owner;

        /*
         * findInstance()가 null을 읽은 직후,
         * old refreshOnePeer()가 다음 await continuation으로
         * 돌아오기 전에 다른 signaling instance가 takeover한다.
         */
        owner =
          INSTANCE_B;

        return staleSnapshot;
      },

      async register(
        peerId,
      ) {
        assert.equal(
          peerId,
          PEER_ID,
        );

        registerCalls +=
          1;

        owner =
          INSTANCE_A;

        return {
          peerId,
          instanceId:
            INSTANCE_A,
        };
      },
    };

    const refreshOnePeer =
      compileRefreshOnePeer({
        functionSource,
        activePeerIds,
        peerDirectory,
        localPeers,
        logger,
      });

    await refreshOnePeer(
      PEER_ID,
    );

    assert.equal(
      registerCalls,
      0,
      'presence refresh must never re-register after losing its lease',
    );

    assert.equal(
      owner,
      INSTANCE_B,
      'concurrent takeover ownership must survive stale refresh completion',
    );

    assert.equal(
      oldSocket.closeCalls.length,
      1,
      'the stale local socket must fail closed after losing presence ownership',
    );
  },
);

await test(
  'foreign presence owner closes the stale local socket',
  async () => {
    const activePeerIds =
      new Set([
        PEER_ID,
      ]);

    const oldSocket =
      createSocket(
        'old',
      );

    const localPeers =
      makeLocalPeers(
        oldSocket,
      );

    const logger =
      createLogger();

    let registerCalls =
      0;

    const peerDirectory = {
      async refresh() {
        return false;
      },

      async findInstance() {
        return INSTANCE_B;
      },

      async register() {
        registerCalls +=
          1;

        throw new Error(
          'register must not be called',
        );
      },
    };

    const refreshOnePeer =
      compileRefreshOnePeer({
        functionSource,
        activePeerIds,
        peerDirectory,
        localPeers,
        logger,
      });

    await refreshOnePeer(
      PEER_ID,
    );

    assert.equal(
      registerCalls,
      0,
    );

    assert.equal(
      oldSocket.closeCalls.length,
      1,
      'a socket that no longer owns presence must be closed',
    );
  },
);

await test(
  'in-flight stale refresh cannot close a newer local socket generation',
  async () => {
    const activePeerIds =
      new Set([
        PEER_ID,
      ]);

    const oldSocket =
      createSocket(
        'old',
      );

    const newSocket =
      createSocket(
        'new',
      );

    const localPeers =
      makeLocalPeers(
        oldSocket,
      );

    const logger =
      createLogger();

    let registerCalls =
      0;

    const peerDirectory = {
      async refresh() {
        return false;
      },

      async findInstance() {
        /*
         * Redis 조회가 진행되는 사이 same-instance의
         * newer socket generation이 local peer identity를 차지한다.
         */
        localPeers.replaceSocket(
          newSocket,
        );

        return INSTANCE_A;
      },

      async register() {
        registerCalls +=
          1;

        throw new Error(
          'register must not be called',
        );
      },
    };

    const refreshOnePeer =
      compileRefreshOnePeer({
        functionSource,
        activePeerIds,
        peerDirectory,
        localPeers,
        logger,
      });

    await refreshOnePeer(
      PEER_ID,
    );

    assert.equal(
      registerCalls,
      0,
      'stale refresh must not attempt lease reacquisition',
    );

    assert.equal(
      newSocket.closeCalls.length,
      0,
      'stale refresh must never close the newer local socket generation',
    );
  },
);

console.log(
  `ALL PRESENCE REFRESH TAKEOVER RACE TESTS PASSED: ${passed}`,
);
