import assert from 'node:assert/strict';
import {
  randomUUID,
} from 'node:crypto';

import Redis from 'ioredis';

import {
  createRoomMembership,
  makePeerRoomKey,
  makeRoomCleanupKey,
  makeRoomCleanupRoomKey,
  makeRoomKey,
} from '../src/server/roomMembership.js';

import {
  makePeerKey,
} from '../src/server/peerDirectory.js';

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

const testId =
  randomUUID();

const keyPrefix =
  `battletwo:test:fence:${testId}`;

const peerA =
  'peer-a';

const peerB =
  'peer-b';

const roomId =
  'room-1';

const instanceA =
  'instance-a';

const instanceB =
  'instance-b';

const dueAtMs =
  Date.now() +
  15_000;

const command =
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

const membership =
  createRoomMembership({
    command,
    keyPrefix,
  });

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

const roomKey =
  makeRoomKey(
    keyPrefix,
    roomId,
  );

const cleanupKey =
  makeRoomCleanupKey(
    keyPrefix,
  );

const cleanupRoomKey =
  makeRoomCleanupRoomKey(
    keyPrefix,
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

async function assertCleanupScheduled(
  expectedDueAtMs,
) {
  const scheduledRoomId =
    await command.hget(
      cleanupRoomKey,
      peerA,
    );

  const score =
    await command.zscore(
      cleanupKey,
      peerA,
    );

  assert.equal(
    scheduledRoomId,
    roomId,
  );

  assert.notEqual(
    score,
    null,
  );

  assert.equal(
    Number(score),
    expectedDueAtMs,
  );
}

async function assertCleanupAbsent() {
  const scheduledRoomId =
    await command.hget(
      cleanupRoomKey,
      peerA,
    );

  const score =
    await command.zscore(
      cleanupKey,
      peerA,
    );

  assert.equal(
    scheduledRoomId,
    null,
  );

  assert.equal(
    score,
    null,
  );
}

async function removeTestKeys() {
  await command.del(
    peerARoomKey,
    peerBRoomKey,
    roomKey,
    cleanupKey,
    cleanupRoomKey,
    peerAPresenceKey,
    peerBPresenceKey,
  );
}

try {
  await command.connect();

  assert.equal(
    await command.ping(),
    'PONG',
  );

  console.log(
    'PASS: redis connected',
  );

  /*
   * 혹시 같은 UUID prefix가 존재하는 극단적인 경우까지
   * 고려하여 테스트 시작 전에 정리한다.
   */
  await removeTestKeys();

  /*
   * 실제 Redis room 상태 구성.
   *
   * peer-a = impolite
   * peer-b = polite
   * peer-a presence owner = instance-a
   */
  await command.hset(
    roomKey,
    'impolite',
    peerA,
    'polite',
    peerB,
  );

  await command.set(
    peerARoomKey,
    roomId,
  );

  await command.set(
    peerBRoomKey,
    roomId,
  );

  await command.set(
    peerAPresenceKey,
    instanceA,
  );

  await command.set(
    peerBPresenceKey,
    instanceA,
  );

  console.log(
    'PASS: redis room fixture created',
  );

  /*
   * 1.
   * 현재 presence owner인 instance-a는
   * disconnect cleanup을 예약할 수 있어야 한다.
   */
  const scheduledByA =
    await membership
      .scheduleDisconnectFenced({
        peerId:
          peerA,

        dueAtMs,

        expectedPresenceOwner:
          instanceA,
      });

  assert.deepEqual(
    scheduledByA,
    {
      status:
        'scheduled',

      roomId,
    },
  );

  await assertCleanupScheduled(
    dueAtMs,
  );

  console.log(
    'PASS: instance-a scheduled fenced disconnect',
  );

  /*
   * 2.
   * resume restore는 room membership을 검증하면서
   * cleanup ZSET/HASH를 하나의 Lua transaction 안에서
   * 동시에 제거해야 한다.
   */
  const restored =
    await membership.restore({
      peerId:
        peerA,

      roomId,

      role:
        'impolite',
    });

  assert.deepEqual(
    restored,
    {
      roomId,

      role:
        'impolite',

      partnerPeerId:
        peerB,
    },
  );

  await assertCleanupAbsent();

  console.log(
    'PASS: restore atomically cancelled disconnect',
  );

  /*
   * 3.
   * cross-instance takeover를 실제 Redis presence key로
   * 재현한다.
   *
   * 이제 peer-a의 owner는 instance-b다.
   */
  await command.set(
    peerAPresenceKey,
    instanceB,
  );

  assert.equal(
    await command.get(
      peerAPresenceKey,
    ),
    instanceB,
  );

  console.log(
    'PASS: instance-b took over presence',
  );

  /*
   * 4.
   * 오래된 instance-a가 뒤늦게 disconnect 예약을
   * 시도하면 Lua fencing에 의해 거부돼야 한다.
   */
  const staleAResult =
    await membership
      .scheduleDisconnectFenced({
        peerId:
          peerA,

        dueAtMs,

        expectedPresenceOwner:
          instanceA,
      });

  assert.deepEqual(
    staleAResult,
    {
      status:
        'owner-changed',

      owner:
        instanceB,
    },
  );

  /*
   * 더 중요:
   * owner-changed 결과만 맞는 것이 아니라
   * 실제 cleanup ZSET/HASH가 다시 생성되지 않아야 한다.
   */
  await assertCleanupAbsent();

  console.log(
    'PASS: stale instance-a disconnect was fenced',
  );

  /*
   * 5.
   * 현재 실제 owner인 instance-b는 동일 peer에 대해
   * cleanup을 정상 예약할 수 있어야 한다.
   *
   * fencing이 모든 disconnect를 막는 것이 아니라
   * stale owner만 막는다는 것을 실제 Redis에서 확인한다.
   */
  const scheduledByB =
    await membership
      .scheduleDisconnectFenced({
        peerId:
          peerA,

        dueAtMs,

        expectedPresenceOwner:
          instanceB,
      });

  assert.deepEqual(
    scheduledByB,
    {
      status:
        'scheduled',

      roomId,
    },
  );

  await assertCleanupScheduled(
    dueAtMs,
  );

  console.log(
    'PASS: current instance-b scheduled disconnect',
  );

  /*
   * 6.
   * presence key 자체가 만료/삭제된 경우에는
   * 아직 다른 instance가 takeover하지 않은 상태이므로
   * cleanup 예약을 허용해야 한다.
   *
   * 먼저 기존 예약을 restore로 취소한다.
   */
  const restoredAgain =
    await membership.restore({
      peerId:
        peerA,

      roomId,

      role:
        'impolite',
    });

  assert.deepEqual(
    restoredAgain,
    {
      roomId,

      role:
        'impolite',

      partnerPeerId:
        peerB,
    },
  );

  await assertCleanupAbsent();

  await command.del(
    peerAPresenceKey,
  );

  assert.equal(
    await command.get(
      peerAPresenceKey,
    ),
    null,
  );

  const noPresenceResult =
    await membership
      .scheduleDisconnectFenced({
        peerId:
          peerA,

        dueAtMs,

        expectedPresenceOwner:
          instanceA,
      });

  assert.deepEqual(
    noPresenceResult,
    {
      status:
        'scheduled',

      roomId,
    },
  );

  await assertCleanupScheduled(
    dueAtMs,
  );

  console.log(
    'PASS: missing presence still permits durable cleanup',
  );

  console.log(
    'ALL REDIS FENCING TESTS PASSED',
  );
} finally {
  try {
    if (
      command.status ===
        'ready' ||
      command.status ===
        'connect'
    ) {
      await removeTestKeys();

      console.log(
        'PASS: test redis keys removed',
      );
    }
  } finally {
    command.disconnect();
  }
}
