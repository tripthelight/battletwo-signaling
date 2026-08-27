import assert from 'node:assert/strict';

import {
  createLocalPeers,
} from '../src/server/state/localPeers.js';

let passed = 0;

function test(name, fn) {
  try {
    fn();

    passed += 1;

    console.log(`PASS: ${name}`);
  } catch (error) {
    console.error(`FAIL: ${name}`);

    throw error;
  }
}

test('register peer', () => {
  const peers = createLocalPeers();
  const ws = {};

  const meta = peers.register(
    ws,
    'peer-1',
  );

  assert.deepEqual(meta, {
    peerId: 'peer-1',
    roomId: null,
  });

  assert.equal(
    peers.getMeta(ws),
    meta,
  );

  assert.equal(
    peers.getSocket('peer-1'),
    ws,
  );

  assert.equal(
    peers.size(),
    1,
  );
});

test('set room id', () => {
  const peers = createLocalPeers();
  const ws = {};

  peers.register(ws, 'peer-1');

  assert.equal(
    peers.setRoomId(
      ws,
      'room-1',
    ),
    true,
  );

  assert.deepEqual(
    peers.getMeta(ws),
    {
      peerId: 'peer-1',
      roomId: 'room-1',
    },
  );
});

test('reject duplicate socket', () => {
  const peers = createLocalPeers();
  const ws = {};

  peers.register(ws, 'peer-1');

  assert.throws(
    () => {
      peers.register(
        ws,
        'peer-2',
      );
    },
    /already registered/,
  );
});

test('reject duplicate peer id', () => {
  const peers = createLocalPeers();

  peers.register(
    {},
    'peer-1',
  );

  assert.throws(
    () => {
      peers.register(
        {},
        'peer-1',
      );
    },
    /already registered/,
  );
});

test('remove peer from both indexes', () => {
  const peers = createLocalPeers();
  const ws = {};

  peers.register(
    ws,
    'peer-1',
  );

  peers.setRoomId(
    ws,
    'room-1',
  );

  const removed =
    peers.remove(ws);

  assert.deepEqual(removed, {
    peerId: 'peer-1',
    roomId: 'room-1',
  });

  assert.equal(
    peers.getMeta(ws),
    null,
  );

  assert.equal(
    peers.getSocket('peer-1'),
    null,
  );

  assert.equal(
    peers.size(),
    0,
  );
});

test('remove unknown socket safely', () => {
  const peers = createLocalPeers();

  assert.equal(
    peers.remove({}),
    null,
  );
});

test('reject invalid peer id', () => {
  const peers = createLocalPeers();

  assert.throws(
    () => {
      peers.register(
        {},
        '',
      );
    },
    /peerId/,
  );
});

test('unknown peer returns null', () => {
  const peers = createLocalPeers();

  assert.equal(
    peers.getSocket('missing'),
    null,
  );

  assert.equal(
    peers.hasPeer('missing'),
    false,
  );
});

console.log(
  `ALL TESTS PASSED: ${passed}`,
);