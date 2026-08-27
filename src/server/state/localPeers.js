function assertSocket(ws) {
  if (
    ws === null ||
    (typeof ws !== 'object' &&
      typeof ws !== 'function')
  ) {
    throw new TypeError(
      'ws must be an object',
    );
  }
}

function assertPeerId(peerId) {
  if (
    typeof peerId !== 'string' ||
    peerId.length === 0 ||
    peerId.length > 128
  ) {
    throw new TypeError(
      'peerId must be a non-empty string',
    );
  }
}

export function createLocalPeers() {
  const socketMeta = new WeakMap();
  const peerSockets = new Map();

  function register(ws, peerId) {
    assertSocket(ws);
    assertPeerId(peerId);

    if (socketMeta.has(ws)) {
      throw new Error(
        'socket is already registered',
      );
    }

    if (peerSockets.has(peerId)) {
      throw new Error(
        'peerId is already registered',
      );
    }

    const meta = {
      peerId,
      roomId: null,
    };

    socketMeta.set(ws, meta);
    peerSockets.set(peerId, ws);

    return meta;
  }

  function getMeta(ws) {
    return socketMeta.get(ws) ?? null;
  }

  function setRoomId(ws, roomId) {
    const meta = socketMeta.get(ws);

    if (!meta) {
      return false;
    }

    meta.roomId = roomId ?? null;

    return true;
  }

  function getSocket(peerId) {
    return peerSockets.get(peerId) ?? null;
  }

  function hasPeer(peerId) {
    return peerSockets.has(peerId);
  }

  function remove(ws) {
    const meta = socketMeta.get(ws);

    if (!meta) {
      return null;
    }

    socketMeta.delete(ws);

    if (
      peerSockets.get(meta.peerId) === ws
    ) {
      peerSockets.delete(meta.peerId);
    }

    return {
      peerId: meta.peerId,
      roomId: meta.roomId,
    };
  }

  function size() {
    return peerSockets.size;
  }

  return Object.freeze({
    register,
    getMeta,
    setRoomId,
    getSocket,
    hasPeer,
    remove,
    size,
  });
}

export const localPeers =
  createLocalPeers();