const crypto = require('crypto');

const WINDOW_MS = Number.parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || '60000', 10);
const MAX_REQUESTS = Number.parseInt(process.env.API_RATE_LIMIT_MAX || '60', 10);
const AUTH_HEADER = 'authorization';

const rateLimitStore = new Map();

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
  if (!configuredToken) {
    return res.status(503).json({
      success: false,
      error: {
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Control API auth token is not configured'
      }
    });
  }

  const authHeader = req.get(AUTH_HEADER);
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing bearer token'
      }
    });
  }

  const providedToken = authHeader.slice(7).trim();
  const expected = Buffer.from(configuredToken, 'utf8');
  const provided = Buffer.from(providedToken, 'utf8');

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid bearer token'
      }
    });
  }

  return next();
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
        message: `Too many requests. Limit is ${MAX_REQUESTS} per ${WINDOW_MS}ms`
      }
    });
  }

  previous.count += 1;
  rateLimitStore.set(key, previous);
  return next();
}

module.exports = {
  requestLogger,
  requireControlAuth,
  rateLimitControls
};
