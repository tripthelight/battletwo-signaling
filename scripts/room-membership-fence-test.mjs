import assert from 'node:assert/strict';

import {
  createRoomMembership,
} from '../src/server/roomMembership.js';

let passed =
  0;

async function test(
  name,
  fn,
) {
  try {
    await fn();

    passed +=
      1;

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
  presenceByPeer = {},
  cleanupRoomByPeer = {},
  cleanupDueByPeer = {},
} = {}) {
  return {
    async get() {
      return null;
    },

    async eval(
      script,
      numberOfKeys,
      ...args
    ) {
      assert.match(
        script,
        /room-membership:schedule-disconnect-fenced/,
      );

      assert.equal(
        numberOfKeys,
        4,
      );

      const [
        peerRoomKey,
        cleanupRoomKey,
        cleanupKey,
        peerPresenceKey,
        keyPrefix,
        peerId,
        dueAtMs,
        expectedPresenceOwner,
      ] = args;

      assert.equal(
        peerRoomKey,
        `${keyPrefix}:peer-room:${peerId}`,
      );

      assert.equal(
        cleanupRoomKey,
        `${keyPrefix}:room-cleanup-room`,
      );

      assert.equal(
        cleanupKey,
        `${keyPrefix}:room-cleanup`,
      );

      assert.equal(
        peerPresenceKey,
        `${keyPrefix}:peer:${peerId}`,
      );

      const currentPresenceOwner =
        presenceByPeer[
          peerId
        ] ??
        null;

      if (
        currentPresenceOwner !==
          null &&
        currentPresenceOwner !==
          expectedPresenceOwner
      ) {
        return [
          'owner-changed',
          currentPresenceOwner,
        ];
      }

      const roomId =
        roomByPeer[
          peerId
        ] ??
        null;

      if (!roomId) {
        return [
          'not-member',
        ];
      }

      const room =
        rooms[
          roomId
        ];

      if (
        !room ||
        (
          room.impolite !==
            peerId &&
          room.polite !==
            peerId
        )
      ) {
        return [
          'not-member',
        ];
      }

      cleanupRoomByPeer[
        peerId
      ] = roomId;

      cleanupDueByPeer[
        peerId
      ] = Number(
        dueAtMs,
      );

      return [
        'scheduled',
        roomId,
      ];
    },
  };
}

await test(
  'schedule disconnect for current presence owner',
  async () => {
    const cleanupRoomByPeer =
      {};

    const cleanupDueByPeer =
      {};

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

            presenceByPeer: {
              'peer-a':
                'instance-a',
            },

            cleanupRoomByPeer,
            cleanupDueByPeer,
          }),
      });

    assert.deepEqual(
      await membership
        .scheduleDisconnectFenced({
          peerId:
            'peer-a',

          dueAtMs:
            15_000,

          expectedPresenceOwner:
            'instance-a',
        }),
      {
        status:
          'scheduled',

        roomId:
          'room-1',
      },
    );

    assert.equal(
      cleanupRoomByPeer[
        'peer-a'
      ],
      'room-1',
    );

    assert.equal(
      cleanupDueByPeer[
        'peer-a'
      ],
      15_000,
    );
  },
);

await test(
  'allow schedule when presence already expired',
  async () => {
    const cleanupRoomByPeer =
      {};

    const cleanupDueByPeer =
      {};

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

            cleanupRoomByPeer,
            cleanupDueByPeer,
          }),
      });

    assert.deepEqual(
      await membership
        .scheduleDisconnectFenced({
          peerId:
            'peer-a',

          dueAtMs:
            20_000,

          expectedPresenceOwner:
            'instance-a',
        }),
      {
        status:
          'scheduled',

        roomId:
          'room-1',
      },
    );

    assert.equal(
      cleanupRoomByPeer[
        'peer-a'
      ],
      'room-1',
    );

    assert.equal(
      cleanupDueByPeer[
        'peer-a'
      ],
      20_000,
    );
  },
);

await test(
  'reject stale instance after presence takeover',
  async () => {
    const cleanupRoomByPeer =
      {};

    const cleanupDueByPeer =
      {};

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

            presenceByPeer: {
              'peer-a':
                'instance-b',
            },

            cleanupRoomByPeer,
            cleanupDueByPeer,
          }),
      });

    assert.deepEqual(
      await membership
        .scheduleDisconnectFenced({
          peerId:
            'peer-a',

          dueAtMs:
            15_000,

          expectedPresenceOwner:
            'instance-a',
        }),
      {
        status:
          'owner-changed',

        owner:
          'instance-b',
      },
    );

    assert.equal(
      cleanupRoomByPeer[
        'peer-a'
      ],
      undefined,
    );

    assert.equal(
      cleanupDueByPeer[
        'peer-a'
      ],
      undefined,
    );
  },
);

await test(
  'return not-member without room membership',
  async () => {
    const membership =
      createRoomMembership({
        keyPrefix:
          'bt:test',

        command:
          createFakeCommand({
            presenceByPeer: {
              'peer-a':
                'instance-a',
            },
          }),
      });

    assert.deepEqual(
      await membership
        .scheduleDisconnectFenced({
          peerId:
            'peer-a',

          dueAtMs:
            15_000,

          expectedPresenceOwner:
            'instance-a',
        }),
      {
        status:
          'not-member',
      },
    );
  },
);

await test(
  'return not-member for forged room membership',
  async () => {
    const cleanupRoomByPeer =
      {};

    const cleanupDueByPeer =
      {};

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

            rooms: {
              'room-1': {
                impolite:
                  'peer-x',

                polite:
                  'peer-y',
              },
            },

            presenceByPeer: {
              'peer-a':
                'instance-a',
            },

            cleanupRoomByPeer,
            cleanupDueByPeer,
          }),
      });

    assert.deepEqual(
      await membership
        .scheduleDisconnectFenced({
          peerId:
            'peer-a',

          dueAtMs:
            15_000,

          expectedPresenceOwner:
            'instance-a',
        }),
      {
        status:
          'not-member',
      },
    );

    assert.equal(
      cleanupRoomByPeer[
        'peer-a'
      ],
      undefined,
    );

    assert.equal(
      cleanupDueByPeer[
        'peer-a'
      ],
      undefined,
    );
  },
);

await test(
  'reject invalid expected presence owner before redis',
  async () => {
    let evalCalled =
      false;

    const membership =
      createRoomMembership({
        keyPrefix:
          'bt:test',

        command: {
          async get() {
            return null;
          },

          async eval() {
            evalCalled =
              true;

            return [];
          },
        },
      });

    await assert.rejects(
      membership
        .scheduleDisconnectFenced({
          peerId:
            'peer-a',

          dueAtMs:
            15_000,

          expectedPresenceOwner:
            '',
        }),
      TypeError,
    );

    assert.equal(
      evalCalled,
      false,
    );
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);