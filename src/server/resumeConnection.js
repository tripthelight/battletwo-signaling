import {
  randomUUID,
} from 'node:crypto';

import {
  generateResumeToken,
  isValidResumeToken,
} from './resumeToken.js';

const DEFAULT_ISSUE_ATTEMPTS =
  3;

function isNonEmptyString(
  value,
  maxLength = 128,
) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength
  );
}

function assertConnection(
  connection,
) {
  if (
    connection === null ||
    (
      typeof connection !== 'object' &&
      typeof connection !== 'function'
    )
  ) {
    throw new TypeError(
      'connection must be an object',
    );
  }
}

function assertPeerId(
  peerId,
) {
  if (!isNonEmptyString(peerId)) {
    throw new TypeError(
      'peerId must be a non-empty string',
    );
  }
}

function assertRoomId(
  roomId,
) {
  if (!isNonEmptyString(roomId)) {
    throw new TypeError(
      'roomId must be a non-empty string',
    );
  }
}

function assertRole(
  role,
) {
  if (
    role !== 'impolite' &&
    role !== 'polite'
  ) {
    throw new TypeError(
      'role must be impolite or polite',
    );
  }
}

function assertClaimId(
  claimId,
) {
  if (!isNonEmptyString(claimId)) {
    throw new TypeError(
      'claimId must be a non-empty string',
    );
  }
}

function assertToken(
  token,
) {
  if (
    !isValidResumeToken(
      token,
    )
  ) {
    throw new TypeError(
      'invalid resume token',
    );
  }
}

function assertOnLost(
  onLost,
) {
  if (
    onLost !== null &&
    typeof onLost !== 'function'
  ) {
    throw new TypeError(
      'onLost must be a function',
    );
  }
}

function assertIssueAttempts(
  issueAttempts,
) {
  if (
    !Number.isInteger(
      issueAttempts,
    ) ||
    issueAttempts < 1 ||
    issueAttempts > 100
  ) {
    throw new TypeError(
      'issueAttempts must be an integer between 1 and 100',
    );
  }
}

function assertStore(
  store,
) {
  if (
    !store ||
    typeof store.create !== 'function' ||
    typeof store.claim !== 'function' ||
    typeof store.release !== 'function' ||
    typeof store.remove !== 'function'
  ) {
    throw new TypeError(
      'resume session store is required',
    );
  }
}

function assertClaimManager(
  claimManager,
) {
  if (
    !claimManager ||
    typeof claimManager.track !== 'function' ||
    typeof claimManager.untrack !== 'function' ||
    typeof claimManager.release !== 'function'
  ) {
    throw new TypeError(
      'resume claim manager is required',
    );
  }
}

function assertGenerator(
  generator,
  name,
) {
  if (
    typeof generator !==
    'function'
  ) {
    throw new TypeError(
      `${name} must be a function`,
    );
  }
}

function publicRecord(
  status,
  record,
) {
  return Object.freeze({
    status,

    token:
      record.token,

    peerId:
      record.peerId,

    roomId:
      record.roomId,

    role:
      record.role,
  });
}

export function createResumeConnectionManager({
  store,
  claimManager,
  issueAttempts =
    DEFAULT_ISSUE_ATTEMPTS,
  generateToken =
    generateResumeToken,
  generateClaimId =
    randomUUID,
}) {
  assertStore(
    store,
  );

  assertClaimManager(
    claimManager,
  );

  assertIssueAttempts(
    issueAttempts,
  );

  assertGenerator(
    generateToken,
    'generateToken',
  );

  assertGenerator(
    generateClaimId,
    'generateClaimId',
  );

  const active =
    new WeakMap();

  function get(
    connection,
  ) {
    assertConnection(
      connection,
    );

    const record =
      active.get(
        connection,
      );

    if (!record) {
      return null;
    }

    return publicRecord(
      'active',
      record,
    );
  }

  function has(
    connection,
  ) {
    assertConnection(
      connection,
    );

    return active.has(
      connection,
    );
  }

  function createLostHandler(
    connection,
    record,
    onLost,
  ) {
    return async (
      event,
    ) => {
      if (
        active.get(
          connection,
        ) !== record
      ) {
        return;
      }

      active.delete(
        connection,
      );

      if (!onLost) {
        return;
      }

      await onLost({
        ...event,

        peerId:
          record.peerId,

        roomId:
          record.roomId,

        role:
          record.role,
      });
    };
  }

  async function removeCreatedSession(
    record,
  ) {
    const removed =
      await store.remove({
        token:
          record.token,

        claimId:
          record.claimId,
      });

    if (!removed) {
      throw new Error(
        'failed to remove untracked resume session',
      );
    }
  }

  async function issue({
    connection,
    peerId,
    roomId,
    role,
    onLost = null,
  }) {
    assertConnection(
      connection,
    );

    assertPeerId(
      peerId,
    );

    assertRoomId(
      roomId,
    );

    assertRole(
      role,
    );

    assertOnLost(
      onLost,
    );

    const existing =
      active.get(
        connection,
      );

    if (existing) {
      return publicRecord(
        'active',
        existing,
      );
    }

    for (
      let attempt = 0;
      attempt <
      issueAttempts;
      attempt += 1
    ) {
      const token =
        generateToken();

      const claimId =
        generateClaimId();

      assertToken(
        token,
      );

      assertClaimId(
        claimId,
      );

      const created =
        await store.create({
          token,
          peerId,
          roomId,
          role,
          claimId,
        });

      if (!created) {
        continue;
      }

      const record = {
        token,
        claimId,
        peerId,
        roomId,
        role,
      };

      active.set(
        connection,
        record,
      );

      let tracked;

      try {
        tracked =
          claimManager.track({
            token,
            claimId,

            onLost:
              createLostHandler(
                connection,
                record,
                onLost,
              ),
          });
      } catch (error) {
        active.delete(
          connection,
        );

        try {
          await removeCreatedSession(
            record,
          );
        } catch (
          cleanupError
        ) {
          console.error(
            '[resume] failed to clean up untracked session:',
            cleanupError,
          );
        }

        throw error;
      }

      if (!tracked) {
        active.delete(
          connection,
        );

        await removeCreatedSession(
          record,
        );

        continue;
      }

      return publicRecord(
        'issued',
        record,
      );
    }

    return Object.freeze({
      status:
        'collision',
    });
  }

  async function claim({
    connection,
    token,
    onLost = null,
  }) {
    assertConnection(
      connection,
    );

    assertToken(
      token,
    );

    assertOnLost(
      onLost,
    );

    if (
      active.has(
        connection,
      )
    ) {
      throw new Error(
        'connection already owns a resume session',
      );
    }

    const claimId =
      generateClaimId();

    assertClaimId(
      claimId,
    );

    const result =
      await store.claim({
        token,
        claimId,
      });

    if (
      result.status !==
      'acquired'
    ) {
      return Object.freeze({
        ...result,
      });
    }

    const record = {
      token,
      claimId,

      peerId:
        result.peerId,

      roomId:
        result.roomId,

      role:
        result.role,
    };

    active.set(
      connection,
      record,
    );

    let tracked;

    try {
      tracked =
        claimManager.track({
          token,
          claimId,

          onLost:
            createLostHandler(
              connection,
              record,
              onLost,
            ),
        });
    } catch (error) {
      active.delete(
        connection,
      );

      try {
        await store.release({
          token,
          claimId,
        });
      } catch (
        cleanupError
      ) {
        console.error(
          '[resume] failed to release untracked claim:',
          cleanupError,
        );
      }

      throw error;
    }

    if (!tracked) {
      active.delete(
        connection,
      );

      await store.release({
        token,
        claimId,
      });

      throw new Error(
        'failed to track acquired resume claim',
      );
    }

    return publicRecord(
      'acquired',
      record,
    );
  }

  async function release(
    connection,
  ) {
    assertConnection(
      connection,
    );

    const record =
      active.get(
        connection,
      );

    if (!record) {
      return false;
    }

    active.delete(
      connection,
    );

    return claimManager.release(
      record.claimId,
    );
  }

  async function remove(
    connection,
  ) {
    assertConnection(
      connection,
    );

    const record =
      active.get(
        connection,
      );

    if (!record) {
      return false;
    }

    active.delete(
      connection,
    );

    claimManager.untrack(
      record.claimId,
    );

    return store.remove({
      token:
        record.token,

      claimId:
        record.claimId,
    });
  }

  return Object.freeze({
    issue,
    claim,
    release,
    remove,
    get,
    has,
  });
}