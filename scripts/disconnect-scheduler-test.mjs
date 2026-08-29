import assert from 'node:assert/strict';

import {
  createDisconnectScheduler,
} from '../src/server/disconnectScheduler.js';

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

function createFixture({
  results = [
    {
      status:
        'scheduled',

      roomId:
        'room-1',
    },
  ],

  errors = [],
  nowMs =
    10_000,
  retryAttempts =
    5,
  retryDelayMs =
    25,
} = {}) {
  const calls =
    [];

  const waits =
    [];

  let callIndex =
    0;

  const roomMembership = {
    async scheduleDisconnectFenced(
      input,
    ) {
      calls.push({
        ...input,
      });

      const index =
        callIndex;

      callIndex +=
        1;

      if (
        errors[index]
      ) {
        throw errors[
          index
        ];
      }

      const result =
        results[
          Math.min(
            index,
            results.length -
              1,
          )
        ];

      return {
        ...result,
      };
    },
  };

  const scheduler =
    createDisconnectScheduler({
      roomMembership,

      instanceId:
        'instance-a',

      graceMs:
        15_000,

      retryAttempts,

      retryDelayMs,

      now:
        () =>
          nowMs,

      wait:
        async (
          delayMs,
        ) => {
          waits.push(
            delayMs,
          );
        },
    });

  return {
    scheduler,
    calls,
    waits,
  };
}

await test(
  'schedule disconnect on first attempt',
  async () => {
    const fixture =
      createFixture();

    const result =
      await fixture.scheduler
        .schedule(
          'peer-a',
        );

    assert.deepEqual(
      result,
      {
        status:
          'scheduled',

        peerId:
          'peer-a',

        roomId:
          'room-1',

        dueAtMs:
          25_000,

        attempts:
          1,
      },
    );

    assert.deepEqual(
      fixture.calls,
      [
        {
          peerId:
            'peer-a',

          dueAtMs:
            25_000,

          expectedPresenceOwner:
            'instance-a',
        },
      ],
    );

    assert.deepEqual(
      fixture.waits,
      [],
    );
  },
);

await test(
  'preserve original cleanup deadline across internal retries',
  async () => {
    const firstError =
      new Error(
        'redis unavailable 1',
      );

    const secondError =
      new Error(
        'redis unavailable 2',
      );

    const fixture =
      createFixture({
        errors: [
          firstError,
          secondError,
          null,
        ],

        results: [
          {
            status:
              'scheduled',

            roomId:
              'room-1',
          },
        ],
      });

    const result =
      await fixture.scheduler
        .schedule(
          'peer-a',
        );

    assert.equal(
      result.status,
      'scheduled',
    );

    assert.equal(
      result.attempts,
      3,
    );

    assert.equal(
      result.dueAtMs,
      25_000,
    );

    assert.equal(
      fixture.calls.length,
      3,
    );

    for (
      const call
      of fixture.calls
    ) {
      assert.equal(
        call.dueAtMs,
        25_000,
      );

      assert.equal(
        call.expectedPresenceOwner,
        'instance-a',
      );
    }

    assert.deepEqual(
      fixture.waits,
      [
        25,
        25,
      ],
    );
  },
);

await test(
  'reuse supplied deadline across outer retry',
  async () => {
    const fixture =
      createFixture({
        nowMs:
          99_000,
      });

    const result =
      await fixture.scheduler
        .schedule(
          'peer-a',
          {
            dueAtMs:
              25_000,
          },
        );

    assert.deepEqual(
      result,
      {
        status:
          'scheduled',

        peerId:
          'peer-a',

        roomId:
          'room-1',

        dueAtMs:
          25_000,

        attempts:
          1,
      },
    );

    assert.equal(
      fixture.calls[
        0
      ].dueAtMs,
      25_000,
    );
  },
);

await test(
  'stop immediately after presence takeover',
  async () => {
    const fixture =
      createFixture({
        results: [
          {
            status:
              'owner-changed',

            owner:
              'instance-b',
          },
        ],
      });

    const result =
      await fixture.scheduler
        .schedule(
          'peer-a',
        );

    assert.deepEqual(
      result,
      {
        status:
          'owner-changed',

        peerId:
          'peer-a',

        owner:
          'instance-b',

        dueAtMs:
          25_000,

        attempts:
          1,
      },
    );

    assert.equal(
      fixture.calls.length,
      1,
    );

    assert.deepEqual(
      fixture.waits,
      [],
    );
  },
);

await test(
  'stop immediately when peer is not a room member',
  async () => {
    const fixture =
      createFixture({
        results: [
          {
            status:
              'not-member',
          },
        ],
      });

    const result =
      await fixture.scheduler
        .schedule(
          'peer-a',
        );

    assert.deepEqual(
      result,
      {
        status:
          'not-member',

        peerId:
          'peer-a',

        dueAtMs:
          25_000,

        attempts:
          1,
      },
    );

    assert.equal(
      fixture.calls.length,
      1,
    );

    assert.deepEqual(
      fixture.waits,
      [],
    );
  },
);

await test(
  'retry transient redis error before takeover result',
  async () => {
    const fixture =
      createFixture({
        errors: [
          new Error(
            'redis unavailable',
          ),
          null,
        ],

        results: [
          {
            status:
              'owner-changed',

            owner:
              'instance-b',
          },
        ],
      });

    const result =
      await fixture.scheduler
        .schedule(
          'peer-a',
        );

    assert.equal(
      result.status,
      'owner-changed',
    );

    assert.equal(
      result.owner,
      'instance-b',
    );

    assert.equal(
      result.dueAtMs,
      25_000,
    );

    assert.equal(
      result.attempts,
      2,
    );

    assert.equal(
      fixture.calls.length,
      2,
    );

    assert.deepEqual(
      fixture.waits,
      [
        25,
      ],
    );
  },
);

await test(
  'fail after bounded redis retries',
  async () => {
    const errors = [
      new Error(
        'redis unavailable 1',
      ),

      new Error(
        'redis unavailable 2',
      ),

      new Error(
        'redis unavailable 3',
      ),
    ];

    const fixture =
      createFixture({
        errors,

        retryAttempts:
          3,
      });

    await assert.rejects(
      fixture.scheduler
        .schedule(
          'peer-a',
        ),
      (
        error,
      ) => {
        assert.equal(
          error instanceof
            AggregateError,
          true,
        );

        assert.equal(
          error.errors.length,
          3,
        );

        assert.equal(
          error.errors[0],
          errors[0],
        );

        assert.equal(
          error.errors[1],
          errors[1],
        );

        assert.equal(
          error.errors[2],
          errors[2],
        );

        return true;
      },
    );

    assert.equal(
      fixture.calls.length,
      3,
    );

    assert.deepEqual(
      fixture.waits,
      [
        25,
        25,
      ],
    );
  },
);

await test(
  'reject invalid peer before room membership call',
  async () => {
    const fixture =
      createFixture();

    await assert.rejects(
      fixture.scheduler
        .schedule(
          '',
        ),
      TypeError,
    );

    assert.equal(
      fixture.calls.length,
      0,
    );
  },
);

await test(
  'reject invalid supplied deadline',
  async () => {
    const fixture =
      createFixture();

    await assert.rejects(
      fixture.scheduler
        .schedule(
          'peer-a',
          {
            dueAtMs:
              -1,
          },
        ),
      TypeError,
    );

    assert.equal(
      fixture.calls.length,
      0,
    );
  },
);

await test(
  'reject unsafe calculated deadline',
  async () => {
    const roomMembership = {
      async scheduleDisconnectFenced() {
        throw new Error(
          'must not be called',
        );
      },
    };

    const scheduler =
      createDisconnectScheduler({
        roomMembership,

        instanceId:
          'instance-a',

        graceMs:
          15_000,

        now:
          () =>
            Number.MAX_SAFE_INTEGER,
      });

    await assert.rejects(
      scheduler.schedule(
        'peer-a',
      ),
      TypeError,
    );
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);