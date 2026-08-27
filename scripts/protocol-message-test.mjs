import assert from 'node:assert/strict';

import {
  MESSAGE_TYPES,
  parseClientMessage,
} from '../src/server/protocol/messages.js';

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

test('valid join without resume token', () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: 'join',
    }),
  );

  assert.deepEqual(result, {
    ok: true,
    value: {
      type: MESSAGE_TYPES.JOIN,
      resumeToken: null,
    },
  });
});

test('valid join with resume token', () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: 'join',
      resumeToken: 'resume-token-123',
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(
    result.value.resumeToken,
    'resume-token-123',
  );
});

test('reject invalid JSON', () => {
  const result = parseClientMessage('{');

  assert.deepEqual(result, {
    ok: false,
    error: 'invalid_json',
  });
});

test('reject array message', () => {
  const result = parseClientMessage(
    JSON.stringify([]),
  );

  assert.deepEqual(result, {
    ok: false,
    error: 'invalid_message',
  });
});

test('reject unsupported message type', () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: 'unknown',
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: 'unsupported_message_type',
  });
});

test('reject invalid resume token', () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: 'join',
      resumeToken: '',
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: 'invalid_resume_token',
  });
});

test('accept valid signal', () => {
  const signalData = {
    candidate: {
      candidate: 'candidate-data',
    },
  };

  const result = parseClientMessage(
    JSON.stringify({
      type: 'signal',
      to: 'peer-123',
      data: signalData,
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.value.to, 'peer-123');
  assert.deepEqual(
    result.value.data,
    signalData,
  );
});

test('reject signal without target', () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: 'signal',
      data: {},
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: 'invalid_signal_target',
  });
});

test('reject non-object signal data', () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: 'signal',
      to: 'peer-123',
      data: 'not-an-object',
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: 'invalid_signal_data',
  });
});

test('reject oversized signal data', () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: 'signal',
      to: 'peer-123',
      data: {
        payload: 'x'.repeat(
          64 * 1024 + 1,
        ),
      },
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: 'signal_data_too_large',
  });
});

test('accept valid storage request', () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: 'requestStorage',
      gameName: 'indianPocker',
      initRole: 'impolite',
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(
    result.value.gameName,
    'indianPocker',
  );
  assert.equal(
    result.value.initRole,
    'impolite',
  );
});

test('reject invalid storage role', () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: 'requestStorage',
      gameName: 'indianPocker',
      initRole: 'admin',
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: 'invalid_init_role',
  });
});

test('reject empty game name', () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: 'requestStorage',
      gameName: '',
      initRole: 'polite',
    }),
  );

  assert.deepEqual(result, {
    ok: false,
    error: 'invalid_game_name',
  });
});

console.log(
  `ALL TESTS PASSED: ${passed}`,
);