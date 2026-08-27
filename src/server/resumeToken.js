import {
  createHash,
  randomBytes,
} from 'node:crypto';

const TOKEN_BYTES = 32;
const TOKEN_LENGTH = 43;

function assertKeyPrefix(
  keyPrefix,
) {
  if (
    typeof keyPrefix !== 'string' ||
    keyPrefix.length === 0
  ) {
    throw new TypeError(
      'keyPrefix must be a non-empty string',
    );
  }
}

export function isValidResumeToken(
  token,
) {
  return (
    typeof token === 'string' &&
    token.length === TOKEN_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(
      token,
    )
  );
}

export function generateResumeToken() {
  return randomBytes(
    TOKEN_BYTES,
  ).toString(
    'base64url',
  );
}

export function makeResumeSessionKey(
  keyPrefix,
  token,
) {
  assertKeyPrefix(
    keyPrefix,
  );

  if (
    !isValidResumeToken(
      token,
    )
  ) {
    throw new TypeError(
      'invalid resume token',
    );
  }

  const digest =
    createHash(
      'sha256',
    )
      .update(
        token,
        'utf8',
      )
      .digest(
        'hex',
      );

  return (
    `${keyPrefix}:resume:${digest}`
  );
}