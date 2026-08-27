import dotenv from 'dotenv';

dotenv.config();

const DEFAULTS = Object.freeze({
  rtcHost: '0.0.0.0',
  rtcPort: 5000,
  roomTtlMs: 15_000,
  maxPayloadBytes: 64 * 1024,
});

function readString(
  env,
  name,
  fallback,
  maxLength = 255,
) {
  const raw = env[name];

  if (raw === undefined || raw === null) {
    return fallback;
  }

  const value = String(raw).trim();

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

export function loadConfig(
  env = process.env,
) {
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

    maxPayloadBytes: readInteger(
      env,
      'WS_MAX_PAYLOAD_BYTES',
      DEFAULTS.maxPayloadBytes,
      {
        min: 1_024,
        max: 1024 * 1024,
      },
    ),
  });
}

export const config = loadConfig();