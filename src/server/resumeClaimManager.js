import {
  isValidResumeToken,
} from './resumeToken.js';

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

function assertRefreshMs(
  refreshMs,
) {
  if (
    !Number.isInteger(refreshMs) ||
    refreshMs < 100
  ) {
    throw new TypeError(
      'refreshMs must be an integer >= 100',
    );
  }
}

function assertStore(
  store,
) {
  if (
    !store ||
    typeof store.refresh !== 'function' ||
    typeof store.release !== 'function'
  ) {
    throw new TypeError(
      'resume session store is required',
    );
  }
}

export function createResumeClaimManager({
  store,
  refreshMs,
}) {
  assertStore(
    store,
  );

  assertRefreshMs(
    refreshMs,
  );

  const active =
    new Map();

  let refreshRunning =
    false;

  let refreshTimer =
    null;

  function track({
    token,
    claimId,
    onLost = null,
  }) {
    assertToken(
      token,
    );

    assertClaimId(
      claimId,
    );

    if (
      onLost !== null &&
      typeof onLost !== 'function'
    ) {
      throw new TypeError(
        'onLost must be a function',
      );
    }

    const existing =
      active.get(
        claimId,
      );

    if (existing) {
      if (
        existing.token === token
      ) {
        return false;
      }

      throw new Error(
        `claimId collision: ${claimId}`,
      );
    }

    active.set(
      claimId,
      {
        token,
        claimId,
        onLost,
      },
    );

    return true;
  }

  function untrack(
    claimId,
  ) {
    assertClaimId(
      claimId,
    );

    return active.delete(
      claimId,
    );
  }

  function getActiveCount() {
    return active.size;
  }

  async function notifyLost(
    entry,
    reason,
    error = null,
  ) {
    if (
      active.get(
        entry.claimId,
      ) !== entry
    ) {
      return;
    }

    active.delete(
      entry.claimId,
    );

    if (!entry.onLost) {
      return;
    }

    await entry.onLost({
      claimId:
        entry.claimId,
      reason,
      error,
    });
  }

  async function refreshOne(
    entry,
  ) {
    if (
      active.get(
        entry.claimId,
      ) !== entry
    ) {
      return;
    }

    try {
      const refreshed =
        await store.refresh({
          token:
            entry.token,
          claimId:
            entry.claimId,
        });

      if (
        active.get(
          entry.claimId,
        ) !== entry
      ) {
        return;
      }

      if (!refreshed) {
        await notifyLost(
          entry,
          'claim-lost',
        );
      }
    } catch (error) {
      if (
        active.get(
          entry.claimId,
        ) !== entry
      ) {
        return;
      }

      await notifyLost(
        entry,
        'refresh-error',
        error,
      );
    }
  }

  async function refreshNow() {
    if (refreshRunning) {
      return false;
    }

    refreshRunning =
      true;

    try {
      const entries =
        Array.from(
          active.values(),
        );

      await Promise.allSettled(
        entries.map(
          refreshOne,
        ),
      );

      return true;
    } finally {
      refreshRunning =
        false;
    }
  }

  function start() {
    if (
      refreshTimer !== null
    ) {
      return false;
    }

    refreshTimer =
      setInterval(
        () => {
          void refreshNow();
        },
        refreshMs,
      );

    refreshTimer.unref();

    return true;
  }

  function stop() {
    if (
      refreshTimer === null
    ) {
      return false;
    }

    clearInterval(
      refreshTimer,
    );

    refreshTimer =
      null;

    return true;
  }

  async function release(
    claimId,
  ) {
    assertClaimId(
      claimId,
    );

    const entry =
      active.get(
        claimId,
      );

    if (!entry) {
      return false;
    }

    active.delete(
      claimId,
    );

    return store.release({
      token:
        entry.token,
      claimId:
        entry.claimId,
    });
  }

  async function releaseAll() {
    const entries =
      Array.from(
        active.values(),
      );

    active.clear();

    return Promise.allSettled(
      entries.map(
        (entry) =>
          store.release({
            token:
              entry.token,
            claimId:
              entry.claimId,
          }),
      ),
    );
  }

  return Object.freeze({
    track,
    untrack,
    getActiveCount,
    refreshNow,
    start,
    stop,
    release,
    releaseAll,
  });
}