import assert from 'node:assert/strict';

import {
  generateResumeToken,
  isValidResumeToken,
  makeResumeSessionKey,
} from '../src/server/resumeToken.js';

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

await test(
  'generate valid resume token',
  async () => {
    const token =
      generateResumeToken();

    assert.equal(
      token.length,
      43,
    );

    assert.equal(
      isValidResumeToken(
        token,
      ),
      true,
    );
  },
);

await test(
  'generate distinct tokens',
  async () => {
    const tokenA =
      generateResumeToken();

    const tokenB =
      generateResumeToken();

    assert.notEqual(
      tokenA,
      tokenB,
    );
  },
);

await test(
  'reject invalid resume tokens',
  async () => {
    const invalid = [
      null,
      '',
      'abc',
      'a'.repeat(42),
      'a'.repeat(44),
      `${'a'.repeat(42)}!`,
    ];

    for (
      const token
      of invalid
    ) {
      assert.equal(
        isValidResumeToken(
          token,
        ),
        false,
      );
    }
  },
);

await test(
  'build deterministic hashed session key',
  async () => {
    const token =
      generateResumeToken();

    const keyA =
      makeResumeSessionKey(
        'bt:test',
        token,
      );

    const keyB =
      makeResumeSessionKey(
        'bt:test',
        token,
      );

    assert.equal(
      keyA,
      keyB,
    );

    assert.match(
      keyA,
      /^bt:test:resume:[a-f0-9]{64}$/,
    );
  },
);

await test(
  'do not expose raw token in redis key',
  async () => {
    const token =
      generateResumeToken();

    const key =
      makeResumeSessionKey(
        'bt:test',
        token,
      );

    assert.equal(
      key.includes(
        token,
      ),
      false,
    );
  },
);

await test(
  'different tokens use different keys',
  async () => {
    const tokenA =
      generateResumeToken();

    const tokenB =
      generateResumeToken();

    assert.notEqual(
      makeResumeSessionKey(
        'bt:test',
        tokenA,
      ),
      makeResumeSessionKey(
        'bt:test',
        tokenB,
      ),
    );
  },
);

await test(
  'reject invalid token when building key',
  async () => {
    assert.throws(
      () => {
        makeResumeSessionKey(
          'bt:test',
          'invalid',
        );
      },
      /invalid resume token/,
    );
  },
);

console.log(
  `ALL TESTS PASSED: ${passed}`,
);