import express from 'express';
import http from 'http';
import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';

import { config } from './config.js';
import { MAKE_STORAGE } from './functions/encryption/makeStorage.js';
import { localPeers } from './state/localPeers.js';

const app = express();

const server = http.createServer(app);

const wss = new WebSocketServer({
  server,
  maxPayload: config.maxPayloadBytes,
});

server.listen(
  config.rtcPort,
  config.rtcHost,
  () => {
    console.log(
      `Server is running on http://${config.rtcHost}:${config.rtcPort}`,
      process.pid,
    );
  },
);

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
        ? String.fromCharCode((code % 26) + 97) // a-z
        : code % 10; // 0-9
    })
    .join('');
}
// RANDOM PRIVATE KEY - POLITE
// 문자열 전체를 하나의 숫자로 누적 -> 누적값을 기준으로 각 자리 결정
function randomPrivateKeyPolite(str) {
  let seed = 0;
  for (const ch of str) {
    seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  }

  return Array.from({ length: 10 }, (_, i) => {
    const v = (seed >> (i * 3)) & 0xff;
    return i % 2 === 0 ? String.fromCharCode(97 + (v % 26)) : v % 10;
  }).join('');
}

function safeSend(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}
function findWaitingRoom() {
  for (const id in ROOMS) {
    const room = ROOMS[id];
    if (room && !room.lockAfterLeave && room.clients.size === 1) {
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
  for (const [, sock] of room.clients) {
    safeSend(sock, obj);
  }
}

// function attachToRoom(ws, meta, room, pairedDataChannel) {
function attachToRoom(params) {
  const { ws, meta, room, pairedDataChannel } = params;
  room.clients.set(meta.peerId, ws);

  if (!localPeers.setRoomId(ws, room.id)) {
    throw new Error(
      `failed to assign room to peer ${meta.peerId}`,
    );
  }

  // 역할 부여
  const role = room.clients.size === 1 ? 'impolite' : 'polite';
  safeSend(ws, {
    type: 'room-assigned',
    roomId: room.id,
    peerId: meta.peerId,
    role,
    pairedDataChannel,
    // keypair: room.keypair
    //   .replace(/\s+/g, '') // 1. 띄어쓰기 제거
    //   .replace(/[^a-zA-Z0-9가-힣]/g, '') // 2. 특수문자 제거
    //   .slice(-10), // 3. 맨 뒤 10자리));,
  });

  if (room.clients.size === 2) {
    const peers = Array.from(room.clients.keys());
    const [impolitePeerId, politePeerId] = peers; // 먼저 들어온 순
    for (const [id, sock] of room.clients) {
      const partnerId = id === impolitePeerId ? politePeerId : impolitePeerId;
      const role = id === impolitePeerId ? 'impolite' : 'polite';
      safeSend(sock, {
        type: 'paired',
        roomId: room.id,
        // roomId: `${room.id}-${role === 'impolite' ? 'a' : 'b'}`,
        you: { peerId: id, role },
        partner: { peerId: partnerId, role: role === 'impolite' ? 'polite' : 'impolite' },
      });
    }
    room.paired = true;
    if (room.lockAfterLeave) {
      delete room['lockAfterLeave'];
    }
  }
}
function handleJoin(ws, meta, msg) {
  // msg: { type:'join', roomHint?: string }
  const requested = typeof msg.roomHint === 'string' ? msg.roomHint : null;

  const params = {
    requested: typeof msg.roomHint === 'string' ? msg.roomHint : null,
    ws: ws,
    meta: meta,
    room: null,
    pairedDataChannel: null,
  };

  // - 한 peer가 처음 진입 후 새로고침 - requested 있음
  // - 두 peer 연결된 후 한 peer가 새로고침 - requested 있음
  // - 두 peer 연결된 후 두 peer가 새로고침 난타 - requested 있다없다
  // - 두 peer 연결된 후 한 peer가 나가고 남은 peer가 새로고침 - requested 있음

  // 1) roomHint가 있고, 그 방이 현재 살아있다면 그 방으로
  // 두 peer가 나가지 않은 상태에서 한 peer가 새로고침하면 새로고침 한 peer는 여기를 탐
  if (params.requested && ROOMS[params.requested] && ROOMS[params.requested].clients.size < 2) {
    // attachToRoom(ws, meta, ROOMS[requested]);
    params.room = ROOMS[params.requested];
    attachToRoom(params);
    return;
  }

  // 2) roomHint가 무덤에 있고(아직 TTL 안 지남) → 둘 다 나가서 ROOMS에서 방 삭제되었지만 → 방 부활
  if (params.requested && TOMBSTONES.has(params.requested)) {
    // 부활
    TOMBSTONES.delete(params.requested);
    // const revivedRoom = createRoomWithId(params.requested);
    // attachToRoom(ws, meta, revivedRoom, true);
    params.room = createRoomWithId(params.requested);
    params.pairedDataChannel = true;
    attachToRoom(params);
    return;
  }

  // 3) roomHint가 없거나, 사용할 수 없다면 "일반 매칭"
  // let room = findWaitingRoom();
  // if (!room) room = createRoom();
  // attachToRoom(ws, meta, room);
  params.room = findWaitingRoom();
  if (!params.room) params.room = createRoom();
  attachToRoom(params);
}

function cbConnection(ws, req) {
  const peerId = randomUUID();

  // "바로 배정"하지 않고, 클라의 'join' 메시지를 기다립니다.
  localPeers.register(ws, peerId);

  ws.on('message', async (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    const meta = localPeers.getMeta(ws);
    if (!meta) return;

    if (msg?.type === 'join') {
      // ★ 클라가 요청한 room 합류
      handleJoin(ws, meta, msg);
      return;
    }

    if (msg?.type === 'signal' && msg?.to) {
      const room = ROOMS[meta.roomId];
      if (!room) return;
      const target = room.clients.get(msg.to);
      if (target) {
        safeSend(target, { type: 'signal', from: meta.peerId, data: msg.data });
      }
      return;
    }

    if (msg?.type === 'requestStorage' && msg?.gameName && msg?.initRole) {
      const room = ROOMS[meta.roomId];
      if (!room) return;
      const localPeer = room.clients.get(meta.peerId);

      if (localPeer) {
        const keypairCode = transformRoomId(room.keypair);
        const keypair = {
          public: randomPublicKey(keypairCode),
          private: {
            impolite: randomPrivateKeyImpolite(keypairCode).slice(-10),
            polite: randomPrivateKeyPolite(keypairCode).slice(-10),
          },
        };
        // 각 게임에 필요한 암호화된 sessionStorage key 생성
        const STORAGE_DATA = await MAKE_STORAGE.findGame(msg.gameName, keypair, msg.initRole);
        safeSend(localPeer, {
          type: 'responseStorage',
          storageData: STORAGE_DATA,
          keypair: {
            puk: keypair.public,
            prk: msg.initRole === 'impolite' ? keypair.private.impolite : keypair.private.polite,
          },
          // keypair: keypair
          //   .replace(/\s+/g, '') // 1. 띄어쓰기 제거
          //   .replace(/[^a-zA-Z0-9가-힣]/g, '') // 2. 특수문자 제거
          //   .slice(-10), // 3. 맨 뒤 10자리));,,
        });
      }
    }
  });

  ws.on('close', () => {
    const meta = localPeers.getMeta(ws);
    if (!meta) return;
    const { peerId, roomId } = meta;
    const room = ROOMS[roomId];

    if (room) {
      if (room.clients.size === 2) {
        // 두 peer 모두 있음
        room.clients.delete(peerId);
        broadcast(room, { type: 'partner-left', roomId, peerId });
        room.lockAfterLeave = true;
      } else if (room.clients.size === 1) {
        if (room.paired) {
          // 이전에 연결된 적 있음
          room.lockAfterLeave = true;
          // TOMBSTONES.set(roomId, { roomId, expiredAt: now() + ROOM_TTL_MS, lastSeenAt: now() });
          TOMBSTONES.set(roomId, roomId);
        } else {
          // 내가 처음 진입하고 아직 상대 peer 없음
        }
        room.clients.delete(peerId);
        delete ROOMS[roomId];
      }
    }
    localPeers.remove(ws);
  });
}

wss.on('connection', cbConnection);
