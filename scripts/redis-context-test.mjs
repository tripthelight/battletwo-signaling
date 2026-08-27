import assert from 'node:assert/strict';

import {
  createRedisContext,
  makeInstanceChannel,
} from '../src/server/redis.js';

let passed = 0;

function test(
  name,
  fn,
) {
  try {
    fn();

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

test(
  'build instance channel',
  () => {
    assert.equal(
      makeInstanceChannel(
        'battletwo:signaling',
        'instance-1',
      ),
      'battletwo:signaling:instance:instance-1',
    );
  },
);

test(
  'reject empty key prefix',
  () => {
    assert.throws(
      () => {
        makeInstanceChannel(
          '',
          'instance-1',
        );
      },
      /keyPrefix/,
    );
  },
);

test(
  'reject empty instance id',
  () => {
    assert.throws(
      () => {
        makeInstanceChannel(
          'bt',
          '',
        );
      },
      /instanceId/,
    );
  },
);

test(
  'create three distinct redis clients',
  () => {
    const context =
      createRedisContext({
        redisUrl:
          'redis://127.0.0.1:6379',

        keyPrefix:
          'bt:test',

        instanceId:
          'instance-test',
      });

    assert.notEqual(
      context.command,
      context.publisher,
    );

    assert.notEqual(
      context.command,
      context.subscriber,
    );

    assert.notEqual(
      context.publisher,
      context.subscriber,
    );

    context.disconnect();
  },
);

test(
  'do not connect automatically',
  () => {
    const context =
      createRedisContext({
        redisUrl:
          'redis://127.0.0.1:6379',

        keyPrefix:
          'bt:test',

        instanceId:
          'instance-test',
      });

    assert.equal(
      context.command.status,
      'wait',
    );

    assert.equal(
      context.publisher.status,
      'wait',
    );

    assert.equal(
      context.subscriber.status,
      'wait',
    );

    context.disconnect();
  },
);

test(
  'use supplied instance id',
  () => {
    const context =
      createRedisContext({
        keyPrefix:
          'bt:test',

        instanceId:
          'signaling-a',
      });

    assert.equal(
      context.instanceId,
      'signaling-a',
    );

    assert.equal(
      context.instanceChannel,
      'bt:test:instance:signaling-a',
    );

    context.disconnect();
  },
);

test(
  'generate instance id by default',
  () => {
    const first =
      createRedisContext({
        keyPrefix:
          'bt:test',
      });

    const second =
      createRedisContext({
        keyPrefix:
          'bt:test',
      });

    assert.equal(
      typeof first.instanceId,
      'string',
    );

    assert.ok(
      first.instanceId.length > 0,
    );

    assert.notEqual(
      first.instanceId,
      second.instanceId,
    );

    first.disconnect();
    second.disconnect();
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);