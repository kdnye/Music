const axios = require('axios');
const { validateUp2StreamBaseUrl } = require('../api/validators');

const HEX_FIELDS = ['Title', 'Artist', 'Album'];
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_CACHE_TTL_MS = 20000;

class StreamStatusServiceError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'StreamStatusServiceError';
    this.code = options.code || 'STREAM_STATUS_ERROR';
    this.statusCode = options.statusCode || 502;
    this.reason = options.reason || message;
    this.details = options.details || undefined;
  }
}

let lastSuccessfulCache = {
  metadata: null,
  fetchedAt: null,
  expiresAt: null
};

function decodeHexToAscii(hexValue, options = {}) {
  const {
    fallback = hexValue,
    invalidUtf8Fallback = fallback,
    onDecodeError
  } = options;

  if (hexValue == null) {
    return hexValue;
  }

  if (typeof hexValue !== 'string') {
    return fallback;
  }

  if (!hexValue.length) {
    return '';
  }

  const cleaned = hexValue.replace(/\s+/g, '');
  if (!cleaned.length) {
    return '';
  }

  if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) {
    return fallback;
  }

  try {
    const decoded = Buffer.from(cleaned, 'hex').toString('utf8');
    const withoutNulls = decoded.replace(/\0/g, '');

    // U+FFFD indicates invalid UTF-8 sequences were encountered.
    if (withoutNulls.includes('\uFFFD')) {
      onDecodeError?.('invalid-utf8');
      return invalidUtf8Fallback;
    }

    return withoutNulls;
  } catch {
    onDecodeError?.('decode-failed');
    return fallback;
  }
}

function decodeMetadata(rawPayload) {
  const payload = { ...rawPayload };
  const decodeErrors = [];

  for (const field of HEX_FIELDS) {
    payload[field] = decodeHexToAscii(payload[field], {
      onDecodeError: (error) => {
        decodeErrors.push({ field, error });
      }
    });
  }

  if (decodeErrors.length) {
    payload.decodeError = true;
    payload.decodeErrors = decodeErrors;
  }

  return payload;
}

function getCacheTtlMs(cacheTtlMs) {
  const parsed = Number.parseInt(
    `${cacheTtlMs ?? process.env.UP2STREAM_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS}`,
    10
  );
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_TTL_MS;
}

function buildCacheResponse(reason, ttlMs) {
  if (!lastSuccessfulCache.metadata || !lastSuccessfulCache.fetchedAt) {
    throw new StreamStatusServiceError('No cached stream metadata available', {
      code: 'STREAM_STATUS_UNAVAILABLE',
      statusCode: 503,
      reason,
      details: { ttlMs }
    });
  }

  const now = Date.now();
  const expiresAtMs = lastSuccessfulCache.expiresAt ? new Date(lastSuccessfulCache.expiresAt).getTime() : null;
  const stale = expiresAtMs != null ? now > expiresAtMs : false;

  return {
    metadata: lastSuccessfulCache.metadata,
    source: 'cache',
    fetchedAt: lastSuccessfulCache.fetchedAt,
    stale,
    expiresAt: lastSuccessfulCache.expiresAt,
    error: reason
  };
}

async function fetchPlayerStatus(options = {}) {
  const { cacheTtlMs } = options;
  const ttlMs = getCacheTtlMs(cacheTtlMs);
  const configuredBaseUrl = process.env.UP2STREAM_BASE_URL || (process.env.UP2STREAM_IP ? `http://${process.env.UP2STREAM_IP}` : null);
  const baseUrl = validateUp2StreamBaseUrl(configuredBaseUrl);
  const url = `${baseUrl}/getPlayerStatus`;
  try {
    const response = await axios.get(url, {
      timeout: Number.parseInt(process.env.UP2STREAM_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10)
    });

    if (response.status !== 200 || !response.data || typeof response.data !== 'object') {
      return buildCacheResponse(`Unexpected response (${response.status})`, ttlMs);
    }

    const metadata = decodeMetadata(response.data);
    if (metadata.decodeError) {
      return buildCacheResponse('Failed to decode metadata payload', ttlMs);
    }

    const fetchedAt = new Date().toISOString();
    const expiresAt = ttlMs > 0 ? new Date(Date.now() + ttlMs).toISOString() : null;
    lastSuccessfulCache = {
      metadata,
      fetchedAt,
      expiresAt
    };

    return {
      metadata,
      source: 'live',
      fetchedAt,
      expiresAt,
      stale: false
    };
  } catch (error) {
    return buildCacheResponse(error.message || 'Failed to fetch stream metadata', ttlMs);
  }
}

module.exports = {
  decodeHexToAscii,
  decodeMetadata,
  fetchPlayerStatus,
  getCacheTtlMs,
  StreamStatusServiceError
};
