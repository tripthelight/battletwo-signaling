import {
  randomUUID,
} from 'crypto';

import Redis from 'ioredis';

import {
  config,
} from './config.js';

function createRedisClient(
  redisUrl,
  connectTimeoutMs,
) {
  return new Redis(
    redisUrl,
    {
      lazyConnect: true,

      connectTimeout:
        connectTimeoutMs,

      maxRetriesPerRequest: 1,

      enableOfflineQueue: false,
    },
  );
}

export function makeInstanceChannel(
  keyPrefix,
  instanceId,
) {
  if (
    typeof keyPrefix !== 'string' ||
    keyPrefix.length === 0
  ) {
    throw new TypeError(
      'keyPrefix must be a non-empty string',
    );
  }

  if (
    typeof instanceId !== 'string' ||
    instanceId.length === 0
  ) {
    throw new TypeError(
      'instanceId must be a non-empty string',
    );
  }

  return (
    `${keyPrefix}:instance:${instanceId}`
  );
}

export function createRedisContext({
  redisUrl =
    config.redisUrl,

  keyPrefix =
    config.redisKeyPrefix,

  connectTimeoutMs =
    config.redisConnectTimeoutMs,

  instanceId =
    randomUUID(),
} = {}) {
  const command =
    createRedisClient(
      redisUrl,
      connectTimeoutMs,
    );

  const publisher =
    createRedisClient(
      redisUrl,
      connectTimeoutMs,
    );

  const subscriber =
    createRedisClient(
      redisUrl,
      connectTimeoutMs,
    );

  const instanceChannel =
    makeInstanceChannel(
      keyPrefix,
      instanceId,
    );

  async function connect() {
    try {
      await Promise.all([
        command.connect(),
        publisher.connect(),
        subscriber.connect(),
      ]);

      const pong =
        await command.ping();

      if (pong !== 'PONG') {
        throw new Error(
          'unexpected Redis PING response',
        );
      }
    } catch (error) {
      command.disconnect();
      publisher.disconnect();
      subscriber.disconnect();

      throw error;
    }
  }

  function disconnect() {
    command.disconnect();
    publisher.disconnect();
    subscriber.disconnect();
  }

  return Object.freeze({
    instanceId,
    instanceChannel,

    command,
    publisher,
    subscriber,

    connect,
    disconnect,
  });
}

export const redis =
  createRedisContext();