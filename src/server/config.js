import dotenv from 'dotenv';

dotenv.config();

const DEFAULTS = Object.freeze({
  rtcHost: '0.0.0.0',
  rtcPort: 5000,

  roomTtlMs: 15_000,
  shutdownCleanupTimeoutMs: 10_000,
  maxPayloadBytes: 64 * 1024,

  redisUrl: 'redis://127.0.0.1:6379',
  redisKeyPrefix: 'battletwo:signaling',
  redisConnectTimeoutMs: 5_000,

  peerPresenceTtlMs: 30_000,
  peerPresenceRefreshMs: 10_000,

  resumeSessionTtlMs: 15_000,
  resumeClaimTtlMs: 5_000,
  resumeClaimRefreshMs: 2_000,
});

function readString(
  env,
  name,
  fallback,
  maxLength = 255,
) {
  const raw = env[name];

  if (
    raw === undefined ||
    raw === null
  ) {
    return fallback;
  }

  const value =
    String(raw).trim();

  if (value.length === 0) {
    return fallback;
  }

  if (value.length > maxLength) {
    throw new Error(
      `[config] ${name} is too long`,
    );
  }

  return value;
}

function readInteger(
  env,
  name,
  fallback,
  {
    min,
    max,
  },
) {
  const raw = env[name];

  if (
    raw === undefined ||
    raw === null ||
    String(raw).trim() === ''
  ) {
    return fallback;
  }

  const value = Number(raw);

  if (
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(
      `[config] ${name} must be an integer between ${min} and ${max}`,
    );
  }

  return value;
}

function readRedisUrl(
  env,
) {
  const value = readString(
    env,
    'REDIS_URL',
    DEFAULTS.redisUrl,
    2_048,
  );

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      '[config] REDIS_URL is invalid',
    );
  }

  if (
    parsed.protocol !== 'redis:' &&
    parsed.protocol !== 'rediss:'
  ) {
    throw new Error(
      '[config] REDIS_URL must use redis:// or rediss://',
    );
  }

  if (!parsed.hostname) {
    throw new Error(
      '[config] REDIS_URL must include a host',
    );
  }

  return value;
}

function readRedisKeyPrefix(
  env,
) {
  const value = readString(
    env,
    'REDIS_KEY_PREFIX',
    DEFAULTS.redisKeyPrefix,
    128,
  );

  if (
    !/^[a-zA-Z0-9:_-]+$/.test(
      value,
    )
  ) {
    throw new Error(
      '[config] REDIS_KEY_PREFIX contains invalid characters',
    );
  }

  return value;
}

export function loadConfig(
  env = process.env,
) {
  const peerPresenceTtlMs =
    readInteger(
      env,
      'PEER_PRESENCE_TTL_MS',
      DEFAULTS.peerPresenceTtlMs,
      {
        min: 5_000,
        max: 5 * 60_000,
      },
    );

  const peerPresenceRefreshMs =
    readInteger(
      env,
      'PEER_PRESENCE_REFRESH_MS',
      DEFAULTS.peerPresenceRefreshMs,
      {
        min: 1_000,
        max: 60_000,
      },
    );

  if (
    peerPresenceRefreshMs >=
    peerPresenceTtlMs
  ) {
    throw new Error(
      '[config] PEER_PRESENCE_REFRESH_MS must be less than PEER_PRESENCE_TTL_MS',
    );
  }

  const resumeSessionTtlMs =
    readInteger(
      env,
      'RESUME_SESSION_TTL_MS',
      DEFAULTS.resumeSessionTtlMs,
      {
        min: 5_000,
        max: 5 * 60_000,
      },
    );

  const resumeClaimTtlMs =
    readInteger(
      env,
      'RESUME_CLAIM_TTL_MS',
      DEFAULTS.resumeClaimTtlMs,
      {
        min: 1_000,
        max: 60_000,
      },
    );

  const resumeClaimRefreshMs =
    readInteger(
      env,
      'RESUME_CLAIM_REFRESH_MS',
      DEFAULTS.resumeClaimRefreshMs,
      {
        min: 500,
        max: 60_000,
      },
    );

  if (
    resumeClaimTtlMs >=
    resumeSessionTtlMs
  ) {
    throw new Error(
      '[config] RESUME_CLAIM_TTL_MS must be less than RESUME_SESSION_TTL_MS',
    );
  }

  if (
    resumeClaimRefreshMs >=
    resumeClaimTtlMs
  ) {
    throw new Error(
      '[config] RESUME_CLAIM_REFRESH_MS must be less than RESUME_CLAIM_TTL_MS',
    );
  }

  return Object.freeze({
    rtcHost: readString(
      env,
      'RTC_HOST',
      DEFAULTS.rtcHost,
    ),

    rtcPort: readInteger(
      env,
      'RTC_PORT',
      DEFAULTS.rtcPort,
      {
        min: 1,
        max: 65_535,
      },
    ),

    roomTtlMs: readInteger(
      env,
      'ROOM_TTL_MS',
      DEFAULTS.roomTtlMs,
      {
        min: 1_000,
        max: 5 * 60_000,
      },
    ),

    shutdownCleanupTimeoutMs:
      readInteger(
        env,
        'SHUTDOWN_CLEANUP_TIMEOUT_MS',
        DEFAULTS.shutdownCleanupTimeoutMs,
        {
          min: 1_000,
          max: 60_000,
        },
      ),

    maxPayloadBytes:
      readInteger(
        env,
        'WS_MAX_PAYLOAD_BYTES',
        DEFAULTS.maxPayloadBytes,
        {
          min: 1_024,
          max: 1024 * 1024,
        },
      ),

    redisUrl:
      readRedisUrl(env),

    redisKeyPrefix:
      readRedisKeyPrefix(env),

    redisConnectTimeoutMs:
      readInteger(
        env,
        'REDIS_CONNECT_TIMEOUT_MS',
        DEFAULTS.redisConnectTimeoutMs,
        {
          min: 500,
          max: 30_000,
        },
      ),

    peerPresenceTtlMs,
    peerPresenceRefreshMs,

    resumeSessionTtlMs,
    resumeClaimTtlMs,
    resumeClaimRefreshMs,
  });
}

export const config =
  loadConfig();