const crypto = require('crypto');

const WINDOW_MS = Number.parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000', 10);
const MAX_REQUESTS = Number.parseInt(process.env.API_RATE_LIMIT_MAX || '60', 10);
const AUTH_HEADER = 'authorization';
const BROWSER_TOKEN_TTL_MS = Number.parseInt(
  process.env.BROWSER_TOKEN_TTL_MS || '300000',
  10
);
const browserTokenStore = new Map();

const rateLimitStore = new Map();

function withRemediation(message, remediation) {
  return `${message}. Remediation: ${remediation}`;
}

function getClientIdentity(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function requestLogger(req, res, next) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const client = getClientIdentity(req);

  req.requestId = requestId;

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const log = {
      timestamp: new Date().toISOString(),
      requestId,
      client,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      userAgent: req.get('user-agent') || 'unknown'
    };

    console.info('[api]', JSON.stringify(log));
  });

  next();
}

function requireControlAuth(req, res, next) {
  const configuredToken = process.env.API_AUTH_TOKEN;
  const authHeader = req.get(AUTH_HEADER);
  const providedToken = readBearerToken(authHeader);

  if (providedToken && verifyConfiguredToken(providedToken, configuredToken)) {
    return next();
  }

  if (providedToken && verifyBrowserToken(providedToken)) {
    return next();
  }

  if (!configuredToken && !process.env.DASHBOARD_LOGIN_PASSWORD) {
    return res.status(503).json({
      success: false,
      error: {
        code: 'AUTH_NOT_CONFIGURED',
        message: withRemediation(
          'Control API auth is not configured',
          'set API_AUTH_TOKEN or DASHBOARD_LOGIN_PASSWORD before exposing control endpoints'
        )
      }
    });
  }

  if (!providedToken) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: withRemediation(
          'Missing bearer token',
          'send Authorization: Bearer <token> with a valid API or browser session token'
        )
      }
    });
  }

  return res.status(401).json({
    success: false,
    error: {
      code: 'UNAUTHORIZED',
      message: withRemediation(
        'Invalid or expired bearer token',
        'request a new token via /api/auth/login or update API_AUTH_TOKEN client configuration'
      )
    }
  });
}

function readBearerToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice(7).trim();
}

function verifyConfiguredToken(providedToken, configuredToken) {
  if (!configuredToken) {
    return false;
  }

  const expected = Buffer.from(configuredToken, 'utf8');
  const provided = Buffer.from(providedToken, 'utf8');

  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function verifyBrowserToken(token) {
  if (!token) {
    return false;
  }

  const record = browserTokenStore.get(token);
  if (!record) {
    return false;
  }

  if (Date.now() > record.expiresAt) {
    browserTokenStore.delete(token);
    return false;
  }

  return true;
}

function issueBrowserToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + BROWSER_TOKEN_TTL_MS;
  browserTokenStore.set(token, { expiresAt });
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

function purgeExpiredBrowserTokens() {
  const now = Date.now();
  for (const [token, entry] of browserTokenStore.entries()) {
    if (entry.expiresAt <= now) {
      browserTokenStore.delete(token);
    }
  }
}

function rateLimitControls(req, res, next) {
  const now = Date.now();
  const identity = getClientIdentity(req);
  const key = `${identity}:${req.path}`;
  const previous = rateLimitStore.get(key);

  if (!previous || now - previous.windowStart >= WINDOW_MS) {
    rateLimitStore.set(key, { windowStart: now, count: 1 });
    return next();
  }

  if (previous.count >= MAX_REQUESTS) {
    return res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: withRemediation(
          `Too many requests. Limit is ${MAX_REQUESTS} per ${WINDOW_MS}ms`,
          'throttle client retries or raise API_RATE_LIMIT_MAX for trusted internal clients'
        )
      }
    });
  }

  previous.count += 1;
  rateLimitStore.set(key, previous);
  return next();
}

module.exports = {
  issueBrowserToken,
  purgeExpiredBrowserTokens,
  requestLogger,
  requireControlAuth,
  rateLimitControls,
  verifyConfiguredToken
};
