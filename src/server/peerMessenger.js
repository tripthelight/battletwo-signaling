function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function assertPeerId(peerId) {
  if (
    typeof peerId !== 'string' ||
    peerId.length === 0 ||
    peerId.length > 128
  ) {
    throw new TypeError(
      'targetPeerId must be a non-empty string',
    );
  }
}

export function createPeerMessenger({
  localPeers,
  peerDirectory,
  relay,
  instanceId,
  deliver,
}) {
  if (
    !localPeers ||
    typeof localPeers.getSocket !==
      'function'
  ) {
    throw new TypeError(
      'localPeers is required',
    );
  }

  if (
    !peerDirectory ||
    typeof peerDirectory.findInstance !==
      'function'
  ) {
    throw new TypeError(
      'peerDirectory is required',
    );
  }

  if (
    !relay ||
    typeof relay.sendToInstance !==
      'function'
  ) {
    throw new TypeError(
      'relay is required',
    );
  }

  if (
    typeof instanceId !== 'string' ||
    instanceId.length === 0
  ) {
    throw new TypeError(
      'instanceId is required',
    );
  }

  if (
    typeof deliver !== 'function'
  ) {
    throw new TypeError(
      'deliver must be a function',
    );
  }

  async function send({
    targetPeerId,
    payload,
  }) {
    assertPeerId(
      targetPeerId,
    );

    if (!isPlainObject(payload)) {
      throw new TypeError(
        'payload must be an object',
      );
    }

    const localSocket =
      localPeers.getSocket(
        targetPeerId,
      );

    if (localSocket) {
      deliver(
        localSocket,
        payload,
      );

      return {
        accepted: true,
        route: 'local',
      };
    }

    const targetInstanceId =
      await peerDirectory.findInstance(
        targetPeerId,
      );

    if (targetInstanceId === null) {
      return {
        accepted: false,
        route: 'missing',
      };
    }

    if (
      targetInstanceId ===
      instanceId
    ) {
      return {
        accepted: false,
        route: 'stale-local',
      };
    }

    const subscribers =
      await relay.sendToInstance({
        targetInstanceId,
        targetPeerId,
        payload,
      });

    return {
      accepted:
        subscribers > 0,

      route: 'remote',

      targetInstanceId,
      subscribers,
    };
  }

  return Object.freeze({
    send,
  });
}