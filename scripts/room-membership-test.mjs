import assert from 'node:assert/strict';

import {
  createRoomMembership,
  makePeerRoomKey,
  makeRoomKey,
} from '../src/server/roomMembership.js';

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

function createFakeCommand({
  roomByPeer = {},
  rooms = {},
} = {}) {
  return {
    async get(key) {
      const marker =
        ':peer-room:';

      const index =
        key.indexOf(marker);

      if (index < 0) {
        return null;
      }

      const peerId =
        key.slice(
          index +
          marker.length,
        );

      return (
        roomByPeer[peerId] ??
        null
      );
    },

    async eval(
      script,
      numberOfKeys,
      peerRoomKey,
      targetRoomKey,
      keyPrefix,
      peerId,
      targetPeerId,
    ) {
      assert.equal(
        numberOfKeys,
        2,
      );

      assert.match(
        script,
        /HMGET/,
      );

      assert.ok(
        peerRoomKey.startsWith(
          `${keyPrefix}:peer-room:`,
        ),
      );

      assert.ok(
        targetRoomKey.startsWith(
          `${keyPrefix}:peer-room:`,
        ),
      );

      const roomId =
        roomByPeer[peerId] ??
        null;

      const targetRoomId =
        roomByPeer[targetPeerId] ??
        null;

      if (
        roomId === null ||
        targetRoomId === null ||
        roomId !== targetRoomId
      ) {
        return null;
      }

      const room =
        rooms[roomId];

      if (
        !room ||
        !room.impolite ||
        !room.polite
      ) {
        return null;
      }

      const valid =
        (
          room.impolite === peerId &&
          room.polite === targetPeerId
        ) ||
        (
          room.impolite === targetPeerId &&
          room.polite === peerId
        );

      return (
        valid
          ? roomId
          : null
      );
    },
  };
}

await test(
  'build peer room key',
  async () => {
    assert.equal(
      makePeerRoomKey(
        'bt:test',
        'peer-a',
      ),
      'bt:test:peer-room:peer-a',
    );
  },
);

await test(
  'build room key',
  async () => {
    assert.equal(
      makeRoomKey(
        'bt:test',
        'room-1',
      ),
      'bt:test:room:room-1',
    );
  },
);

await test(
  'find peer room',
  async () => {
    const membership =
      createRoomMembership({
        keyPrefix:
          'bt:test',

        command:
          createFakeCommand({
            roomByPeer: {
              'peer-a':
                'room-1',
            },
          }),
      });

    assert.equal(
      await membership.findRoom(
        'peer-a',
      ),
      'room-1',
    );
  },
);

await test(
  'accept actual partners',
  async () => {
    const membership =
      createRoomMembership({
        keyPrefix:
          'bt:test',

        command:
          createFakeCommand({
            roomByPeer: {
              'peer-a':
                'room-1',

              'peer-b':
                'room-1',
            },

            rooms: {
              'room-1': {
                impolite:
                  'peer-a',

                polite:
                  'peer-b',
              },
            },
          }),
      });

    assert.equal(
      await membership.arePartners(
        'peer-a',
        'peer-b',
      ),
      'room-1',
    );
  },
);

await test(
  'reject peers from different rooms',
  async () => {
    const membership =
      createRoomMembership({
        keyPrefix:
          'bt:test',

        command:
          createFakeCommand({
            roomByPeer: {
              'peer-a':
                'room-1',

              'peer-b':
                'room-2',
            },
          }),
      });

    assert.equal(
      await membership.arePartners(
        'peer-a',
        'peer-b',
      ),
      null,
    );
  },
);

await test(
  'reject forged same room mapping',
  async () => {
    const membership =
      createRoomMembership({
        keyPrefix:
          'bt:test',

        command:
          createFakeCommand({
            roomByPeer: {
              'peer-a':
                'room-1',

              'peer-x':
                'room-1',
            },

            rooms: {
              'room-1': {
                impolite:
                  'peer-a',

                polite:
                  'peer-b',
              },
            },
          }),
      });

    assert.equal(
      await membership.arePartners(
        'peer-a',
        'peer-x',
      ),
      null,
    );
  },
);

await test(
  'reject incomplete room',
  async () => {
    const membership =
      createRoomMembership({
        keyPrefix:
          'bt:test',

        command:
          createFakeCommand({
            roomByPeer: {
              'peer-a':
                'room-1',

              'peer-b':
                'room-1',
            },

            rooms: {
              'room-1': {
                impolite:
                  'peer-a',
              },
            },
          }),
      });

    assert.equal(
      await membership.arePartners(
        'peer-a',
        'peer-b',
      ),
      null,
    );
  },
);

await test(
  'reject self as partner',
  async () => {
    const membership =
      createRoomMembership({
        keyPrefix:
          'bt:test',

        command:
          createFakeCommand(),
      });

    assert.equal(
      await membership.arePartners(
        'peer-a',
        'peer-a',
      ),
      null,
    );
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);