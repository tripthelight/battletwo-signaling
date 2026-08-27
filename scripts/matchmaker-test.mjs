import assert from 'node:assert/strict';

import {
  createMatchmaker,
  makeWaitingKey,
} from '../src/server/matchmaker.js';

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

function createFakeCommand() {
  const state = {
    present:
      new Set(),

    waiting:
      [],

    peerRooms:
      new Map(),

    rooms:
      new Map(),
  };

  return {
    state,

    async eval(
      script,
      numberOfKeys,
      waitingKey,
      peerRoomKey,
      peerPresenceKey,
      proposedRoomKey,
      keyPrefix,
      peerId,
      proposedRoomId,
      nowMs,
    ) {
      assert.equal(
        numberOfKeys,
        4,
      );

      assert.match(
        script,
        /ZRANGE/,
      );

      assert.match(
        script,
        /HSET/,
      );

      assert.equal(
        waitingKey,
        `${keyPrefix}:waiting`,
      );

      assert.equal(
        peerRoomKey,
        `${keyPrefix}:peer-room:${peerId}`,
      );

      assert.equal(
        peerPresenceKey,
        `${keyPrefix}:peer:${peerId}`,
      );

      assert.equal(
        proposedRoomKey,
        `${keyPrefix}:room:${proposedRoomId}`,
      );

      assert.equal(
        typeof nowMs,
        'number',
      );

      const existingRoomId =
        state.peerRooms.get(
          peerId,
        );

      if (existingRoomId) {
        const room =
          state.rooms.get(
            existingRoomId,
          );

        if (
          room?.impolite ===
          peerId &&
          room.polite
        ) {
          return [
            'existing',
            existingRoomId,
            'impolite',
            room.polite,
          ];
        }

        if (
          room?.polite ===
          peerId &&
          room.impolite
        ) {
          return [
            'existing',
            existingRoomId,
            'polite',
            room.impolite,
          ];
        }

        return [
          'unavailable',
        ];
      }

      if (
        !state.present.has(
          peerId,
        )
      ) {
        return [
          'unavailable',
        ];
      }

      if (
        state.waiting.includes(
          peerId,
        )
      ) {
        return [
          'waiting',
        ];
      }

      while (
        state.waiting.length >
        0
      ) {
        const candidatePeerId =
          state.waiting[0];

        if (
          candidatePeerId ===
          peerId
        ) {
          return [
            'waiting',
          ];
        }

        const candidatePresent =
          state.present.has(
            candidatePeerId,
          );

        const candidateAssigned =
          state.peerRooms.has(
            candidatePeerId,
          );

        if (
          !candidatePresent ||
          candidateAssigned
        ) {
          state.waiting.shift();
          continue;
        }

        if (
          state.rooms.has(
            proposedRoomId,
          )
        ) {
          return [
            'collision',
          ];
        }

        state.waiting.shift();

        state.rooms.set(
          proposedRoomId,
          {
            impolite:
              candidatePeerId,

            polite:
              peerId,
          },
        );

        state.peerRooms.set(
          candidatePeerId,
          proposedRoomId,
        );

        state.peerRooms.set(
          peerId,
          proposedRoomId,
        );

        return [
          'paired',
          proposedRoomId,
          candidatePeerId,
        ];
      }

      state.waiting.push(
        peerId,
      );

      return [
        'waiting',
      ];
    },
  };
}

await test(
  'build waiting key',
  async () => {
    assert.equal(
      makeWaitingKey(
        'bt:test',
      ),
      'bt:test:waiting',
    );
  },
);

await test(
  'reject peer without presence',
  async () => {
    const command =
      createFakeCommand();

    const matchmaker =
      createMatchmaker({
        command,
        keyPrefix:
          'bt:test',
      });

    assert.deepEqual(
      await matchmaker.match({
        peerId:
          'peer-a',

        proposedRoomId:
          'room-a',

        nowMs: 1000,
      }),
      {
        status:
          'unavailable',
      },
    );
  },
);

await test(
  'first peer waits',
  async () => {
    const command =
      createFakeCommand();

    command.state.present.add(
      'peer-a',
    );

    const matchmaker =
      createMatchmaker({
        command,
        keyPrefix:
          'bt:test',
      });

    assert.deepEqual(
      await matchmaker.match({
        peerId:
          'peer-a',

        proposedRoomId:
          'room-a',

        nowMs: 1000,
      }),
      {
        status:
          'waiting',
      },
    );

    assert.deepEqual(
      command.state.waiting,
      [
        'peer-a',
      ],
    );
  },
);

await test(
  'second peer pairs with first',
  async () => {
    const command =
      createFakeCommand();

    command.state.present.add(
      'peer-a',
    );

    command.state.present.add(
      'peer-b',
    );

    const matchmaker =
      createMatchmaker({
        command,
        keyPrefix:
          'bt:test',
      });

    await matchmaker.match({
      peerId:
        'peer-a',

      proposedRoomId:
        'unused-a',

      nowMs: 1000,
    });

    const result =
      await matchmaker.match({
        peerId:
          'peer-b',

        proposedRoomId:
          'room-1',

        nowMs: 1001,
      });

    assert.deepEqual(
      result,
      {
        status:
          'paired',

        roomId:
          'room-1',

        role:
          'polite',

        partnerPeerId:
          'peer-a',

        partnerRole:
          'impolite',
      },
    );

    assert.equal(
      command.state.peerRooms.get(
        'peer-a',
      ),
      'room-1',
    );

    assert.equal(
      command.state.peerRooms.get(
        'peer-b',
      ),
      'room-1',
    );

    assert.deepEqual(
      command.state.waiting,
      [],
    );
  },
);

await test(
  'same waiter cannot be paired twice',
  async () => {
    const command =
      createFakeCommand();

    for (
      const peerId
      of [
        'peer-a',
        'peer-b',
        'peer-c',
      ]
    ) {
      command.state.present.add(
        peerId,
      );
    }

    const matchmaker =
      createMatchmaker({
        command,
        keyPrefix:
          'bt:test',
      });

    await matchmaker.match({
      peerId:
        'peer-a',

      proposedRoomId:
        'unused-a',

      nowMs: 1000,
    });

    const resultB =
      await matchmaker.match({
        peerId:
          'peer-b',

        proposedRoomId:
          'room-ab',

        nowMs: 1001,
      });

    const resultC =
      await matchmaker.match({
        peerId:
          'peer-c',

        proposedRoomId:
          'room-c',

        nowMs: 1002,
      });

    assert.equal(
      resultB.status,
      'paired',
    );

    assert.deepEqual(
      resultC,
      {
        status:
          'waiting',
      },
    );

    assert.deepEqual(
      command.state.waiting,
      [
        'peer-c',
      ],
    );
  },
);

await test(
  'skip stale waiting peer',
  async () => {
    const command =
      createFakeCommand();

    command.state.waiting.push(
      'stale-peer',
    );

    command.state.present.add(
      'peer-b',
    );

    const matchmaker =
      createMatchmaker({
        command,
        keyPrefix:
          'bt:test',
      });

    assert.deepEqual(
      await matchmaker.match({
        peerId:
          'peer-b',

        proposedRoomId:
          'room-b',

        nowMs: 1000,
      }),
      {
        status:
          'waiting',
      },
    );

    assert.deepEqual(
      command.state.waiting,
      [
        'peer-b',
      ],
    );
  },
);

await test(
  'skip waiting peer already assigned',
  async () => {
    const command =
      createFakeCommand();

    command.state.present.add(
      'peer-a',
    );

    command.state.present.add(
      'peer-b',
    );

    command.state.waiting.push(
      'peer-a',
    );

    command.state.peerRooms.set(
      'peer-a',
      'old-room',
    );

    const matchmaker =
      createMatchmaker({
        command,
        keyPrefix:
          'bt:test',
      });

    assert.deepEqual(
      await matchmaker.match({
        peerId:
          'peer-b',

        proposedRoomId:
          'room-b',

        nowMs: 1000,
      }),
      {
        status:
          'waiting',
      },
    );

    assert.deepEqual(
      command.state.waiting,
      [
        'peer-b',
      ],
    );
  },
);

await test(
  'return existing membership',
  async () => {
    const command =
      createFakeCommand();

    command.state.present.add(
      'peer-a',
    );

    command.state.peerRooms.set(
      'peer-a',
      'room-1',
    );

    command.state.rooms.set(
      'room-1',
      {
        impolite:
          'peer-a',

        polite:
          'peer-b',
      },
    );

    const matchmaker =
      createMatchmaker({
        command,
        keyPrefix:
          'bt:test',
      });

    assert.deepEqual(
      await matchmaker.match({
        peerId:
          'peer-a',

        proposedRoomId:
          'new-room',

        nowMs: 1000,
      }),
      {
        status:
          'existing',

        roomId:
          'room-1',

        role:
          'impolite',

        partnerPeerId:
          'peer-b',

        partnerRole:
          'polite',
      },
    );
  },
);

await test(
  'do not overwrite room collision',
  async () => {
    const command =
      createFakeCommand();

    command.state.present.add(
      'peer-a',
    );

    command.state.present.add(
      'peer-b',
    );

    command.state.waiting.push(
      'peer-a',
    );

    command.state.rooms.set(
      'room-1',
      {
        impolite:
          'someone-x',

        polite:
          'someone-y',
      },
    );

    const matchmaker =
      createMatchmaker({
        command,
        keyPrefix:
          'bt:test',
      });

    assert.deepEqual(
      await matchmaker.match({
        peerId:
          'peer-b',

        proposedRoomId:
          'room-1',

        nowMs: 1000,
      }),
      {
        status:
          'collision',
      },
    );

    assert.deepEqual(
      command.state.waiting,
      [
        'peer-a',
      ],
    );
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);