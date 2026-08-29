import express from 'express';
import http from 'http';
import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';

import { config } from './config.js';
import {
  createDisconnectScheduler,
} from './disconnectScheduler.js';
import { MAKE_STORAGE } from './functions/encryption/makeStorage.js';
import {
  createInstanceRelay,
} from './instanceRelay.js';
import {
  createMatchmaker,
} from './matchmaker.js';
import { createPeerDirectory } from './peerDirectory.js';
import {
  createPeerMessenger,
} from './peerMessenger.js';
import {
  createRoomMembership,
} from './roomMembership.js';
import {
  createResumeClaimManager,
} from './resumeClaimManager.js';
import {
  createResumeConnectionManager,
} from './resumeConnection.js';
import {
  createResumeJoinManager,
} from './resumeJoin.js';
import {
  createResumeSessionStore,
} from './resumeSession.js';
import {
  createResumeSocketLifecycle,
} from './resumeSocketLifecycle.js';
import { redis } from './redis.js';
import { localPeers } from './state/localPeers.js';

const app = express();

const server = http.createServer(app);

const wss = new WebSocketServer({
  server,
  maxPayload: config.maxPayloadBytes,
});

const peerDirectory =
  createPeerDirectory({
    command: redis.command,
    keyPrefix:
      config.redisKeyPrefix,
    instanceId:
      redis.instanceId,
    ttlMs:
      config.peerPresenceTtlMs,
  });

const instanceRelay =
  createInstanceRelay({
    redisContext:
      redis,

    keyPrefix:
      config.redisKeyPrefix,

    peerRegistry:
      localPeers,

    deliver:
      deliverPeerPayload,
  });

const peerMessenger =
  createPeerMessenger({
    localPeers,

    peerDirectory,

    relay:
      instanceRelay,

    instanceId:
      redis.instanceId,

    deliver:
      deliverPeerPayload,
  });

const matchmaker =
  createMatchmaker({
    command:
      redis.command,

    keyPrefix:
      config.redisKeyPrefix,
  });

const roomMembership =
  createRoomMembership({
    command:
      redis.command,

    keyPrefix:
      config.redisKeyPrefix,
  });

const disconnectScheduler =
  createDisconnectScheduler({
    roomMembership,

    instanceId:
      redis.instanceId,

    graceMs:
      config.resumeSessionTtlMs,
  });

const resumeSessionStore =
  createResumeSessionStore({
    command:
      redis.command,

    keyPrefix:
      config.redisKeyPrefix,

    ttlMs:
      config.resumeSessionTtlMs,

    claimTtlMs:
      config.resumeClaimTtlMs,
  });

const resumeClaimManager =
  createResumeClaimManager({
    store:
      resumeSessionStore,

    refreshMs:
      config.resumeClaimRefreshMs,
  });

const resumeConnectionManager =
  createResumeConnectionManager({
    store:
      resumeSessionStore,

    claimManager:
      resumeClaimManager,
  });

const resumeJoinManager =
  createResumeJoinManager({
    connectionManager:
      resumeConnectionManager,

    roomMembership,
  });

const INTERNAL_PAIR_ASSIGNMENT =
  '__internal-pair-assignment';

const ROOM_CLEANUP_SWEEP_MS =
  1_000;

const ROOM_CLEANUP_BATCH_SIZE =
  100;

const CONNECTION_CLEANUP_RETRY_MS =
  1_000;

const activePeerIds =
  new Set();

const connectionCleanupTasks =
  new Set();

/*
 * peerId -> 최초 disconnect 시점에 계산한 dueAtMs
 *
 * Redis 장애 때문에 outer cleanup retry가 발생해도
 * grace deadline이 뒤로 밀리지 않도록 유지한다.
 */
const disconnectDeadlines =
  new Map();

/*
 * legacy ROOMS 기반 연결은 Redis room membership을
 * 사용하지 않으므로 durable Redis cleanup 예약이
 * 필요하지 않다.
 */
const legacyDisconnectPeerIds =
  new Set();

let presenceRefreshRunning =
  false;

let presenceRefreshTimer =
  null;

let roomCleanupRunning =
  false;

let roomCleanupTimer =
  null;

let shuttingDown =
  false;

const resumeSocketLifecycle =
  createResumeSocketLifecycle({
    resumeJoinManager,

    localPeers,

    peerDirectory,

    activePeerIds,

    scheduleDisconnect:
      schedulePeerDisconnect,

    cancelWaiting:
      cancelPeerWaiting,

    isConnectionOpen:
      (ws) =>
        ws.readyState ===
        ws.OPEN,

    isShuttingDown:
      () =>
        shuttingDown,
  });

async function refreshOnePeer(
  peerId,
) {
  if (
    shuttingDown ||
    !activePeerIds.has(peerId)
  ) {
    return;
  }

  try {
    const refreshed =
      await peerDirectory.refresh(
        peerId,
      );

    if (
      shuttingDown ||
      !activePeerIds.has(peerId)
    ) {
      return;
    }

    if (refreshed) {
      return;
    }

    const owner =
      await peerDirectory.findInstance(
        peerId,
      );

    if (
      shuttingDown ||
      !activePeerIds.has(peerId)
    ) {
      return;
    }

    if (owner === null) {
      await peerDirectory.register(
        peerId,
      );

      if (
        shuttingDown ||
        !activePeerIds.has(peerId)
      ) {
        return;
      }

      console.warn(
        `[presence] restored peer ${peerId}`,
      );

      return;
    }

    if (
      owner !== redis.instanceId
    ) {
      console.error(
        `[presence] peer ${peerId} is owned by ${owner}`,
      );
    }
  } catch (error) {
    console.error(
      `[presence] failed to refresh peer ${peerId}:`,
      error,
    );
  }
}

async function refreshPeerPresence() {
  if (
    shuttingDown ||
    presenceRefreshRunning
  ) {
    return;
  }

  presenceRefreshRunning =
    true;

  try {
    const peerIds =
      Array.from(
        activePeerIds,
      );

    await Promise.all(
      peerIds.map(
        refreshOnePeer,
      ),
    );
  } finally {
    presenceRefreshRunning =
      false;
  }
}

function startPresenceRefresh() {
  presenceRefreshTimer =
    setInterval(
      () => {
        void refreshPeerPresence();
      },
      config.peerPresenceRefreshMs,
    );

  presenceRefreshTimer.unref();
}

function stopPresenceRefresh() {
  if (
    presenceRefreshTimer ===
    null
  ) {
    return;
  }

  clearInterval(
    presenceRefreshTimer,
  );

  presenceRefreshTimer =
    null;
}

async function notifyExpiredRoomPartner({
  roomId,
  expiredPeerId,
  partnerPeerId,
}) {
  let delivery;

  try {
    delivery =
      await peerMessenger.send({
        targetPeerId:
          partnerPeerId,

        payload: {
          type:
            'partner-left',

          roomId,

          peerId:
            expiredPeerId,
        },
      });
  } catch (error) {
    console.error(
      `[room-cleanup] failed to notify partner ${partnerPeerId} for room ${roomId}:`,
      error,
    );

    return;
  }

  if (
    !delivery.accepted
  ) {
    console.warn(
      `[room-cleanup] partner ${partnerPeerId} unavailable for expired room ${roomId}`,
    );
  }
}

async function sweepRoomCleanup() {
  if (
    shuttingDown ||
    roomCleanupRunning
  ) {
    return;
  }

  roomCleanupRunning =
    true;

  try {
    const cleaned =
      await roomMembership.cleanupDue({
        nowMs:
          Date.now(),

        limit:
          ROOM_CLEANUP_BATCH_SIZE,
      });

    for (
      const cleanup
      of cleaned
    ) {
      console.log(
        `[room-cleanup] expired room ${cleanup.roomId} after peer ${cleanup.expiredPeerId} disconnect`,
      );

      await notifyExpiredRoomPartner(
        cleanup,
      );
    }
  } catch (error) {
    console.error(
      '[room-cleanup] sweep failed:',
      error,
    );
  } finally {
    roomCleanupRunning =
      false;
  }
}

function startRoomCleanupSweep() {
  void sweepRoomCleanup();

  roomCleanupTimer =
    setInterval(
      () => {
        void sweepRoomCleanup();
      },
      ROOM_CLEANUP_SWEEP_MS,
    );

  roomCleanupTimer.unref();
}

function stopRoomCleanupSweep() {
  if (
    roomCleanupTimer ===
    null
  ) {
    return;
  }

  clearInterval(
    roomCleanupTimer,
  );

  roomCleanupTimer =
    null;
}

function makeDisconnectDueAtMs() {
  const dueAtMs =
    Date.now() +
    config.resumeSessionTtlMs;

  if (
    !Number.isSafeInteger(
      dueAtMs,
    ) ||
    dueAtMs < 0
  ) {
    throw new Error(
      'failed to calculate disconnect cleanup deadline',
    );
  }

  return dueAtMs;
}

async function schedulePeerDisconnect(
  peerId,
) {
  /*
   * legacy ROOMS 연결에는 Redis room state가 없다.
   * Redis 장애 때문에 legacy socket cleanup까지
   * 불필요하게 막히지 않도록 즉시 정상 종료한다.
   */
  if (
    legacyDisconnectPeerIds.has(
      peerId,
    )
  ) {
    return Object.freeze({
      status:
        'not-member',

      peerId,

      legacy:
        true,
    });
  }

  let dueAtMs =
    disconnectDeadlines.get(
      peerId,
    );

  if (
    dueAtMs ===
    undefined
  ) {
    dueAtMs =
      makeDisconnectDueAtMs();

    disconnectDeadlines.set(
      peerId,
      dueAtMs,
    );
  }

  const result =
    await disconnectScheduler.schedule(
      peerId,
      {
        dueAtMs,
      },
    );

  if (
    result.status ===
    'scheduled'
  ) {
    console.log(
      `[room-cleanup] scheduled room ${result.roomId} for disconnected peer ${peerId}`,
    );

    return result;
  }

  if (
    result.status ===
    'owner-changed'
  ) {
    console.log(
      `[room-cleanup] skipped stale disconnect for peer ${peerId}; current owner is ${result.owner}`,
    );

    return result;
  }

  if (
    result.status ===
    'not-member'
  ) {
    return result;
  }

  throw new Error(
    `unexpected disconnect scheduler result: ${result.status}`,
  );
}

function waitForConnectionCleanupRetry() {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        CONNECTION_CLEANUP_RETRY_MS,
      );
    },
  );
}

function makeResumeClaimLostHandler(
  ws,
  peerId = null,
) {
  return async ({
    reason,
    error,
    peerId:
      eventPeerId,
  }) => {
    const resolvedPeerId =
      peerId ??
      eventPeerId ??
      'unknown';

    if (error) {
      console.error(
        `[resume] claim lost for peer ${resolvedPeerId}: ${reason}`,
        error,
      );
    } else {
      console.error(
        `[resume] claim lost for peer ${resolvedPeerId}: ${reason}`,
      );
    }

    if (
      ws.readyState ===
      ws.OPEN
    ) {
      ws.close(
        1011,
        'resume state lost',
      );
    }
  };
}

async function removeUndeliveredResumeSession(
  ws,
  peerId,
) {
  try {
    await resumeConnectionManager.remove(
      ws,
    );
  } catch (error) {
    console.error(
      `[resume] failed to remove undelivered session for peer ${peerId}:`,
      error,
    );
  }
}

async function issueResumeToken({
  ws,
  peerId,
  roomId,
  role,
}) {
  if (
    shuttingDown ||
    ws.readyState !==
    ws.OPEN
  ) {
    return null;
  }

  let result;

  try {
    result =
      await resumeConnectionManager.issue({
        connection:
          ws,

        peerId,

        roomId,

        role,

        onLost:
          makeResumeClaimLostHandler(
            ws,
            peerId,
          ),
      });
  } catch (error) {
    console.error(
      `[resume] failed to issue session for peer ${peerId}:`,
      error,
    );

    if (
      ws.readyState ===
      ws.OPEN
    ) {
      ws.close(
        1011,
        'resume state unavailable',
      );
    }

    return null;
  }

  if (
    result.status !==
      'issued' &&
    result.status !==
      'active'
  ) {
    console.error(
      `[resume] failed to allocate token for peer ${peerId}: ${result.status}`,
    );

    if (
      ws.readyState ===
      ws.OPEN
    ) {
      ws.close(
        1011,
        'resume state unavailable',
      );
    }

    return null;
  }

  if (
    result.peerId !==
      peerId ||
    result.roomId !==
      roomId ||
    result.role !==
      role
  ) {
    console.error(
      `[resume] session identity mismatch for peer ${peerId}`,
    );

    await removeUndeliveredResumeSession(
      ws,
      peerId,
    );

    if (
      ws.readyState ===
      ws.OPEN
    ) {
      ws.close(
        1011,
        'invalid resume state',
      );
    }

    return null;
  }

  if (
    shuttingDown ||
    ws.readyState !==
      ws.OPEN
  ) {
    await removeUndeliveredResumeSession(
      ws,
      peerId,
    );

    return null;
  }

  return result.token;
}

function rejectResume(
  ws,
  reason,
  closeCode = 1008,
) {
  safeSend(
    ws,
    {
      type:
        'resume-rejected',

      reason,
    },
  );

  if (
    ws.readyState ===
    ws.OPEN
  ) {
    ws.close(
      closeCode,
      'resume rejected',
    );
  }
}

async function handleResumeJoin(
  ws,
  resumeToken,
) {
  let result;

  try {
    result =
      await resumeSocketLifecycle.resume({
        connection:
          ws,

        token:
          resumeToken,

        onLost:
          makeResumeClaimLostHandler(
            ws,
          ),
      });
  } catch (error) {
    console.error(
      '[resume] failed to resume connection:',
      error,
    );

    if (
      ws.readyState ===
      ws.OPEN
    ) {
      ws.close(
        1011,
        'resume unavailable',
      );
    }

    return;
  }

  if (
    result.status ===
    'aborted'
  ) {
    return;
  }

  if (
    result.status ===
      'claimed' ||
    result.status ===
      'peer-active'
  ) {
    rejectResume(
      ws,
      'busy',
      1013,
    );

    return;
  }

  if (
    result.status ===
      'invalid-token' ||
    result.status ===
      'missing' ||
    result.status ===
      'invalid' ||
    result.status ===
      'invalid-state'
  ) {
    rejectResume(
      ws,
      result.status ===
        'invalid'
        ? 'invalid-state'
        : result.status,
    );

    return;
  }

  if (
    result.status ===
    'local-room-failed'
  ) {
    rejectResume(
      ws,
      'server-state',
      1011,
    );

    return;
  }

  if (
    result.status !==
    'restored'
  ) {
    console.error(
      `[resume] unexpected resume result: ${result.status}`,
    );

    if (
      ws.readyState ===
      ws.OPEN
    ) {
      ws.close(
        1011,
        'invalid resume result',
      );
    }

    return;
  }

  safeSend(
    ws,
    {
      type:
        'room-assigned',

      roomId:
        result.roomId,

      peerId:
        result.peerId,

      role:
        result.role,

      pairedDataChannel:
        null,

      resumeToken:
        result.token,
    },
  );

  safeSend(
    ws,
    {
      type:
        'paired',

      roomId:
        result.roomId,

      you: {
        peerId:
          result.peerId,

        role:
          result.role,
      },

      partner: {
        peerId:
          result.partnerPeerId,

        role:
          result.role ===
          'impolite'
            ? 'polite'
            : 'impolite',
      },
    },
  );

  console.log(
    `[resume] restored peer ${result.peerId} to room ${result.roomId}`,
  );
}

// ———————————————————————————————————————————————————

const ROOM_TTL_MS = config.roomTtlMs;
const TOMBSTONES = new Map(); // roomId -> { roomId, expiredAt, lastSeenAt }
const KEYPAIR = new Map(); // roomId -> { keypair }

const ROOMS = Object.create(null);

const now = () => Date.now();
const makeRoomId = () => `${Math.random().toString(36).slice(2, 12)}`;
const keypairCode = (roomId) =>
  roomId
    .replace(/\s+/g, '') // 띄어쓰기 제거
    .replace(/[^a-zA-Z0-9가-힣]/g, '') // 특수문자 제거
    .split('') // 문자열 → 배열
    .reverse() // 배열 역순
    .join(''); // 배열 → 문자열

// 문자열 안의 모든 알파벳(a~z)을 "다다음 알파벳" 으로(+2, z는 b로 래핑) 바꾸고
// 모든 숫자(0~9)는 "전전 숫자"로(-2, 0은 8로 래핑)
function transformRoomId(str) {
  return str.replace(/[a-z0-9]/g, (ch) => {
    // 숫자: 0~9 -> -2 (랩핑)
    if (ch >= '0' && ch <= '9') {
      const n = ch.charCodeAt(0) - 48; // '0' = 48
      const nn = (n + 10 - 2) % 10; // -2 with wrap
      return String.fromCharCode(48 + nn);
    }

    // 알파벳: a~z -> +2 (랩핑)
    const a = ch.charCodeAt(0) - 97; // 'a' = 97
    const aa = (a + 2) % 26; // +2 with wrap
    return String.fromCharCode(97 + aa);
  });
}

// RANDOM PUBLIC KEY
// 문자열을 뒤집고 각 문자 인덱스와 문자코드를 섞어 새로운 문자열 생성
function randomPublicKey(str) {
  return str
    .split('')
    .reverse()
    .map((ch, i) => {
      const n = (ch.charCodeAt(0) + i) % 10;
      return ch + n;
    })
    .join('');
}

// RANDOM PRIVATE KEY - IMPOLITE
// 각 문자의 charCode를 숫자로 바꾼 뒤 위치 인덱스를 섞어서 문자/숫자로 재매핑
function randomPrivateKeyImpolite(str) {
  return [...str]
    .map((ch, i) => {
      const code = ch.charCodeAt(0) + i;
      return i % 2 === 0
        ? String.fromCharCode((code % 26) + 97)
        : code % 10;
    })
    .join('');
}

// RANDOM PRIVATE KEY - POLITE
// 문자열 전체를 하나의 숫자로 누적 -> 누적값을 기준으로 각 자리 결정
function randomPrivateKeyPolite(str) {
  let seed = 0;

  for (const ch of str) {
    seed =
      (
        seed * 31 +
        ch.charCodeAt(0)
      ) >>> 0;
  }

  return Array.from(
    {
      length: 10,
    },
    (_, i) => {
      const v =
        (
          seed >>
          (i * 3)
        ) & 0xff;

      return i % 2 === 0
        ? String.fromCharCode(
            97 +
            (v % 26),
          )
        : v % 10;
    },
  ).join('');
}

function isNonEmptyInternalId(
  value,
) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 128
  );
}

async function applyInternalPairAssignment(
  ws,
  payload,
) {
  const metaBefore =
    localPeers.getMeta(
      ws,
    );

  if (
    !metaBefore ||
    ws.readyState !== ws.OPEN
  ) {
    return;
  }

  const {
    roomId,
    partnerPeerId,
  } = payload ?? {};

  if (
    !isNonEmptyInternalId(
      roomId,
    ) ||
    !isNonEmptyInternalId(
      partnerPeerId,
    ) ||
    partnerPeerId ===
      metaBefore.peerId
  ) {
    return;
  }

  let confirmedRoomId;

  try {
    confirmedRoomId =
      await roomMembership.arePartners(
        metaBefore.peerId,
        partnerPeerId,
      );
  } catch (error) {
    console.error(
      `[matchmaking] failed to verify pair for ${metaBefore.peerId}:`,
      error,
    );

    return;
  }

  const metaAfter =
    localPeers.getMeta(
      ws,
    );

  if (
    !metaAfter ||
    metaAfter.peerId !==
      metaBefore.peerId ||
    ws.readyState !== ws.OPEN ||
    confirmedRoomId !== roomId
  ) {
    return;
  }

  if (
    !localPeers.setRoomId(
      ws,
      roomId,
    )
  ) {
    return;
  }

  const resumeToken =
    await issueResumeToken({
      ws,

      peerId:
        metaBefore.peerId,

      roomId,

      role:
        'impolite',
    });

  if (!resumeToken) {
    return;
  }

  safeSend(
    ws,
    {
      type:
        'room-assigned',

      roomId,

      peerId:
        metaBefore.peerId,

      role:
        'impolite',

      pairedDataChannel:
        null,

      resumeToken,
    },
  );

  safeSend(
    ws,
    {
      type:
        'paired',

      roomId,

      you: {
        peerId:
          metaBefore.peerId,

        role:
          'impolite',
      },

      partner: {
        peerId:
          partnerPeerId,

        role:
          'polite',
      },
    },
  );
}

function deliverPeerPayload(
  ws,
  payload,
) {
  if (
    payload?.type ===
    INTERNAL_PAIR_ASSIGNMENT
  ) {
    void applyInternalPairAssignment(
      ws,
      payload,
    );

    return;
  }

  safeSend(
    ws,
    payload,
  );
}

function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function findWaitingRoom() {
  for (const id in ROOMS) {
    const room = ROOMS[id];

    if (
      room &&
      !room.lockAfterLeave &&
      room.clients.size === 1
    ) {
      return room;
    }
  }

  return null;
}

function createRoom() {
  const id = makeRoomId();

  ROOMS[id] = {
    id,
    clients: new Map(),
    keypair: keypairCode(id),
  };

  return ROOMS[id];
}

function createRoomWithId(roomId) {
  ROOMS[roomId] = {
    id: roomId,
    clients: new Map(),
    keypair: keypairCode(roomId),
    paired: true,
    lockAfterLeave: true,
  };

  return ROOMS[roomId];
}

function broadcast(room, obj) {
  for (
    const [, sock]
    of room.clients
  ) {
    safeSend(
      sock,
      obj,
    );
  }
}

// function attachToRoom(ws, meta, room, pairedDataChannel) {
function attachToRoom(params) {
  const {
    ws,
    meta,
    room,
    pairedDataChannel,
  } = params;

  room.clients.set(
    meta.peerId,
    ws,
  );

  if (
    !localPeers.setRoomId(
      ws,
      room.id,
    )
  ) {
    throw new Error(
      `failed to assign room to peer ${meta.peerId}`,
    );
  }

  const role =
    room.clients.size === 1
      ? 'impolite'
      : 'polite';

  safeSend(
    ws,
    {
      type:
        'room-assigned',

      roomId:
        room.id,

      peerId:
        meta.peerId,

      role,

      pairedDataChannel,
    },
  );

  if (
    room.clients.size === 2
  ) {
    const peers =
      Array.from(
        room.clients.keys(),
      );

    const [
      impolitePeerId,
      politePeerId,
    ] = peers;

    for (
      const [
        id,
        sock,
      ]
      of room.clients
    ) {
      const partnerId =
        id === impolitePeerId
          ? politePeerId
          : impolitePeerId;

      const currentRole =
        id === impolitePeerId
          ? 'impolite'
          : 'polite';

      safeSend(
        sock,
        {
          type:
            'paired',

          roomId:
            room.id,

          you: {
            peerId:
              id,

            role:
              currentRole,
          },

          partner: {
            peerId:
              partnerId,

            role:
              currentRole ===
              'impolite'
                ? 'polite'
                : 'impolite',
          },
        },
      );
    }

    room.paired = true;

    if (
      room.lockAfterLeave
    ) {
      delete room[
        'lockAfterLeave'
      ];
    }
  }
}

async function handleJoin(
  ws,
  meta,
  msg,
) {
  const requested =
    typeof msg.roomHint ===
    'string'
      ? msg.roomHint
      : null;

  const params = {
    requested:
      typeof msg.roomHint ===
      'string'
        ? msg.roomHint
        : null,

    ws,

    meta,

    room:
      null,

    pairedDataChannel:
      null,
  };

  if (
    params.requested &&
    ROOMS[params.requested] &&
    ROOMS[
      params.requested
    ].clients.size < 2
  ) {
    params.room =
      ROOMS[
        params.requested
      ];

    attachToRoom(
      params,
    );

    return;
  }

  if (
    params.requested &&
    TOMBSTONES.has(
      params.requested,
    )
  ) {
    TOMBSTONES.delete(
      params.requested,
    );

    params.room =
      createRoomWithId(
        params.requested,
      );

    params.pairedDataChannel =
      true;

    attachToRoom(
      params,
    );

    return;
  }

  await handleFreshJoin(
    ws,
    meta,
  );
}

async function handleFreshJoin(
  ws,
  meta,
) {
  const MAX_MATCH_ATTEMPTS =
    3;

  for (
    let attempt = 0;
    attempt <
    MAX_MATCH_ATTEMPTS;
    attempt += 1
  ) {
    let result;

    try {
      result =
        await matchmaker.match({
          peerId:
            meta.peerId,

          proposedRoomId:
            randomUUID(),
        });
    } catch (error) {
      console.error(
        `[matchmaking] failed for peer ${meta.peerId}:`,
        error,
      );

      if (
        ws.readyState ===
        ws.OPEN
      ) {
        ws.close(
          1011,
          'matchmaking unavailable',
        );
      }

      return;
    }

    if (
      shuttingDown ||
      ws.readyState !==
      ws.OPEN
    ) {
      if (
        result.status ===
        'waiting'
      ) {
        await cancelPeerWaiting(
          meta.peerId,
        );
      }

      if (
        result.status ===
        'paired'
      ) {
        try {
          await matchmaker.rollbackPair({
            roomId:
              result.roomId,

            peerId:
              meta.peerId,

            partnerPeerId:
              result.partnerPeerId,
          });
        } catch (error) {
          console.error(
            `[matchmaking] failed to rollback room ${result.roomId}:`,
            error,
          );
        }
      }

      return;
    }

    if (
      result.status ===
      'waiting'
    ) {
      return;
    }

    if (
      result.status ===
      'collision'
    ) {
      continue;
    }

    if (
      result.status ===
      'unavailable'
    ) {
      ws.close(
        1011,
        'matchmaking unavailable',
      );

      return;
    }

    if (
      result.status ===
      'existing'
    ) {
      console.error(
        `[matchmaking] unexpected existing room for fresh peer ${meta.peerId}`,
      );

      ws.close(
        1011,
        'invalid matchmaking state',
      );

      return;
    }

    if (
      result.status !==
      'paired'
    ) {
      ws.close(
        1011,
        'invalid matchmaking result',
      );

      return;
    }

    let delivery;

    try {
      delivery =
        await peerMessenger.send({
          targetPeerId:
            result.partnerPeerId,

          payload: {
            type:
              INTERNAL_PAIR_ASSIGNMENT,

            roomId:
              result.roomId,

            partnerPeerId:
              meta.peerId,
          },
        });
    } catch (error) {
      console.error(
        `[matchmaking] failed to route pair ${result.roomId}:`,
        error,
      );

      delivery = {
        accepted:
          false,
      };
    }

    if (
      !delivery.accepted
    ) {
      try {
        await matchmaker.rollbackPair({
          roomId:
            result.roomId,

          peerId:
            meta.peerId,

          partnerPeerId:
            result.partnerPeerId,
        });
      } catch (error) {
        console.error(
          `[matchmaking] failed to rollback room ${result.roomId}:`,
          error,
        );

        ws.close(
          1011,
          'matchmaking cleanup failed',
        );

        return;
      }

      continue;
    }

    if (
      shuttingDown ||
      ws.readyState !==
      ws.OPEN
    ) {
      return;
    }

    if (
      !localPeers.setRoomId(
        ws,
        result.roomId,
      )
    ) {
      console.error(
        `[matchmaking] failed to assign local room for ${meta.peerId}`,
      );

      ws.close(
        1011,
        'matchmaking state unavailable',
      );

      return;
    }

    const resumeToken =
      await issueResumeToken({
        ws,

        peerId:
          meta.peerId,

        roomId:
          result.roomId,

        role:
          'polite',
      });

    if (!resumeToken) {
      return;
    }

    safeSend(
      ws,
      {
        type:
          'room-assigned',

        roomId:
          result.roomId,

        peerId:
          meta.peerId,

        role:
          'polite',

        pairedDataChannel:
          null,

        resumeToken,
      },
    );

    safeSend(
      ws,
      {
        type:
          'paired',

        roomId:
          result.roomId,

        you: {
          peerId:
            meta.peerId,

          role:
            'polite',
        },

        partner: {
          peerId:
            result.partnerPeerId,

          role:
            'impolite',
        },
      },
    );

    return;
  }

  if (
    ws.readyState ===
    ws.OPEN
  ) {
    ws.close(
      1011,
      'matchmaking collision',
    );
  }
}

async function cancelPeerWaiting(
  peerId,
) {
  try {
    await matchmaker.cancelWaiting(
      peerId,
    );
  } catch (error) {
    console.error(
      `[matchmaking] failed to cancel waiting peer ${peerId}:`,
      error,
    );
  }
}

async function registerPeerIdentity(
  ws,
  peerId,
) {
  if (shuttingDown) {
    return null;
  }

  try {
    await peerDirectory.register(
      peerId,
    );

    if (
      shuttingDown ||
      ws.readyState !==
      ws.OPEN
    ) {
      try {
        await peerDirectory.unregister(
          peerId,
        );
      } catch (error) {
        console.error(
          `[presence] failed to clean up peer ${peerId}:`,
          error,
        );
      }

      return null;
    }

    const meta =
      localPeers.register(
        ws,
        peerId,
      );

    activePeerIds.add(
      peerId,
    );

    return meta;
  } catch (error) {
    activePeerIds.delete(
      peerId,
    );

    localPeers.remove(
      ws,
    );

    try {
      await peerDirectory.unregister(
        peerId,
      );
    } catch (cleanupError) {
      console.error(
        `[presence] failed to clean up peer ${peerId}:`,
        cleanupError,
      );
    }

    console.error(
      `[presence] failed to register peer ${peerId}:`,
      error,
    );

    if (
      ws.readyState ===
      ws.OPEN
    ) {
      ws.close(
        1011,
        'presence unavailable',
      );
    }

    return null;
  }
}

function cleanupLegacyRoom(
  meta,
) {
  if (!meta) {
    return;
  }

  const {
    peerId,
    roomId,
  } = meta;

  const room =
    ROOMS[
      roomId
    ];

  if (!room) {
    return;
  }

  if (
    room.clients.size ===
    2
  ) {
    room.clients.delete(
      peerId,
    );

    broadcast(
      room,
      {
        type:
          'partner-left',

        roomId,

        peerId,
      },
    );

    room.lockAfterLeave =
      true;

    return;
  }

  if (
    room.clients.size ===
    1
  ) {
    if (room.paired) {
      room.lockAfterLeave =
        true;

      TOMBSTONES.set(
        roomId,
        roomId,
      );
    }

    room.clients.delete(
      peerId,
    );

    delete ROOMS[
      roomId
    ];
  }
}

function isLegacyConnection(
  meta,
) {
  if (
    !meta ||
    !meta.roomId
  ) {
    return false;
  }

  return Boolean(
    ROOMS[
      meta.roomId
    ],
  );
}

async function cleanupConnection(
  ws,
  joinTask,
) {
  /*
   * resume/fresh join이 아직 진행 중인 상태에서
   * close cleanup이 먼저 claim/presence를 건드리면
   * 동일 peerId의 상태가 뒤엉킬 수 있다.
   *
   * 반드시 해당 connection의 join 작업부터 끝낸다.
   */
  if (joinTask) {
    await Promise.allSettled([
      joinTask,
    ]);
  }

  const initialMeta =
    localPeers.getMeta(
      ws,
    );

  const initialPeerId =
    initialMeta?.peerId ??
    null;

  const legacyConnection =
    isLegacyConnection(
      initialMeta,
    );

  /*
   * cleanupLegacyRoom()이 ROOMS entry를 삭제할 수 있으므로
   * 그 전에 legacy 여부를 저장해 둔다.
   */
  if (
    legacyConnection &&
    initialPeerId
  ) {
    legacyDisconnectPeerIds.add(
      initialPeerId,
    );
  }

  /*
   * 기존 legacy ROOMS cleanup은 정확히 한 번만 실행한다.
   */
  cleanupLegacyRoom(
    initialMeta,
  );

  let attempt =
    0;

  try {
    while (true) {
      attempt +=
        1;

      try {
        await resumeSocketLifecycle.cleanup(
          ws,
        );

        return;
      } catch (error) {
        /*
         * scheduleDisconnect() 실패는 fail-closed이므로
         * local identity가 그대로 남는다.
         *
         * 반대로 durable schedule 이후 단계에서 오류가
         * 발생했다면 local identity는 이미 제거되었을
         * 가능성이 높고, 같은 cleanup 전체를 다시 실행하면
         * 안 된다.
         */
        const remainingMeta =
          localPeers.getMeta(
            ws,
          );

        if (!remainingMeta) {
          console.error(
            '[connection] cleanup failed after local identity removal:',
            error,
          );

          return;
        }

        console.error(
          `[connection] durable cleanup attempt ${attempt} failed for peer ${remainingMeta.peerId}; retrying:`,
          error,
        );

        await waitForConnectionCleanupRetry();
      }
    }
  } finally {
    if (
      initialPeerId
    ) {
      legacyDisconnectPeerIds.delete(
        initialPeerId,
      );

      disconnectDeadlines.delete(
        initialPeerId,
      );
    }
  }
}

function trackConnectionCleanup(
  task,
) {
  connectionCleanupTasks.add(
    task,
  );

  void task.then(
    () => {
      connectionCleanupTasks.delete(
        task,
      );
    },
    (error) => {
      connectionCleanupTasks.delete(
        task,
      );

      console.error(
        '[connection] unhandled cleanup failure:',
        error,
      );
    },
  );
}

async function waitForConnectionCleanups() {
  while (
    connectionCleanupTasks.size >
    0
  ) {
    await Promise.allSettled(
      Array.from(
        connectionCleanupTasks,
      ),
    );
  }
}

function cbConnection(ws, req) {
  let joinStarted =
    false;

  let peerActivation =
    null;

  let joinTask =
    null;

  let cleanupStarted =
    false;

  function activateFreshPeer() {
    if (
      peerActivation !== null
    ) {
      return peerActivation;
    }

    const peerId =
      randomUUID();

    peerActivation =
      registerPeerIdentity(
        ws,
        peerId,
      );

    return peerActivation;
  }

  async function runJoin(
    msg,
  ) {
    const hasResumeToken =
      Object.prototype
        .hasOwnProperty.call(
          msg,
          'resumeToken',
        );

    if (hasResumeToken) {
      await handleResumeJoin(
        ws,
        msg.resumeToken,
      );

      return;
    }

    const meta =
      await activateFreshPeer();

    if (
      !meta ||
      shuttingDown ||
      ws.readyState !==
      ws.OPEN
    ) {
      return;
    }

    try {
      await handleJoin(
        ws,
        meta,
        msg,
      );
    } catch (error) {
      console.error(
        `[join] failed for peer ${meta.peerId}:`,
        error,
      );

      if (
        ws.readyState ===
        ws.OPEN
      ) {
        ws.close(
          1011,
          'join failed',
        );
      }
    }
  }

  ws.on(
    'message',
    async (buf) => {
      let msg;

      try {
        msg =
          JSON.parse(
            buf.toString(),
          );
      } catch {
        return;
      }

      if (
        msg?.type ===
        'join'
      ) {
        if (joinStarted) {
          return;
        }

        joinStarted =
          true;

        joinTask =
          runJoin(
            msg,
          );

        await joinTask;

        return;
      }

      const meta =
        localPeers.getMeta(
          ws,
        );

      if (!meta) {
        return;
      }

      if (
        msg?.type ===
          'signal' &&
        msg?.to
      ) {
        let roomId;

        try {
          roomId =
            await roomMembership.arePartners(
              meta.peerId,
              msg.to,
            );
        } catch (error) {
          console.error(
            `[signal] failed to verify peers ${meta.peerId} -> ${msg.to}:`,
            error,
          );

          return;
        }

        if (!roomId) {
          return;
        }

        if (
          meta.roomId !==
          roomId
        ) {
          console.error(
            `[signal] local room mismatch for peer ${meta.peerId}`,
          );

          return;
        }

        let delivery;

        try {
          delivery =
            await peerMessenger.send({
              targetPeerId:
                msg.to,

              payload: {
                type:
                  'signal',

                from:
                  meta.peerId,

                data:
                  msg.data,
              },
            });
        } catch (error) {
          console.error(
            `[signal] failed to route ${meta.peerId} -> ${msg.to}:`,
            error,
          );

          return;
        }

        if (
          !delivery.accepted
        ) {
          console.warn(
            `[signal] target unavailable ${meta.peerId} -> ${msg.to}`,
          );
        }

        return;
      }

      if (
        msg?.type ===
          'requestStorage' &&
        msg?.gameName &&
        msg?.initRole
      ) {
        const room =
          ROOMS[
            meta.roomId
          ];

        if (!room) {
          return;
        }

        const localPeer =
          room.clients.get(
            meta.peerId,
          );

        if (localPeer) {
          const transformedKeypair =
            transformRoomId(
              room.keypair,
            );

          const keypair = {
            public:
              randomPublicKey(
                transformedKeypair,
              ),

            private: {
              impolite:
                randomPrivateKeyImpolite(
                  transformedKeypair,
                ).slice(
                  -10,
                ),

              polite:
                randomPrivateKeyPolite(
                  transformedKeypair,
                ).slice(
                  -10,
                ),
            },
          };

          const STORAGE_DATA =
            await MAKE_STORAGE.findGame(
              msg.gameName,
              keypair,
              msg.initRole,
            );

          safeSend(
            localPeer,
            {
              type:
                'responseStorage',

              storageData:
                STORAGE_DATA,

              keypair: {
                puk:
                  keypair.public,

                prk:
                  msg.initRole ===
                  'impolite'
                    ? keypair
                        .private
                        .impolite
                    : keypair
                        .private
                        .polite,
              },
            },
          );
        }
      }
    },
  );

  ws.on(
    'close',
    () => {
      if (cleanupStarted) {
        return;
      }

      cleanupStarted =
        true;

      const cleanupTask =
        cleanupConnection(
          ws,
          joinTask,
        );

      trackConnectionCleanup(
        cleanupTask,
      );
    },
  );
}

wss.on(
  'connection',
  cbConnection,
);

function listenHttpServer() {
  return new Promise(
    (resolve, reject) => {
      function onError(error) {
        server.off(
          'listening',
          onListening,
        );

        reject(
          error,
        );
      }

      function onListening() {
        server.off(
          'error',
          onError,
        );

        resolve();
      }

      server.once(
        'error',
        onError,
      );

      server.once(
        'listening',
        onListening,
      );

      server.listen(
        config.rtcPort,
        config.rtcHost,
      );
    },
  );
}

async function startServer() {
  await redis.connect();

  await instanceRelay.start();

  console.log(
    `[redis] connected as ${redis.instanceId}`,
  );

  console.log(
    `[redis] instance channel ${redis.instanceChannel}`,
  );

  await listenHttpServer();

  console.log(
    `Server is running on http://${config.rtcHost}:${config.rtcPort}`,
    process.pid,
  );

  startPresenceRefresh();

  startRoomCleanupSweep();

  resumeClaimManager.start();
}

async function cancelAllWaitingPeers() {
  const peerIds =
    Array.from(
      activePeerIds,
    );

  await Promise.allSettled(
    peerIds.map(
      (peerId) =>
        matchmaker.cancelWaiting(
          peerId,
        ),
    ),
  );
}

async function unregisterAllPeers() {
  const peerIds =
    Array.from(
      activePeerIds,
    );

  await Promise.allSettled(
    peerIds.map(
      (peerId) =>
        peerDirectory.unregister(
          peerId,
        ),
    ),
  );

  activePeerIds.clear();
}

async function closeWebSocketServer() {
  const closed =
    new Promise(
      (resolve) => {
        wss.close(
          () => {
            resolve();
          },
        );
      },
    );

  for (
    const ws
    of wss.clients
  ) {
    ws.close(
      1012,
      'server restart',
    );
  }

  let forceCloseTimer;

  const forceClose =
    new Promise(
      (resolve) => {
        forceCloseTimer =
          setTimeout(
            () => {
              for (
                const ws
                of wss.clients
              ) {
                ws.terminate();
              }

              resolve();
            },
            5_000,
          );
      },
    );

  await Promise.race([
    closed,
    forceClose,
  ]);

  clearTimeout(
    forceCloseTimer,
  );

  for (
    const ws
    of wss.clients
  ) {
    ws.terminate();
  }

  await closed;

  /*
   * 'close' event에서 시작된 Redis cleanup은 async이므로
   * WebSocketServer가 닫힌 것만으로 끝난 것이 아니다.
   *
   * identity/presence/claim cleanup까지 모두 기다린다.
   *
   * durable room cleanup 예약이 Redis 장애로 실패하면
   * cleanup task 자체가 retry 상태에 머무르므로
   * graceful shutdown 역시 그 durable handoff가
   * 성공하거나 stale owner로 판정될 때까지 기다린다.
   */
  await waitForConnectionCleanups();
}

async function closeHttpServer() {
  if (
    !server.listening
  ) {
    return;
  }

  await new Promise(
    (resolve) => {
      server.close(
        () => {
          resolve();
        },
      );
    },
  );
}

async function shutdown(
  signal,
) {
  if (shuttingDown) {
    return;
  }

  shuttingDown =
    true;

  console.log(
    `[shutdown] ${signal}`,
  );

  stopPresenceRefresh();

  stopRoomCleanupSweep();

  /*
   * 아직 resumeClaimManager.stop()을 호출하지 않는다.
   *
   * socket cleanup이 진행되는 동안 claim refresh가
   * 성공할 수 있는 환경이라면 계속 lease를 유지한다.
   *
   * Redis refresh 자체가 실패하면 claim manager는
   * 해당 claim을 lost 상태로 전환하지만,
   * local identity는 durable cleanup이 완료될 때까지
   * 그대로 보존되고 presence fencing이 stale instance의
   * 늦은 cleanup을 차단한다.
   */

  try {
    await cancelAllWaitingPeers();

    /*
     * 모든 socket을 닫고,
     * 각 socket의 join 작업과 async durable cleanup까지
     * 기다린다.
     */
    await closeWebSocketServer();

    /*
     * 정상적으로는 lifecycle cleanup이 모두 제거했으므로
     * activePeerIds가 비어 있어야 한다.
     *
     * durable schedule 이후의 비핵심 cleanup 오류가
     * 있었던 경우에만 fallback 역할을 한다.
     */
    await unregisterAllPeers();

    /*
     * identity/presence cleanup barrier를 통과했으므로
     * 이제 claim refresh timer를 중지한다.
     */
    resumeClaimManager.stop();

    await instanceRelay.stop();

    await closeHttpServer();
  } catch (error) {
    console.error(
      '[shutdown] error:',
      error,
    );
  } finally {
    /*
     * 예외 경로에서도 현재 등록된 cleanup task가
     * 있다면 먼저 끝까지 기다린다.
     */
    try {
      await waitForConnectionCleanups();
    } catch (error) {
      console.error(
        '[shutdown] connection cleanup error:',
        error,
      );
    }

    resumeClaimManager.stop();

    /*
     * 정상 lifecycle에서 release되지 못하고
     * claim-manager에 아직 남아 있는 claim의
     * 최종 안전망.
     */
    await resumeClaimManager.releaseAll();

    redis.disconnect();
  }
}

process.on(
  'SIGTERM',
  () => {
    void shutdown(
      'SIGTERM',
    );
  },
);

process.on(
  'SIGINT',
  () => {
    void shutdown(
      'SIGINT',
    );
  },
);

void startServer().catch(
  async (error) => {
    console.error(
      '[startup] failed:',
      error,
    );

    stopPresenceRefresh();

    stopRoomCleanupSweep();

    resumeClaimManager.stop();

    try {
      await instanceRelay.stop();
    } catch (relayError) {
      console.error(
        '[relay] failed to stop:',
        relayError,
      );
    }

    redis.disconnect();

    process.exitCode = 1;
  },
);
