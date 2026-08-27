import assert from 'node:assert/strict';

import {
  createPeerMessenger,
} from '../src/server/peerMessenger.js';

let passed = 0;

async function test(
  name,
  fn,
) {
  try {
    await fn();

    passed += 1;

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

function createContext({
  localSocket = null,
  targetInstanceId = null,
  subscribers = 1,
} = {}) {
  const delivered = [];
  const relayed = [];

  const messenger =
    createPeerMessenger({
      instanceId:
        'signaling-a',

      localPeers: {
        getSocket() {
          return localSocket;
        },
      },

      peerDirectory: {
        async findInstance() {
          return targetInstanceId;
        },
      },

      relay: {
        async sendToInstance(
          message,
        ) {
          relayed.push(
            message,
          );

          return subscribers;
        },
      },

      deliver(
        socket,
        payload,
      ) {
        delivered.push({
          socket,
          payload,
        });
      },
    });

  return {
    messenger,
    delivered,
    relayed,
  };
}

await test(
  'deliver to local peer',
  async () => {
    const socket = {};

    const context =
      createContext({
        localSocket: socket,
      });

    const result =
      await context.messenger.send({
        targetPeerId:
          'peer-b',

        payload: {
          type: 'signal',
        },
      });

    assert.deepEqual(
      result,
      {
        accepted: true,
        route: 'local',
      },
    );

    assert.equal(
      context.delivered.length,
      1,
    );

    assert.equal(
      context.delivered[0].socket,
      socket,
    );

    assert.equal(
      context.relayed.length,
      0,
    );
  },
);

await test(
  'report missing peer',
  async () => {
    const context =
      createContext({
        targetInstanceId:
          null,
      });

    assert.deepEqual(
      await context.messenger.send({
        targetPeerId:
          'missing',

        payload: {
          type: 'signal',
        },
      }),
      {
        accepted: false,
        route: 'missing',
      },
    );

    assert.equal(
      context.relayed.length,
      0,
    );
  },
);

await test(
  'detect stale local presence',
  async () => {
    const context =
      createContext({
        targetInstanceId:
          'signaling-a',
      });

    assert.deepEqual(
      await context.messenger.send({
        targetPeerId:
          'peer-b',

        payload: {
          type: 'signal',
        },
      }),
      {
        accepted: false,
        route: 'stale-local',
      },
    );

    assert.equal(
      context.relayed.length,
      0,
    );
  },
);

await test(
  'relay to remote instance',
  async () => {
    const context =
      createContext({
        targetInstanceId:
          'signaling-b',

        subscribers: 1,
      });

    const payload = {
      type: 'signal',
      from: 'peer-a',

      data: {
        sdp: 'offer',
      },
    };

    const result =
      await context.messenger.send({
        targetPeerId:
          'peer-b',
        payload,
      });

    assert.deepEqual(
      result,
      {
        accepted: true,
        route: 'remote',
        targetInstanceId:
          'signaling-b',
        subscribers: 1,
      },
    );

    assert.deepEqual(
      context.relayed,
      [
        {
          targetInstanceId:
            'signaling-b',

          targetPeerId:
            'peer-b',

          payload,
        },
      ],
    );
  },
);

await test(
  'report remote instance without subscriber',
  async () => {
    const context =
      createContext({
        targetInstanceId:
          'signaling-b',

        subscribers: 0,
      });

    const result =
      await context.messenger.send({
        targetPeerId:
          'peer-b',

        payload: {
          type: 'signal',
        },
      });

    assert.equal(
      result.accepted,
      false,
    );

    assert.equal(
      result.route,
      'remote',
    );

    assert.equal(
      result.subscribers,
      0,
    );
  },
);

await test(
  'reject invalid payload',
  async () => {
    const context =
      createContext();

    await assert.rejects(
      async () => {
        await context.messenger.send({
          targetPeerId:
            'peer-b',
          payload: null,
        });
      },
      /payload/,
    );
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);