import assert from 'node:assert/strict';
import {
  EventEmitter,
} from 'node:events';

import {
  createInstanceRelay,
  parseRelayMessage,
} from '../src/server/instanceRelay.js';

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

function createFakeRedis() {
  const subscriber =
    new EventEmitter();

  subscriber.subscribed =
    new Set();

  subscriber.subscribe =
    async (channel) => {
      subscriber.subscribed.add(
        channel,
      );

      return 1;
    };

  subscriber.unsubscribe =
    async (channel) => {
      subscriber.subscribed.delete(
        channel,
      );

      return 0;
    };

  const published = [];

  const publisher = {
    async publish(
      channel,
      message,
    ) {
      published.push({
        channel,
        message,
      });

      return 1;
    },
  };

  return {
    instanceChannel:
      'bt:test:instance:a',

    subscriber,
    publisher,
    published,
  };
}

await test(
  'parse valid relay message',
  async () => {
    const parsed =
      parseRelayMessage(
        JSON.stringify({
          type:
            'peer-message',

          targetPeerId:
            'peer-1',

          payload: {
            type: 'signal',
            data: {
              sdp: 'test',
            },
          },
        }),
      );

    assert.equal(
      parsed.ok,
      true,
    );

    assert.equal(
      parsed.value.targetPeerId,
      'peer-1',
    );
  },
);

await test(
  'reject invalid json',
  async () => {
    assert.deepEqual(
      parseRelayMessage('{'),
      {
        ok: false,
        error: 'invalid_json',
      },
    );
  },
);

await test(
  'reject invalid target peer',
  async () => {
    const parsed =
      parseRelayMessage(
        JSON.stringify({
          type:
            'peer-message',

          targetPeerId: '',

          payload: {},
        }),
      );

    assert.deepEqual(
      parsed,
      {
        ok: false,
        error:
          'invalid_target_peer_id',
      },
    );
  },
);

await test(
  'publish to target instance channel',
  async () => {
    const redisContext =
      createFakeRedis();

    const relay =
      createInstanceRelay({
        redisContext,
        keyPrefix:
          'bt:test',

        peerRegistry: {
          getSocket() {
            return null;
          },
        },

        deliver() {},
      });

    const subscribers =
      await relay.sendToInstance({
        targetInstanceId:
          'b',

        targetPeerId:
          'peer-b',

        payload: {
          type: 'signal',
          from: 'peer-a',
          data: {
            candidate: null,
          },
        },
      });

    assert.equal(
      subscribers,
      1,
    );

    assert.equal(
      redisContext
        .published[0]
        .channel,
      'bt:test:instance:b',
    );

    const message =
      JSON.parse(
        redisContext
          .published[0]
          .message,
      );

    assert.equal(
      message.targetPeerId,
      'peer-b',
    );

    assert.equal(
      message.payload.type,
      'signal',
    );
  },
);

await test(
  'deliver message to local socket',
  async () => {
    const redisContext =
      createFakeRedis();

    const ws = {
      name: 'socket-b',
    };

    let delivered = null;

    const relay =
      createInstanceRelay({
        redisContext,
        keyPrefix:
          'bt:test',

        peerRegistry: {
          getSocket(peerId) {
            if (
              peerId === 'peer-b'
            ) {
              return ws;
            }

            return null;
          },
        },

        deliver(
          socket,
          payload,
        ) {
          delivered = {
            socket,
            payload,
          };
        },
      });

    await relay.start();

    redisContext
      .subscriber
      .emit(
        'message',

        redisContext
          .instanceChannel,

        JSON.stringify({
          type:
            'peer-message',

          targetPeerId:
            'peer-b',

          payload: {
            type: 'signal',
            from: 'peer-a',
            data: {
              sdp: 'offer',
            },
          },
        }),
      );

    assert.equal(
      delivered.socket,
      ws,
    );

    assert.equal(
      delivered.payload.type,
      'signal',
    );

    assert.equal(
      delivered.payload.from,
      'peer-a',
    );

    await relay.stop();
  },
);

await test(
  'ignore unknown local peer',
  async () => {
    const redisContext =
      createFakeRedis();

    let delivered = false;

    const relay =
      createInstanceRelay({
        redisContext,
        keyPrefix:
          'bt:test',

        peerRegistry: {
          getSocket() {
            return null;
          },
        },

        deliver() {
          delivered = true;
        },
      });

    await relay.start();

    redisContext
      .subscriber
      .emit(
        'message',

        redisContext
          .instanceChannel,

        JSON.stringify({
          type:
            'peer-message',

          targetPeerId:
            'missing',

          payload: {
            type: 'signal',
          },
        }),
      );

    assert.equal(
      delivered,
      false,
    );

    await relay.stop();
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);