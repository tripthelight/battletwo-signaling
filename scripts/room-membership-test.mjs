import assert from 'node:assert/strict';

import {
  createRoomMembership,
  makePeerRoomKey,
  makeRoomCleanupKey,
  makeRoomCleanupRoomKey,
  makeRoomKey,
  makeRoomWatchKey,
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
  cleanupRoomByPeer = {},
  cleanupDueByPeer = {},
  roomWatchByRoom = {},
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
      if (
        script.includes(
          '-- room-membership:restore',
        )
      ) {
        assert.equal(
          numberOfKeys,
          4,
        );

        const actualPeerRoomKey =
          arguments[2];

        const actualRoomKey =
          arguments[3];

        const actualCleanupKey =
          arguments[4];

        const actualCleanupRoomKey =
          arguments[5];

        const actualRoomId =
          arguments[6];

        const actualPeerId =
          arguments[7];

        const actualRole =
          arguments[8];

        const actualKeyPrefix =
          arguments[9];

        assert.equal(
          actualPeerRoomKey,
          `${actualKeyPrefix}:peer-room:${actualPeerId}`,
        );

        assert.equal(
          actualRoomKey,
          `${actualKeyPrefix}:room:${actualRoomId}`,
        );

        assert.equal(
          actualCleanupKey,
          `${actualKeyPrefix}:room-cleanup`,
        );

        assert.equal(
          actualCleanupRoomKey,
          `${actualKeyPrefix}:room-cleanup-room`,
        );

        if (
          roomByPeer[
            actualPeerId
          ] !== actualRoomId
        ) {
          return [
            'invalid',
          ];
        }

        const room =
          rooms[
            actualRoomId
          ];

        if (
          !room ||
          !room.impolite ||
          !room.polite
        ) {
          return [
            'invalid',
          ];
        }

        let partnerPeerId;

        if (
          actualRole ===
          'impolite'
        ) {
          if (
            room.impolite !==
            actualPeerId
          ) {
            return [
              'invalid',
            ];
          }

          partnerPeerId =
            room.polite;
        } else if (
          actualRole ===
          'polite'
        ) {
          if (
            room.polite !==
            actualPeerId
          ) {
            return [
              'invalid',
            ];
          }

          partnerPeerId =
            room.impolite;
        } else {
          return [
            'invalid',
          ];
        }

        if (
          !partnerPeerId ||
          partnerPeerId ===
          actualPeerId ||
          roomByPeer[
            partnerPeerId
          ] !== actualRoomId
        ) {
          return [
            'invalid',
          ];
        }

        delete cleanupDueByPeer[
          actualPeerId
        ];

        delete cleanupRoomByPeer[
          actualPeerId
        ];

        return [
          'restored',
          partnerPeerId,
        ];
      }

      if (
        script.includes(
          '-- room-membership:schedule-disconnect',
        )
      ) {
        assert.equal(
          numberOfKeys,
          3,
        );

        const actualKeyPrefix =
          arguments[5];

        const actualPeerId =
          arguments[6];

        const dueAtMs =
          arguments[7];

        assert.ok(
          peerRoomKey.startsWith(
            `${actualKeyPrefix}:peer-room:`,
          ),
        );

        assert.equal(
          targetRoomKey,
          `${actualKeyPrefix}:room-cleanup-room`,
        );

        assert.equal(
          arguments[4],
          `${actualKeyPrefix}:room-cleanup`,
        );

        const roomId =
          roomByPeer[actualPeerId] ??
          null;

        if (!roomId) {
          return null;
        }

        const room =
          rooms[roomId];

        if (
          !room ||
          (
            room.impolite !== actualPeerId &&
            room.polite !== actualPeerId
          )
        ) {
          return null;
        }

        cleanupRoomByPeer[
          actualPeerId
        ] = roomId;

        cleanupDueByPeer[
          actualPeerId
        ] = Number(dueAtMs);

        return roomId;
      }

      if (
        script.includes(
          '-- room-membership:cancel-disconnect',
        )
      ) {
        assert.equal(
          numberOfKeys,
          2,
        );

        const actualPeerId =
          arguments[4];

        const existed =
          Object.hasOwn(
            cleanupDueByPeer,
            actualPeerId,
          );

        delete cleanupDueByPeer[
          actualPeerId
        ];

        delete cleanupRoomByPeer[
          actualPeerId
        ];

        return existed
          ? 1
          : 0;
      }

      if (
        script.includes(
          '-- room-membership:cleanup-due',
        )
      ) {
        assert.equal(
          numberOfKeys,
          3,
        );

        assert.equal(
          arguments[4],
          `${arguments[5]}:room-watch`,
        );

        const nowMs =
          Number(
            arguments[6],
          );

        const limit =
          Number(
            arguments[7],
          );

        const candidates =
          Object.entries(
            cleanupDueByPeer,
          )
            .filter(
              ([, dueAtMs]) =>
                dueAtMs <= nowMs,
            )
            .sort(
              (
                [peerA, dueA],
                [peerB, dueB],
              ) =>
                dueA - dueB ||
                peerA.localeCompare(
                  peerB,
                ),
            )
            .slice(
              0,
              limit,
            )
            .map(
              ([candidatePeerId]) =>
                candidatePeerId,
            );

        const cleaned = [];

        for (
          const candidatePeerId
          of candidates
        ) {
          const scheduledRoomId =
            cleanupRoomByPeer[
              candidatePeerId
            ];

          if (!scheduledRoomId) {
            delete cleanupDueByPeer[
              candidatePeerId
            ];

            continue;
          }

          const currentRoomId =
            roomByPeer[
              candidatePeerId
            ];

          if (
            currentRoomId !==
            scheduledRoomId
          ) {
            delete cleanupDueByPeer[
              candidatePeerId
            ];

            delete cleanupRoomByPeer[
              candidatePeerId
            ];

            continue;
          }

          const room =
            rooms[
              scheduledRoomId
            ];

          if (
            !room ||
            !room.impolite ||
            !room.polite ||
            (
              room.impolite !==
                candidatePeerId &&
              room.polite !==
                candidatePeerId
            )
          ) {
            delete cleanupDueByPeer[
              candidatePeerId
            ];

            delete cleanupRoomByPeer[
              candidatePeerId
            ];

            continue;
          }

          const partnerPeerId =
            room.impolite ===
            candidatePeerId
              ? room.polite
              : room.impolite;

          if (
            roomByPeer[
              partnerPeerId
            ] !== scheduledRoomId
          ) {
            delete cleanupDueByPeer[
              candidatePeerId
            ];

            delete cleanupRoomByPeer[
              candidatePeerId
            ];

            continue;
          }

          delete rooms[
            scheduledRoomId
          ];

          delete roomByPeer[
            candidatePeerId
          ];

          delete roomByPeer[
            partnerPeerId
          ];

          delete cleanupDueByPeer[
            candidatePeerId
          ];

          delete cleanupDueByPeer[
            partnerPeerId
          ];

          delete cleanupRoomByPeer[
            candidatePeerId
          ];

          delete cleanupRoomByPeer[
            partnerPeerId
          ];

          delete roomWatchByRoom[
            scheduledRoomId
          ];

          cleaned.push(
            scheduledRoomId,
            candidatePeerId,
            partnerPeerId,
          );
        }

        return cleaned;
      }

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

await test(
  'build room cleanup keys',
  async () => {
    assert.equal(
      makeRoomCleanupKey(
        'bt:test',
      ),
      'bt:test:room-cleanup',
    );

    assert.equal(
      makeRoomCleanupRoomKey(
        'bt:test',
      ),
      'bt:test:room-cleanup-room',
    );

    assert.equal(
      makeRoomWatchKey(
        'bt:test',
      ),
      'bt:test:room-watch',
    );
  },
);

await test(
  'schedule peer disconnect',
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
                  'peer-a',

                polite:
                  'peer-b',
              },
            },

            cleanupRoomByPeer,
            cleanupDueByPeer,
          }),
      });

    assert.equal(
      await membership.scheduleDisconnect({
        peerId:
          'peer-a',

        dueAtMs:
          15_000,
      }),
      'room-1',
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
  'reject disconnect without valid room',
  async () => {
    const membership =
      createRoomMembership({
        keyPrefix:
          'bt:test',

        command:
          createFakeCommand(),
      });

    assert.equal(
      await membership.scheduleDisconnect({
        peerId:
          'peer-a',

        dueAtMs:
          15_000,
      }),
      null,
    );
  },
);

await test(
  'cancel scheduled disconnect',
  async () => {
    const cleanupRoomByPeer = {
      'peer-a':
        'room-1',
    };

    const cleanupDueByPeer = {
      'peer-a':
        15_000,
    };

    const membership =
      createRoomMembership({
        keyPrefix:
          'bt:test',

        command:
          createFakeCommand({
            cleanupRoomByPeer,
            cleanupDueByPeer,
          }),
      });

    assert.equal(
      await membership.cancelDisconnect(
        'peer-a',
      ),
      true,
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

    assert.equal(
      await membership.cancelDisconnect(
        'peer-a',
      ),
      false,
    );
  },
);

await test(
  'restore impolite room membership',
  async () => {
    const cleanupRoomByPeer = {
      'peer-a':
        'room-1',
    };

    const cleanupDueByPeer = {
      'peer-a':
        15_000,
    };

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
      await membership.restore({
        peerId:
          'peer-a',

        roomId:
          'room-1',

        role:
          'impolite',
      }),
      {
        roomId:
          'room-1',

        role:
          'impolite',

        partnerPeerId:
          'peer-b',
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
  'restore polite room membership',
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

    assert.deepEqual(
      await membership.restore({
        peerId:
          'peer-b',

        roomId:
          'room-1',

        role:
          'polite',
      }),
      {
        roomId:
          'room-1',

        role:
          'polite',

        partnerPeerId:
          'peer-a',
      },
    );
  },
);

await test(
  'reject restore for wrong room',
  async () => {
    const cleanupRoomByPeer = {
      'peer-a':
        'room-1',
    };

    const cleanupDueByPeer = {
      'peer-a':
        15_000,
    };

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

    assert.equal(
      await membership.restore({
        peerId:
          'peer-a',

        roomId:
          'room-x',

        role:
          'impolite',
      }),
      null,
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
  'reject restore for wrong role',
  async () => {
    const cleanupRoomByPeer = {
      'peer-a':
        'room-1',
    };

    const cleanupDueByPeer = {
      'peer-a':
        15_000,
    };

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

    assert.equal(
      await membership.restore({
        peerId:
          'peer-a',

        roomId:
          'room-1',

        role:
          'polite',
      }),
      null,
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
  'reject restore without partner mapping',
  async () => {
    const cleanupRoomByPeer = {
      'peer-a':
        'room-1',
    };

    const cleanupDueByPeer = {
      'peer-a':
        15_000,
    };

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
                  'peer-a',

                polite:
                  'peer-b',
              },
            },

            cleanupRoomByPeer,
            cleanupDueByPeer,
          }),
      });

    assert.equal(
      await membership.restore({
        peerId:
          'peer-a',

        roomId:
          'room-1',

        role:
          'impolite',
      }),
      null,
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
  'cleanup expired room',
  async () => {
    const roomByPeer = {
      'peer-a':
        'room-1',

      'peer-b':
        'room-1',
    };

    const rooms = {
      'room-1': {
        impolite:
          'peer-a',

        polite:
          'peer-b',
      },
    };

    const cleanupRoomByPeer = {
      'peer-a':
        'room-1',

      'peer-b':
        'room-1',
    };

    const cleanupDueByPeer = {
      'peer-a':
        15_000,

      'peer-b':
        20_000,
    };

    const membership =
      createRoomMembership({
        keyPrefix:
          'bt:test',

        command:
          createFakeCommand({
            roomByPeer,
            rooms,
            cleanupRoomByPeer,
            cleanupDueByPeer,
          }),
      });

    assert.deepEqual(
      await membership.cleanupDue({
        nowMs:
          15_000,
      }),
      [
        {
          roomId:
            'room-1',

          expiredPeerId:
            'peer-a',

          partnerPeerId:
            'peer-b',
        },
      ],
    );

    assert.equal(
      rooms['room-1'],
      undefined,
    );

    assert.equal(
      roomByPeer['peer-a'],
      undefined,
    );

    assert.equal(
      roomByPeer['peer-b'],
      undefined,
    );

    assert.deepEqual(
      cleanupRoomByPeer,
      {},
    );

    assert.deepEqual(
      cleanupDueByPeer,
      {},
    );
  },
);

await test(
  'preserve room before cleanup deadline',
  async () => {
    const roomByPeer = {
      'peer-a':
        'room-1',

      'peer-b':
        'room-1',
    };

    const rooms = {
      'room-1': {
        impolite:
          'peer-a',

        polite:
          'peer-b',
      },
    };

    const cleanupRoomByPeer = {
      'peer-a':
        'room-1',
    };

    const cleanupDueByPeer = {
      'peer-a':
        15_000,
    };

    const membership =
      createRoomMembership({
        keyPrefix:
          'bt:test',

        command:
          createFakeCommand({
            roomByPeer,
            rooms,
            cleanupRoomByPeer,
            cleanupDueByPeer,
          }),
      });

    assert.deepEqual(
      await membership.cleanupDue({
        nowMs:
          14_999,
      }),
      [],
    );

    assert.equal(
      roomByPeer['peer-a'],
      'room-1',
    );

    assert.ok(
      rooms['room-1'],
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
  'discard stale cleanup without deleting current room',
  async () => {
    const roomByPeer = {
      'peer-a':
        'room-2',

      'peer-c':
        'room-2',
    };

    const rooms = {
      'room-1': {
        impolite:
          'peer-a',

        polite:
          'peer-b',
      },

      'room-2': {
        impolite:
          'peer-a',

        polite:
          'peer-c',
      },
    };

    const cleanupRoomByPeer = {
      'peer-a':
        'room-1',
    };

    const cleanupDueByPeer = {
      'peer-a':
        15_000,
    };

    const membership =
      createRoomMembership({
        keyPrefix:
          'bt:test',

        command:
          createFakeCommand({
            roomByPeer,
            rooms,
            cleanupRoomByPeer,
            cleanupDueByPeer,
          }),
      });

    assert.deepEqual(
      await membership.cleanupDue({
        nowMs:
          15_000,
      }),
      [],
    );

    assert.equal(
      roomByPeer['peer-a'],
      'room-2',
    );

    assert.ok(
      rooms['room-2'],
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

console.log(
  `ALL TESTS PASSED: ${passed}`,
);