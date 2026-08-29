import {
  createHmac,
  randomUUID,
} from 'node:crypto';

import {
  readFileSync,
} from 'node:fs';

import {
  createServer,
} from 'node:http';

const DEFAULTS = Object.freeze({
  host: '0.0.0.0',
  port: 5001,

  credentialTtlSeconds: 900,

  turnUrls: [
    'turn:220.71.2.126:3478?transport=udp',
  ],

  sharedSecretFile:
    '/run/secrets/turn_shared_secret',

  allowedOrigin: '*',
});

function readString(
  env,
  name,
  fallback,
  maxLength = 2_048,
) {
  const raw =
    env[name];

  if (
    raw === undefined ||
    raw === null ||
    String(raw).trim() === ''
  ) {
    return fallback;
  }

  const value =
    String(raw).trim();

  if (
    value.length >
    maxLength
  ) {
    throw new Error(
      `[turn-credentials] ${name} is too long`,
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
  const raw =
    env[name];

  if (
    raw === undefined ||
    raw === null ||
    String(raw).trim() === ''
  ) {
    return fallback;
  }

  const value =
    Number(raw);

  if (
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(
      `[turn-credentials] ${name} must be an integer between ${min} and ${max}`,
    );
  }

  return value;
}

function readTurnUrls(
  env,
) {
  const raw =
    readString(
      env,
      'TURN_URLS',
      DEFAULTS.turnUrls.join(','),
      4_096,
    );

  const urls =
    raw
      .split(',')
      .map(
        (value) =>
          value.trim(),
      )
      .filter(Boolean);

  if (
    urls.length === 0
  ) {
    throw new Error(
      '[turn-credentials] TURN_URLS must contain at least one URL',
    );
  }

  for (
    const url
    of urls
  ) {
    if (
      !url.startsWith('turn:') &&
      !url.startsWith('turns:')
    ) {
      throw new Error(
        `[turn-credentials] invalid TURN URL: ${url}`,
      );
    }
  }

  return urls;
}

function loadConfig(
  env = process.env,
) {
  return Object.freeze({
    host:
      readString(
        env,
        'TURN_CREDENTIAL_HOST',
        DEFAULTS.host,
      ),

    port:
      readInteger(
        env,
        'TURN_CREDENTIAL_PORT',
        DEFAULTS.port,
        {
          min: 1,
          max: 65_535,
        },
      ),

    credentialTtlSeconds:
      readInteger(
        env,
        'TURN_CREDENTIAL_TTL_SECONDS',
        DEFAULTS.credentialTtlSeconds,
        {
          min: 60,
          max: 86_400,
        },
      ),

    turnUrls:
      Object.freeze(
        readTurnUrls(
          env,
        ),
      ),

    sharedSecretFile:
      readString(
        env,
        'TURN_SHARED_SECRET_FILE',
        DEFAULTS.sharedSecretFile,
      ),

    allowedOrigin:
      readString(
        env,
        'TURN_CREDENTIAL_ALLOWED_ORIGIN',
        DEFAULTS.allowedOrigin,
      ),
  });
}

function readSharedSecret(
  filePath,
) {
  let secret;

  try {
    secret =
      readFileSync(
        filePath,
        'utf8',
      ).trim();
  } catch (error) {
    throw new Error(
      `[turn-credentials] failed to read shared secret file: ${filePath}`,
      {
        cause: error,
      },
    );
  }

  if (
    !/^[0-9a-f]{64}$/.test(
      secret,
    )
  ) {
    throw new Error(
      '[turn-credentials] shared secret must be exactly 64 lowercase hexadecimal characters',
    );
  }

  return secret;
}

function createTemporaryCredential({
  sharedSecret,
  ttlSeconds,
  nowSeconds =
    Math.floor(
      Date.now() / 1000,
    ),
}) {
  const expiresAt =
    nowSeconds +
    ttlSeconds;

  const username =
    `${expiresAt}:battletwo-${randomUUID()}`;

  const credential =
    createHmac(
      'sha1',
      sharedSecret,
    )
      .update(
        username,
      )
      .digest(
        'base64',
      );

  return {
    username,
    credential,
    expiresAt,
  };
}

function setCommonHeaders(
  response,
  allowedOrigin,
) {
  response.setHeader(
    'Access-Control-Allow-Origin',
    allowedOrigin,
  );

  response.setHeader(
    'Access-Control-Allow-Methods',
    'GET, OPTIONS',
  );

  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type',
  );

  response.setHeader(
    'Cache-Control',
    'no-store, no-cache, must-revalidate',
  );

  response.setHeader(
    'Pragma',
    'no-cache',
  );

  response.setHeader(
    'X-Content-Type-Options',
    'nosniff',
  );
}

function sendJson(
  response,
  statusCode,
  body,
  allowedOrigin,
) {
  const json =
    JSON.stringify(
      body,
    );

  setCommonHeaders(
    response,
    allowedOrigin,
  );

  response.statusCode =
    statusCode;

  response.setHeader(
    'Content-Type',
    'application/json; charset=utf-8',
  );

  response.setHeader(
    'Content-Length',
    Buffer.byteLength(
      json,
    ),
  );

  response.end(
    json,
  );
}

function createRequestHandler({
  config,
  sharedSecret,
}) {
  return (
    request,
    response,
  ) => {
    const url =
      new URL(
        request.url ?? '/',
        'http://localhost',
      );

    if (
      request.method === 'OPTIONS'
    ) {
      setCommonHeaders(
        response,
        config.allowedOrigin,
      );

      response.statusCode =
        204;

      response.end();

      return;
    }

    if (
      request.method === 'GET' &&
      url.pathname === '/healthz'
    ) {
      sendJson(
        response,
        200,
        {
          status: 'ok',
        },
        config.allowedOrigin,
      );

      return;
    }

    if (
      request.method === 'GET' &&
      url.pathname === '/turn-credentials'
    ) {
      const temporary =
        createTemporaryCredential({
          sharedSecret,

          ttlSeconds:
            config.credentialTtlSeconds,
        });

      sendJson(
        response,
        200,
        {
          iceServer: {
            urls:
              config.turnUrls,

            username:
              temporary.username,

            credential:
              temporary.credential,
          },

          expiresAt:
            temporary.expiresAt,

          ttlSeconds:
            config.credentialTtlSeconds,
        },
        config.allowedOrigin,
      );

      return;
    }

    sendJson(
      response,
      404,
      {
        error:
          'not_found',
      },
      config.allowedOrigin,
    );
  };
}

const config =
  loadConfig();

const sharedSecret =
  readSharedSecret(
    config.sharedSecretFile,
  );

const server =
  createServer(
    createRequestHandler({
      config,
      sharedSecret,
    }),
  );

server.on(
  'clientError',
  (
    error,
    socket,
  ) => {
    console.error(
      '[turn-credentials] client error:',
      error.message,
    );

    if (
      socket.writable
    ) {
      socket.end(
        'HTTP/1.1 400 Bad Request\r\n\r\n',
      );
    }
  },
);

function shutdown(
  signal,
) {
  console.log(
    `[turn-credentials] received ${signal}; shutting down`,
  );

  server.close(
    (error) => {
      if (
        error
      ) {
        console.error(
          '[turn-credentials] shutdown failed:',
          error,
        );

        process.exitCode =
          1;
      }

      process.exit();
    },
  );

  setTimeout(
    () => {
      console.error(
        '[turn-credentials] forced shutdown after timeout',
      );

      process.exit(
        1,
      );
    },
    10_000,
  ).unref();
}

process.once(
  'SIGTERM',
  () =>
    shutdown(
      'SIGTERM',
    ),
);

process.once(
  'SIGINT',
  () =>
    shutdown(
      'SIGINT',
    ),
);

server.listen(
  config.port,
  config.host,
  () => {
    console.log(
      `[turn-credentials] listening on ${config.host}:${config.port}`,
    );

    console.log(
      `[turn-credentials] TURN URLs: ${config.turnUrls.join(', ')}`,
    );

    console.log(
      `[turn-credentials] credential TTL: ${config.credentialTtlSeconds}s`,
    );
  },
);