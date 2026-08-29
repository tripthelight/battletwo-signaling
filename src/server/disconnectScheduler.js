function assertObject(
  value,
  name,
) {
  if (
    value === null ||
    (
      typeof value !== 'object' &&
      typeof value !== 'function'
    )
  ) {
    throw new TypeError(
      `${name} must be an object`,
    );
  }
}

function assertFunction(
  value,
  name,
) {
  if (
    typeof value !==
    'function'
  ) {
    throw new TypeError(
      `${name} must be a function`,
    );
  }
}

function assertNonEmptyString(
  value,
  name,
) {
  if (
    typeof value !==
      'string' ||
    value.length === 0 ||
    value.length > 128
  ) {
    throw new TypeError(
      `${name} must be a non-empty string`,
    );
  }
}

function assertPositiveInteger(
  value,
  name,
) {
  if (
    !Number.isInteger(
      value,
    ) ||
    value < 1
  ) {
    throw new TypeError(
      `${name} must be a positive integer`,
    );
  }
}

function assertNonNegativeInteger(
  value,
  name,
) {
  if (
    !Number.isInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new TypeError(
      `${name} must be a non-negative integer`,
    );
  }
}

function assertSafeTime(
  value,
  name,
) {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new TypeError(
      `${name} must be a non-negative safe integer`,
    );
  }
}

function defaultWait(
  delayMs,
) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        delayMs,
      );
    },
  );
}

export function createDisconnectScheduler({
  roomMembership,
  instanceId,
  graceMs,
  retryAttempts =
    20,
  retryDelayMs =
    100,
  now =
    Date.now,
  wait =
    defaultWait,
}) {
  assertObject(
    roomMembership,
    'roomMembership',
  );

  assertFunction(
    roomMembership
      .scheduleDisconnectFenced,
    'roomMembership.scheduleDisconnectFenced',
  );

  assertNonEmptyString(
    instanceId,
    'instanceId',
  );

  assertPositiveInteger(
    graceMs,
    'graceMs',
  );

  assertPositiveInteger(
    retryAttempts,
    'retryAttempts',
  );

  assertNonNegativeInteger(
    retryDelayMs,
    'retryDelayMs',
  );

  assertFunction(
    now,
    'now',
  );

  assertFunction(
    wait,
    'wait',
  );

  /*
   * dueAtMs를 생략하면 최초 호출 시점 + graceMs를 쓴다.
   *
   * 상위 계층이 같은 disconnect cleanup을 다시 시도할 때는
   * 최초에 계산한 dueAtMs를 다시 전달할 수 있다.
   *
   * 이렇게 해야 Redis 장애 시간만큼 grace period가
   * 계속 뒤로 밀리지 않는다.
   */
  async function schedule(
    peerId,
    {
      dueAtMs:
        suppliedDueAtMs =
        null,
    } = {},
  ) {
    assertNonEmptyString(
      peerId,
      'peerId',
    );

    let dueAtMs;

    if (
      suppliedDueAtMs ===
      null
    ) {
      const startedAtMs =
        now();

      assertSafeTime(
        startedAtMs,
        'now()',
      );

      dueAtMs =
        startedAtMs +
        graceMs;

      assertSafeTime(
        dueAtMs,
        'dueAtMs',
      );
    } else {
      assertSafeTime(
        suppliedDueAtMs,
        'dueAtMs',
      );

      dueAtMs =
        suppliedDueAtMs;
    }

    const errors =
      [];

    for (
      let attempt = 1;
      attempt <=
      retryAttempts;
      attempt += 1
    ) {
      let result;

      try {
        result =
          await roomMembership
            .scheduleDisconnectFenced({
              peerId,

              dueAtMs,

              expectedPresenceOwner:
                instanceId,
            });
      } catch (error) {
        errors.push(
          error,
        );

        if (
          attempt >=
          retryAttempts
        ) {
          throw new AggregateError(
            errors,
            `failed to durably schedule disconnect for peer ${peerId}`,
          );
        }

        await wait(
          retryDelayMs,
        );

        continue;
      }

      if (
        result.status ===
        'scheduled'
      ) {
        return Object.freeze({
          status:
            'scheduled',

          peerId,

          roomId:
            result.roomId,

          dueAtMs,

          attempts:
            attempt,
        });
      }

      if (
        result.status ===
        'owner-changed'
      ) {
        return Object.freeze({
          status:
            'owner-changed',

          peerId,

          owner:
            result.owner,

          dueAtMs,

          attempts:
            attempt,
        });
      }

      if (
        result.status ===
        'not-member'
      ) {
        return Object.freeze({
          status:
            'not-member',

          peerId,

          dueAtMs,

          attempts:
            attempt,
        });
      }

      throw new Error(
        `unexpected fenced disconnect status: ${result.status}`,
      );
    }

    throw new Error(
      `disconnect scheduler exhausted unexpectedly for peer ${peerId}`,
    );
  }

  return Object.freeze({
    schedule,
  });
}