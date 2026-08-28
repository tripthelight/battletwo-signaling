import express from 'express';
import http from 'http';
import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';

import { config } from './config.js';
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
  createResumeSessionStore,
} from './resumeSession.js';
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

const INTERNAL_PAIR_ASSIGNMENT =
  '__internal-pair-assignment';

const ROOM_CLEANUP_SWEEP_MS =
  1_000;

const ROOM_CLEANUP_BATCH_SIZE =
  100;

const activePeerIds =
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
    roomCleanupTimer === null
  ) {
    return;
  }

  clearInterval(
    roomCleanupTimer,
  );

  roomCleanupTimer =
    null;
}

async function schedulePeerDisconnect(
  peerId,
) {
  try {
    const roomId =
      await roomMembership.scheduleDisconnect({
        peerId,

        dueAtMs:
          Date.now() +
          config.resumeSessionTtlMs,
      });

    if (!roomId) {
      return;
    }

    console.log(
      `[room-cleanup] scheduled room ${roomId} for disconnected peer ${peerId}`,
    );
  } catch (error) {
    console.error(
      `[room-cleanup] failed to schedule disconnected peer ${peerId}:`,
      error,
    );
  }
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

function cbConnection(ws, req) {
  let joinStarted =
    false;

  let peerActivation =
    null;

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
      const meta =
        localPeers.getMeta(
          ws,
        );

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

      if (room) {
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
        } else if (
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

      /*
       * Redis 기반 신규 room인 경우:
       *
       * 실제 room/peer-room은 지금 삭제하지 않고
       * resumeSessionTtlMs만큼 grace를 둔다.
       *
       * waiting peer나 legacy room이면
       * scheduleDisconnect()가 null을 반환하므로
       * Redis room cleanup에는 영향을 주지 않는다.
       */
      void schedulePeerDisconnect(
        peerId,
      );

      localPeers.remove(
        ws,
      );

      activePeerIds.delete(
        peerId,
      );

      void cancelPeerWaiting(
        peerId,
      );

      void peerDirectory
        .unregister(
          peerId,
        )
        .catch(
          (error) => {
            console.error(
              `[presence] failed to unregister peer ${peerId}:`,
              error,
            );
          },
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

  resumeClaimManager.stop();

  try {
    await cancelAllWaitingPeers();

    await unregisterAllPeers();

    await closeWebSocketServer();

    await instanceRelay.stop();

    await closeHttpServer();
  } catch (error) {
    console.error(
      '[shutdown] error:',
      error,
    );
  } finally {
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
