import assert from 'node:assert/strict';
import {
  randomUUID,
} from 'node:crypto';

import Redis from 'ioredis';

import {
  createMatchmaker,
} from '../src/server/matchmaker.js';

const redisUrl =
  process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error(
    'REDIS_URL is required',
  );
}

const keyPrefix =
  (
    process.env.REDIS_KEY_PREFIX ||
    `bt:matchmaker-real:${randomUUID()}`
  );

const setup =
  new Redis(
    redisUrl,
    {
      maxRetriesPerRequest: 1,
    },
  );

const peerIds = [
  'peer-a',
  'peer-b',
  'peer-c',
  'peer-d',
];

const clients =
  peerIds.map(
    () =>
      new Redis(
        redisUrl,
        {
          maxRetriesPerRequest: 1,
        },
      ),
  );

function peerKey(
  peerId,
) {
  return (
    `${keyPrefix}:peer:${peerId}`
  );
}

function peerRoomKey(
  peerId,
) {
  return (
    `${keyPrefix}:peer-room:${peerId}`
  );
}

async function cleanup() {
  const keys = [];

  let cursor = '0';

  do {
    const [
      nextCursor,
      found,
    ] =
      await setup.scan(
        cursor,
        'MATCH',
        `${keyPrefix}:*`,
        'COUNT',
        100,
      );

    cursor =
      nextCursor;

    keys.push(
      ...found,
    );
  } while (
    cursor !== '0'
  );

  if (
    keys.length > 0
  ) {
    await setup.del(
      ...keys,
    );
  }
}

try {
  await cleanup();

  for (
    const peerId
    of peerIds
  ) {
    await setup.set(
      peerKey(peerId),
      `instance-${peerId}`,
      'PX',
      30_000,
    );
  }

  const matchmakers =
    clients.map(
      (command) =>
        createMatchmaker({
          command,
          keyPrefix,
        }),
    );

  const results =
    await Promise.all(
      peerIds.map(
        (
          peerId,
          index,
        ) =>
          matchmakers[
            index
          ].match({
            peerId,

            proposedRoomId:
              `room-${peerId}`,

            nowMs:
              1000 + index,
          }),
      ),
    );

  console.log(
    'RESULTS:',
    JSON.stringify(
      results,
      null,
      2,
    ),
  );

  const pairedResults =
    results.filter(
      (result) =>
        result.status ===
        'paired',
    );

  const waitingResults =
    results.filter(
      (result) =>
        result.status ===
        'waiting',
    );

  console.log(
    'PAIRED_RESULTS:',
    pairedResults.length,
  );

  console.log(
    'WAITING_RESULTS:',
    waitingResults.length,
  );

  assert.equal(
    pairedResults.length,
    2,
  );

  assert.equal(
    waitingResults.length,
    2,
  );

  const waitingCount =
    await setup.zcard(
      `${keyPrefix}:waiting`,
    );

  console.log(
    'WAITING_COUNT_FINAL:',
    waitingCount,
  );

  assert.equal(
    waitingCount,
    0,
  );

  const peerRooms =
    new Map();

  for (
    const peerId
    of peerIds
  ) {
    const roomId =
      await setup.get(
        peerRoomKey(
          peerId,
        ),
      );

    console.log(
      `PEER_ROOM_${peerId}:`,
      roomId,
    );

    assert.ok(
      roomId,
    );

    peerRooms.set(
      peerId,
      roomId,
    );
  }

  const uniqueRoomIds =
    new Set(
      peerRooms.values(),
    );

  console.log(
    'UNIQUE_ROOMS:',
    [
      ...uniqueRoomIds,
    ],
  );

  assert.equal(
    uniqueRoomIds.size,
    2,
  );

  const allMembers = [];

  for (
    const roomId
    of uniqueRoomIds
  ) {
    const room =
      await setup.hgetall(
        `${keyPrefix}:room:${roomId}`,
      );

    console.log(
      `ROOM_${roomId}:`,
      room,
    );

    assert.ok(
      room.impolite,
    );

    assert.ok(
      room.polite,
    );

    assert.notEqual(
      room.impolite,
      room.polite,
    );

    allMembers.push(
      room.impolite,
      room.polite,
    );

    assert.equal(
      peerRooms.get(
        room.impolite,
      ),
      roomId,
    );

    assert.equal(
      peerRooms.get(
        room.polite,
      ),
      roomId,
    );
  }

  const sortedMembers =
    [...allMembers].sort();

  const sortedPeers =
    [...peerIds].sort();

  console.log(
    'ALL_ROOM_MEMBERS:',
    sortedMembers,
  );

  assert.deepEqual(
    sortedMembers,
    sortedPeers,
  );

  assert.equal(
    new Set(
      allMembers,
    ).size,
    peerIds.length,
  );

  console.log(
    'DUPLICATE_MEMBERSHIP:',
    0,
  );

  console.log(
    'ALL TESTS PASSED',
  );
} finally {
  await cleanup();

  for (
    const client
    of clients
  ) {
    client.disconnect();
  }

  setup.disconnect();
}