import assert from 'node:assert/strict';

import {
  createResumeSocketLifecycle,
} from '../src/server/resumeSocketLifecycle.js';

const PEER_ID =
  'peer-claim-loss-race';

const ROOM_ID =
  'room-claim-loss-race';

const PARTNER_PEER_ID =
  'peer-partner';

const INSTANCE_ID =
  'signaling-b';

const TOKEN =
  'resume-token-claim-loss-race';

function createDeferred() {
  let resolve;
  let reject;

  const promise =
    new Promise(
      (
        currentResolve,
        currentReject,
      ) => {
        resolve =
          currentResolve;

        reject =
          currentReject;
      },
    );

  return {
    promise,
    resolve,
    reject,
  };
}

function createConnection(
  name,
) {
  return {
    name,
    open: true,
  };
}

function createLocalPeers({
  oldConnection,
}) {
  const byConnection =
    new Map();

  const byPeerId =
    new Map();

  const oldMeta = {
    peerId:
      PEER_ID,
    roomId:
      ROOM_ID,
  };

  byConnection.set(
    oldConnection,
    oldMeta,
  );

  byPeerId.set(
    PEER_ID,
    oldConnection,
  );

  function hasPeer(
    peerId,
  ) {
    return byPeerId.has(
      peerId,
    );
  }

  function register(
    connection,
    peerId,
  ) {
    if (
      byConnection.has(
        connection,
      )
    ) {
      throw new Error(
        'connection already registered',
      );
    }

    if (
      byPeerId.has(
        peerId,
      )
    ) {
      throw new Error(
        'peer already registered',
      );
    }

    const meta = {
      peerId,
      roomId: null,
    };

    byConnection.set(
      connection,
      meta,
    );

    byPeerId.set(
      peerId,
      connection,
    );

    return meta;
  }

  function getMeta(
    connection,
  ) {
    return (
      byConnection.get(
        connection,
      ) ??
      null
    );
  }

  function setRoomId(
    connection,
    roomId,
  ) {
    const meta =
      byConnection.get(
        connection,
      );

    if (!meta) {
      return false;
    }

    meta.roomId =
      roomId;

    return true;
  }

  function remove(
    connection,
  ) {
    const meta =
      byConnection.get(
        connection,
      );

    if (!meta) {
      return false;
    }

    byConnection.delete(
      connection,
    );

    if (
      byPeerId.get(
        meta.peerId,
      ) === connection
    ) {
      byPeerId.delete(
        meta.peerId,
      );
    }

    return true;
  }

  return {
    hasPeer,
    register,
    getMeta,
    setRoomId,
    remove,
  };
}

function createResumeJoinManager() {
  const records =
    new Map();

  async function claim({
    connection,
    token,
  }) {
    assert.equal(
      token,
      TOKEN,
    );

    const record = {
      peerId:
        PEER_ID,
      roomId:
        ROOM_ID,
      role:
        'polite',
      partnerPeerId:
        PARTNER_PEER_ID,
    };

    records.set(
      connection,
      record,
    );

    return {
      status:
        'acquired',
      ...record,
    };
  }

  async function restore(
    connection,
  ) {
    const record =
      records.get(
        connection,
      );

    assert.ok(
      record,
      'restore requires an active claim',
    );

    return {
      status:
        'restored',
      ...record,
      resumeToken:
        TOKEN,
    };
  }

  async function release(
    connection,
  ) {
    records.delete(
      connection,
    );

    return true;
  }

  function get(
    connection,
  ) {
    return (
      records.get(
        connection,
      ) ??
      null
    );
  }

  return {
    claim,
    restore,
    release,
    get,
  };
}

function createPeerDirectory() {
  let owner =
    INSTANCE_ID;

  const unregisterStarted =
    createDeferred();

  const allowUnregister =
    createDeferred();

  let blockNextUnregister =
    true;

  async function register(
    peerId,
  ) {
    assert.equal(
      peerId,
      PEER_ID,
    );

    owner =
      INSTANCE_ID;

    return {
      peerId,
      instanceId:
        INSTANCE_ID,
    };
  }

  async function unregister(
    peerId,
  ) {
    assert.equal(
      peerId,
      PEER_ID,
    );

    if (blockNextUnregister) {
      blockNextUnregister =
        false;

      unregisterStarted.resolve();

      await allowUnregister.promise;
    }

    if (
      owner !==
      INSTANCE_ID
    ) {
      return false;
    }

    owner =
      null;

    return true;
  }

  function getOwner() {
    return owner;
  }

  return {
    register,
    unregister,
    unregisterStarted:
      unregisterStarted.promise,
    allowUnregister:
      allowUnregister.resolve,
    getOwner,
  };
}

const oldConnection =
  createConnection(
    'old',
  );

const firstResumeConnection =
  createConnection(
    'first-resume',
  );

const secondResumeConnection =
  createConnection(
    'second-resume',
  );

const localPeers =
  createLocalPeers({
    oldConnection,
  });

const resumeJoinManager =
  createResumeJoinManager();

const peerDirectory =
  createPeerDirectory();

const activePeerIds =
  new Set([
    PEER_ID,
  ]);

let scheduleCount =
  0;

const lifecycle =
  createResumeSocketLifecycle({
    resumeJoinManager,
    localPeers,
    peerDirectory,
    activePeerIds,

    scheduleDisconnect:
      async (peerId) => {
        assert.equal(
          peerId,
          PEER_ID,
        );

        scheduleCount += 1;

        return {
          status:
            'scheduled',
          roomId:
            ROOM_ID,
        };
      },

    cancelWaiting:
      async (peerId) => {
        assert.equal(
          peerId,
          PEER_ID,
        );
      },

    isConnectionOpen:
      (connection) =>
        connection.open,

    claimRetryAttempts: 1,
    claimRetryDelayMs: 0,
    wait:
      async () => {},
  });

let cleanupResult;
let firstResumeResult;
let cleanupError =
  null;
let firstResumeError =
  null;

const cleanupTask =
  lifecycle.cleanup(
    oldConnection,
  ).then(
    (result) => {
      cleanupResult =
        result;
    },
    (error) => {
      cleanupError =
        error;
    },
  );

await peerDirectory.unregisterStarted;

const firstResumeTask =
  lifecycle.resume({
    connection:
      firstResumeConnection,
    token:
      TOKEN,
  }).then(
    (result) => {
      firstResumeResult =
        result;
    },
    (error) => {
      firstResumeError =
        error;
    },
  );

await firstResumeTask;

peerDirectory.allowUnregister();

await cleanupTask;

if (cleanupError) {
  throw cleanupError;
}

if (firstResumeError) {
  throw firstResumeError;
}

assert.equal(
  scheduleCount,
  1,
  'old cleanup must durably schedule room cleanup exactly once',
);

assert.equal(
  cleanupResult.status,
  'cleaned',
  'old connection cleanup must complete',
);

assert.equal(
  firstResumeResult.status,
  'peer-active',
  [
    'same-instance resume must not activate while stale old cleanup',
    'still owns the local peer identity',
  ].join(' '),
);

assert.equal(
  peerDirectory.getOwner(),
  null,
  'old cleanup must remove only the old presence before handoff',
);

const secondResumeResult =
  await lifecycle.resume({
    connection:
      secondResumeConnection,
    token:
      TOKEN,
  });

assert.equal(
  secondResumeResult.status,
  'restored',
  'resume must succeed after old cleanup fully releases identity',
);

assert.equal(
  peerDirectory.getOwner(),
  INSTANCE_ID,
  'successful resumed connection must retain its presence',
);

assert.equal(
  localPeers.getMeta(
    oldConnection,
  ),
  null,
  'old local identity must be removed after cleanup',
);

assert.equal(
  localPeers.getMeta(
    secondResumeConnection,
  )?.peerId,
  PEER_ID,
  'new local identity must belong to the restored connection',
);

console.log(
  'PASS: claim-loss same-instance cleanup blocks overlapping resume activation',
);

console.log(
  'PASS: resumed presence survives after old cleanup finishes',
);

console.log(
  'ALL CLAIM-LOSS SAME-INSTANCE RACE TESTS PASSED',
);
