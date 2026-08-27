import assert from 'node:assert/strict';

import {
  loadConfig,
} from '../src/server/config.js';

let passed = 0;

function test(name, fn) {
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
  'use safe defaults',
  () => {
    const config =
      loadConfig({});

    assert.deepEqual(
      config,
      {
        rtcHost: '0.0.0.0',
        rtcPort: 5000,

        roomTtlMs: 15_000,
        maxPayloadBytes:
          64 * 1024,

        redisUrl:
          'redis://127.0.0.1:6379',

        redisKeyPrefix:
          'battletwo:signaling',

        redisConnectTimeoutMs:
          5_000,

        peerPresenceTtlMs:
          30_000,

        peerPresenceRefreshMs:
          10_000,

        resumeSessionTtlMs:
          15_000,

        resumeClaimTtlMs:
          5_000,

        resumeClaimRefreshMs:
          2_000,
      },
    );
  },
);

test(
  'accept valid custom values',
  () => {
    const config =
      loadConfig({
        RTC_HOST:
          '127.0.0.1',

        RTC_PORT:
          '6000',

        ROOM_TTL_MS:
          '30000',

        WS_MAX_PAYLOAD_BYTES:
          '131072',

        REDIS_URL:
          'redis://redis:6379/0',

        REDIS_KEY_PREFIX:
          'bt:test',

        REDIS_CONNECT_TIMEOUT_MS:
          '2500',

        PEER_PRESENCE_TTL_MS:
          '45000',

        PEER_PRESENCE_REFRESH_MS:
          '15000',

        RESUME_SESSION_TTL_MS:
          '30000',

        RESUME_CLAIM_TTL_MS:
          '8000',

        RESUME_CLAIM_REFRESH_MS:
          '3000',
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

    assert.equal(
      config.redisUrl,
      'redis://redis:6379/0',
    );

    assert.equal(
      config.redisKeyPrefix,
      'bt:test',
    );

    assert.equal(
      config.redisConnectTimeoutMs,
      2_500,
    );

    assert.equal(
      config.peerPresenceTtlMs,
      45_000,
    );

    assert.equal(
      config.peerPresenceRefreshMs,
      15_000,
    );

    assert.equal(
      config.resumeSessionTtlMs,
      30_000,
    );

    assert.equal(
      config.resumeClaimTtlMs,
      8_000,
    );

    assert.equal(
      config.resumeClaimRefreshMs,
      3_000,
    );
  },
);

test(
  'accept rediss url',
  () => {
    const config =
      loadConfig({
        REDIS_URL:
          'rediss://redis.example.com:6380',
      });

    assert.equal(
      config.redisUrl,
      'rediss://redis.example.com:6380',
    );
  },
);

test(
  'trim host value',
  () => {
    const config =
      loadConfig({
        RTC_HOST:
          '  localhost  ',
      });

    assert.equal(
      config.rtcHost,
      'localhost',
    );
  },
);

test(
  'reject invalid port text',
  () => {
    assert.throws(
      () => {
        loadConfig({
          RTC_PORT:
            'abc',
        });
      },
      /RTC_PORT/,
    );
  },
);

test(
  'reject port below range',
  () => {
    assert.throws(
      () => {
        loadConfig({
          RTC_PORT:
            '0',
        });
      },
      /RTC_PORT/,
    );
  },
);

test(
  'reject port above range',
  () => {
    assert.throws(
      () => {
        loadConfig({
          RTC_PORT:
            '65536',
        });
      },
      /RTC_PORT/,
    );
  },
);

test(
  'reject invalid room TTL',
  () => {
    assert.throws(
      () => {
        loadConfig({
          ROOM_TTL_MS:
            '500',
        });
      },
      /ROOM_TTL_MS/,
    );
  },
);

test(
  'reject excessive payload limit',
  () => {
    assert.throws(
      () => {
        loadConfig({
          WS_MAX_PAYLOAD_BYTES:
            String(
              2 * 1024 * 1024,
            ),
        });
      },
      /WS_MAX_PAYLOAD_BYTES/,
    );
  },
);

test(
  'reject malformed redis url',
  () => {
    assert.throws(
      () => {
        loadConfig({
          REDIS_URL:
            'not-a-url',
        });
      },
      /REDIS_URL/,
    );
  },
);

test(
  'reject unsupported redis scheme',
  () => {
    assert.throws(
      () => {
        loadConfig({
          REDIS_URL:
            'http://redis:6379',
        });
      },
      /REDIS_URL/,
    );
  },
);

test(
  'reject invalid redis key prefix',
  () => {
    assert.throws(
      () => {
        loadConfig({
          REDIS_KEY_PREFIX:
            'battletwo signaling',
        });
      },
      /REDIS_KEY_PREFIX/,
    );
  },
);

test(
  'reject invalid redis timeout',
  () => {
    assert.throws(
      () => {
        loadConfig({
          REDIS_CONNECT_TIMEOUT_MS:
            '100',
        });
      },
      /REDIS_CONNECT_TIMEOUT_MS/,
    );
  },
);

test(
  'reject peer presence ttl below range',
  () => {
    assert.throws(
      () => {
        loadConfig({
          PEER_PRESENCE_TTL_MS:
            '1000',
        });
      },
      /PEER_PRESENCE_TTL_MS/,
    );
  },
);

test(
  'reject peer presence refresh below range',
  () => {
    assert.throws(
      () => {
        loadConfig({
          PEER_PRESENCE_REFRESH_MS:
            '500',
        });
      },
      /PEER_PRESENCE_REFRESH_MS/,
    );
  },
);

test(
  'reject peer presence refresh not below ttl',
  () => {
    assert.throws(
      () => {
        loadConfig({
          PEER_PRESENCE_TTL_MS:
            '30000',

          PEER_PRESENCE_REFRESH_MS:
            '30000',
        });
      },
      /PEER_PRESENCE_REFRESH_MS must be less than PEER_PRESENCE_TTL_MS/,
    );
  },
);

test(
  'reject resume session ttl below range',
  () => {
    assert.throws(
      () => {
        loadConfig({
          RESUME_SESSION_TTL_MS:
            '4000',
        });
      },
      /RESUME_SESSION_TTL_MS/,
    );
  },
);

test(
  'reject resume claim ttl below range',
  () => {
    assert.throws(
      () => {
        loadConfig({
          RESUME_CLAIM_TTL_MS:
            '500',
        });
      },
      /RESUME_CLAIM_TTL_MS/,
    );
  },
);

test(
  'reject resume claim refresh below range',
  () => {
    assert.throws(
      () => {
        loadConfig({
          RESUME_CLAIM_REFRESH_MS:
            '100',
        });
      },
      /RESUME_CLAIM_REFRESH_MS/,
    );
  },
);

test(
  'reject resume claim ttl not below session ttl',
  () => {
    assert.throws(
      () => {
        loadConfig({
          RESUME_SESSION_TTL_MS:
            '10000',

          RESUME_CLAIM_TTL_MS:
            '10000',
        });
      },
      /RESUME_CLAIM_TTL_MS must be less than RESUME_SESSION_TTL_MS/,
    );
  },
);

test(
  'reject resume claim refresh not below claim ttl',
  () => {
    assert.throws(
      () => {
        loadConfig({
          RESUME_CLAIM_TTL_MS:
            '5000',

          RESUME_CLAIM_REFRESH_MS:
            '5000',
        });
      },
      /RESUME_CLAIM_REFRESH_MS must be less than RESUME_CLAIM_TTL_MS/,
    );
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);