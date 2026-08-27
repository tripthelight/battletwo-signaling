import assert from 'node:assert/strict';

import {
  loadConfig,
} from '../src/server/config.js';

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

test('use safe defaults', () => {
  const config = loadConfig({});

  assert.deepEqual(config, {
    rtcHost: '0.0.0.0',
    rtcPort: 5000,
    roomTtlMs: 15_000,
    maxPayloadBytes: 64 * 1024,
  });
});

test('accept valid custom values', () => {
  const config = loadConfig({
    RTC_HOST: '127.0.0.1',
    RTC_PORT: '6000',
    ROOM_TTL_MS: '30000',
    WS_MAX_PAYLOAD_BYTES: '131072',
  });

  assert.equal(
    config.rtcHost,
    '127.0.0.1',
  );

  assert.equal(
    config.rtcPort,
    6000,
  );

  assert.equal(
    config.roomTtlMs,
    30_000,
  );

  assert.equal(
    config.maxPayloadBytes,
    131_072,
  );
});

test('trim host value', () => {
  const config = loadConfig({
    RTC_HOST: '  localhost  ',
  });

  assert.equal(
    config.rtcHost,
    'localhost',
  );
});

test('reject invalid port text', () => {
  assert.throws(
    () => {
      loadConfig({
        RTC_PORT: 'abc',
      });
    },
    /RTC_PORT/,
  );
});

test('reject port below range', () => {
  assert.throws(
    () => {
      loadConfig({
        RTC_PORT: '0',
      });
    },
    /RTC_PORT/,
  );
});

test('reject port above range', () => {
  assert.throws(
    () => {
      loadConfig({
        RTC_PORT: '65536',
      });
    },
    /RTC_PORT/,
  );
});

test('reject invalid room TTL', () => {
  assert.throws(
    () => {
      loadConfig({
        ROOM_TTL_MS: '500',
      });
    },
    /ROOM_TTL_MS/,
  );
});

test('reject excessive payload limit', () => {
  assert.throws(
    () => {
      loadConfig({
        WS_MAX_PAYLOAD_BYTES:
          String(2 * 1024 * 1024),
      });
    },
    /WS_MAX_PAYLOAD_BYTES/,
  );
});

console.log(
  `ALL TESTS PASSED: ${passed}`,
);