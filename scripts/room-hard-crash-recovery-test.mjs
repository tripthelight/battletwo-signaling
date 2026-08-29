import assert from 'node:assert/strict';
import {
  readFile,
} from 'node:fs/promises';

import {
  createMatchmaker,
} from '../src/server/matchmaker.js';

import * as roomMembershipModule
  from '../src/server/roomMembership.js';

const PREFIX =
  'battletwo:test:hard-crash';

const ROOM_ID =
  'room-hard-crash-1';

const PEER_A =
  'peer-hard-crash-a';

const PEER_B =
  'peer-hard-crash-b';

const NOW_MS =
  10_000;

const GRACE_MS =
  6_000;

const RECHECK_MS =
  1_000;

const ROOM_WATCH_KEY =
  `${PREFIX}:room-watch`;

const SIGNALING_SERVER_URL =
  new URL(
    '../src/server/signaling_server.js',
    import.meta.url,
  );

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

function makeCaptureCommand({
  evalResult = null,
} = {}) {
  const calls = {
    eval:
      [],

    scan:
      [],

    zadd:
      [],
  };

  return {
    calls,

    async get() {
      return null;
    },

    async zrem() {
      return 0;
    },

    async eval(
      script,
      numberOfKeys,
      ...args
    ) {
      calls.eval.push({
        script,
        numberOfKeys,
        args,
      });

      if (
        typeof evalResult ===
        'function'
      ) {
        return evalResult({
          script,
          numberOfKeys,
          args,
        });
      }

      return evalResult;
    },

    async scan(
      cursor,
      ...args
    ) {
      calls.scan.push({
        cursor,
        args,
      });

      return [
        '0',
        [
          `${PREFIX}:room:${ROOM_ID}`,
          `${PREFIX}:room:pre-upgrade-room`,
        ],
      ];
    },

    async zadd(
      ...args
    ) {
      calls.zadd.push(
        args,
      );

      return 1;
    },
  };
}

function requireFunction(
  value,
  name,
) {
  assert.equal(
    typeof value,
    'function',
    `${name} must exist as a function`,
  );

  return value;
}

await test(
  'matchmaker atomically indexes every newly paired room',
  async () => {
    const command =
      makeCaptureCommand({
        evalResult: [
          'paired',
          ROOM_ID,
          PEER_A,
        ],
      });

    const matchmaker =
      createMatchmaker({
        command,
        keyPrefix:
          PREFIX,
      });

    const result =
      await matchmaker.match({
        peerId:
          PEER_B,

        proposedRoomId:
          ROOM_ID,

        nowMs:
          NOW_MS,
      });

    assert.equal(
      result.status,
      'paired',
    );

    assert.equal(
      command.calls.eval.length,
      1,
    );

    const call =
      command.calls.eval[0];

    assert.equal(
      call.numberOfKeys,
      5,
      'room creation must include room-watch in the same Redis Lua transaction',
    );

    assert.equal(
      call.args[4],
      ROOM_WATCH_KEY,
      'the fifth Redis key must be the persistent room-watch index',
    );

    assert.match(
      call.script,
      /ZADD[\s\S]*KEYS\[5\][\s\S]*proposedRoomId/,
      'pair creation Lua must ZADD the room id to room-watch atomically',
    );
  },
);

await test(
  'pair rollback removes the room from room-watch atomically',
  async () => {
    const command =
      makeCaptureCommand({
        evalResult:
          1,
      });

    const matchmaker =
      createMatchmaker({
        command,
        keyPrefix:
          PREFIX,
      });

    const rolledBack =
      await matchmaker.rollbackPair({
        roomId:
          ROOM_ID,

        peerId:
          PEER_A,

        partnerPeerId:
          PEER_B,
      });

    assert.equal(
      rolledBack,
      true,
    );

    const call =
      command.calls.eval[0];

    assert.equal(
      call.numberOfKeys,
      5,
      'rollback must include room-watch in the same Redis Lua transaction',
    );

    assert.equal(
      call.args[4],
      ROOM_WATCH_KEY,
    );

    assert.match(
      call.script,
      /ZREM[\s\S]*KEYS\[5\][\s\S]*ARGV\[3\]/,
      'rollback Lua must remove the rolled-back room id from room-watch',
    );
  },
);

await test(
  'room membership exposes persistent room-watch and orphan reconciliation contracts',
  async () => {
    const makeRoomWatchKey =
      requireFunction(
        roomMembershipModule.makeRoomWatchKey,
        'makeRoomWatchKey',
      );

    assert.equal(
      makeRoomWatchKey(
        PREFIX,
      ),
      ROOM_WATCH_KEY,
    );

    const command =
      makeCaptureCommand({
        evalResult:
          [],
      });

    const roomMembership =
      roomMembershipModule
        .createRoomMembership({
          command,
          keyPrefix:
            PREFIX,
        });

    requireFunction(
      roomMembership.backfillRoomWatch,
      'roomMembership.backfillRoomWatch',
    );

    requireFunction(
      roomMembership.reconcileOrphanedRooms,
      'roomMembership.reconcileOrphanedRooms',
    );
  },
);

await test(
  'pre-upgrade rooms can be backfilled into room-watch without overwriting existing scores',
  async () => {
    const command =
      makeCaptureCommand();

    const roomMembership =
      roomMembershipModule
        .createRoomMembership({
          command,
          keyPrefix:
            PREFIX,
        });

    const backfillRoomWatch =
      requireFunction(
        roomMembership.backfillRoomWatch,
        'roomMembership.backfillRoomWatch',
      );

    const added =
      await backfillRoomWatch({
        nowMs:
          NOW_MS,

        scanCount:
          100,
      });

    assert.equal(
      command.calls.scan.length,
      1,
      'backfill must discover pre-existing room:* keys with SCAN',
    );

    const scanCall =
      command.calls.scan[0];

    assert.ok(
      scanCall.args.includes(
        `${PREFIX}:room:*`,
      ),
      'backfill SCAN must be scoped to this signaling key prefix',
    );

    assert.equal(
      command.calls.zadd.length,
      2,
      'each discovered room must be offered to room-watch',
    );

    for (
      const zaddArgs
      of command.calls.zadd
    ) {
      assert.equal(
        zaddArgs[0],
        ROOM_WATCH_KEY,
      );

      assert.ok(
        zaddArgs.includes(
          'NX',
        ),
        'backfill must use ZADD NX so an existing watch deadline is never pushed',
      );
    }

    assert.equal(
      added,
      2,
      'backfill should report how many room ids were newly indexed',
    );
  },
);

await test(
  'orphan reconciler checks presence atomically and preserves an existing cleanup deadline',
  async () => {
    const command =
      makeCaptureCommand({
        evalResult:
          [],
      });

    const roomMembership =
      roomMembershipModule
        .createRoomMembership({
          command,
          keyPrefix:
            PREFIX,
        });

    const reconcileOrphanedRooms =
      requireFunction(
        roomMembership.reconcileOrphanedRooms,
        'roomMembership.reconcileOrphanedRooms',
      );

    await reconcileOrphanedRooms({
      nowMs:
        NOW_MS,

      graceMs:
        GRACE_MS,

      recheckMs:
        RECHECK_MS,

      limit:
        100,
    });

    assert.equal(
      command.calls.eval.length,
      1,
      'orphan reconciliation must use one atomic Redis Lua transaction per sweep',
    );

    const call =
      command.calls.eval[0];

    assert.equal(
      call.numberOfKeys,
      3,
      'reconciliation must atomically coordinate room-watch, cleanup zset, and cleanup-room hash',
    );

    assert.equal(
      call.args[0],
      ROOM_WATCH_KEY,
    );

    assert.match(
      call.script,
      /-- room-membership:reconcile-orphaned-rooms/,
    );

    assert.match(
      call.script,
      /ZRANGEBYSCORE/,
      'only due room-watch entries may be inspected',
    );

    assert.match(
      call.script,
      /:peer:/,
      'reconciliation Lua must inspect peer presence keys inside the atomic transaction',
    );

    assert.match(
      call.script,
      /ZSCORE/,
      'reconciliation must inspect an existing cleanup score before scheduling',
    );

    assert.match(
      call.script,
      /HGET/,
      'reconciliation must verify which room an existing cleanup reservation belongs to',
    );

    assert.match(
      call.script,
      /ZADD/,
      'a missing peer must result in a durable cleanup reservation or a rescheduled watch check',
    );
  },
);

await test(
  'final room cleanup removes the room-watch entry in the same Lua transaction',
  async () => {
    const command =
      makeCaptureCommand({
        evalResult:
          [],
      });

    const roomMembership =
      roomMembershipModule
        .createRoomMembership({
          command,
          keyPrefix:
            PREFIX,
        });

    await roomMembership.cleanupDue({
      nowMs:
        NOW_MS,

      limit:
        100,
    });

    const call =
      command.calls.eval[0];

    assert.equal(
      call.numberOfKeys,
      3,
      'cleanupDue must include room-watch in its atomic cleanup transaction',
    );

    assert.equal(
      call.args[2],
      ROOM_WATCH_KEY,
    );

    assert.match(
      call.script,
      /ZREM[\s\S]*KEYS\[3\][\s\S]*scheduledRoomId/,
      'final cleanup must remove the room id from room-watch',
    );
  },
);

await test(
  'server startup backfills room-watch before starting the orphan reconciliation sweep',
  async () => {
    const source =
      await readFile(
        SIGNALING_SERVER_URL,
        'utf8',
      );

    const startIndex =
      source.indexOf(
        'async function startServer()',
      );

    const endIndex =
      source.indexOf(
        '\nasync function cancelAllWaitingPeers()',
        startIndex,
      );

    assert.ok(
      startIndex >= 0 &&
      endIndex > startIndex,
      'startServer() boundaries must be discoverable',
    );

    const startSource =
      source.slice(
        startIndex,
        endIndex,
      );

    const backfillIndex =
      startSource.indexOf(
        'backfillRoomWatch',
      );

    const sweepIndex =
      startSource.indexOf(
        'startRoomReconcileSweep',
      );

    assert.ok(
      backfillIndex >= 0,
      'startup must backfill pre-upgrade room:* keys into room-watch',
    );

    assert.ok(
      sweepIndex > backfillIndex,
      'the room reconciler sweep must start only after backfill completes',
    );
  },
);

console.log(
  `ROOM HARD-CRASH RECOVERY TESTS: ${passed} passed, ${failed} failed`,
);

if (failed > 0) {
  throw new Error(
    `ROOM HARD-CRASH RECOVERY REGRESSION FAILED: ${failed} test(s)`,
  );
}

console.log(
  `ALL ROOM HARD-CRASH RECOVERY TESTS PASSED: ${passed}`,
);
