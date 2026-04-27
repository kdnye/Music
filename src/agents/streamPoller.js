const axios = require('axios');
const { validateUp2StreamBaseUrl } = require('../api/validators');

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_CACHE_TTL_MS = 20000;
const DEFAULT_BACKOFF_MS = Object.freeze([10000, 30000, 60000]);
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;
const HEX_FIELDS = ['Title', 'Artist', 'Album'];

function withRemediation(message, remediation) {
  return `${message}. Remediation: ${remediation}`;
}

class MetadataDecodeError extends Error {
  constructor(field, message) {
    super(withRemediation(
      `Unable to decode ${field}: ${message}`,
      `validate the ${field} field is even-length hex and UTF-8 compatible`
    ));
    this.name = 'MetadataDecodeError';
  }
}

function isHexString(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const compact = value.replace(/\s+/g, '');
  return compact.length > 0 && compact.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(compact);
}

function decodeHexField(value, fieldName) {
  if (!isHexString(value)) {
    return value;
  }

  try {
    const decoded = Buffer.from(value.replace(/\s+/g, ''), 'hex').toString('utf8').replace(/\0/g, '').trim();

    if (decoded.includes('\uFFFD')) {
      throw new MetadataDecodeError(fieldName, 'invalid UTF-8 sequence');
    }

    return decoded;
  } catch (error) {
    if (error instanceof MetadataDecodeError) {
      throw error;
    }

    throw new MetadataDecodeError(fieldName, error.message || 'invalid hex payload');
  }
}

function decodeMetadata(payload = {}) {
  const decoded = { ...payload };

  for (const field of HEX_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(decoded, field)) {
      decoded[field] = decodeHexField(decoded[field], field);
    }
  }

  return {
    ...decoded,
    title: decoded.Title || '',
    artist: decoded.Artist || '',
    album: decoded.Album || ''
  };
}

function createStreamPoller({
  deviceIp,
  httpClient = axios,
  intervalMs = DEFAULT_INTERVAL_MS,
  timeoutMs = Number.parseInt(process.env.UP2STREAM_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10),
  cacheTtlMs = Number.parseInt(process.env.UP2STREAM_CACHE_TTL_MS || `${DEFAULT_CACHE_TTL_MS}`, 10),
  failureThreshold = DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
  backoffMs = DEFAULT_BACKOFF_MS,
  onHealthChange,
  logger = console
} = {}) {
  const baseUrl = validateUp2StreamBaseUrl(deviceIp || process.env.UP2STREAM_BASE_URL || (process.env.UP2STREAM_IP ? `http://${process.env.UP2STREAM_IP}` : null));
  const endpoint = `${baseUrl}/getPlayerStatus`;

  let timer = null;
  let polling = false;
  let consecutiveFailures = 0;
  let offline = false;
  let cache = {
    metadata: { title: '', artist: '', album: '' },
    fetchedAt: null,
    error: null,
    source: 'cache',
    stale: true,
    staleReason: 'empty-cache'
  };

  function getCacheAgeMs() {
    if (!cache.fetchedAt) {
      return null;
    }

    return Math.max(0, Date.now() - new Date(cache.fetchedAt).getTime());
  }

  function isTtlExpired() {
    const ageMs = getCacheAgeMs();
    return ageMs == null ? true : ageMs > cacheTtlMs;
  }

  function emitHealth(errorMessage = null) {
    onHealthChange?.({
      offline,
      failures: consecutiveFailures,
      error: errorMessage,
      at: new Date().toISOString()
    });
  }

  function getStatus() {
    const ttlExpired = isTtlExpired();
    const stale = cache.stale || ttlExpired;
    const staleReason = cache.staleReason || (ttlExpired ? 'cache-ttl-expired' : null);

    return {
      endpoint,
      metadata: cache.metadata,
      source: stale ? 'cache' : 'live',
      stale,
      staleReason,
      fetchedAt: cache.fetchedAt,
      cacheTtlMs,
      cacheAgeMs: getCacheAgeMs(),
      error: cache.error || undefined,
      offline,
      failures: consecutiveFailures
    };
  }

  async function pollOnce() {
    try {
      const response = await httpClient.get(endpoint, { timeout: timeoutMs });

      if (response.status !== 200 || !response.data || typeof response.data !== 'object') {
        throw new Error(withRemediation(
          `Unexpected response (${response.status})`,
          'verify Up2Stream endpoint /getPlayerStatus is reachable and returning JSON with HTTP 200'
        ));
      }

      const now = new Date().toISOString();
      cache = {
        metadata: decodeMetadata(response.data),
        fetchedAt: now,
        error: null,
        source: 'live',
        stale: false,
        staleReason: null
      };

      if (consecutiveFailures > 0 || offline) {
        consecutiveFailures = 0;
        offline = false;
        emitHealth(null);
      }

      return getStatus();
    } catch (error) {
      consecutiveFailures += 1;
      offline = consecutiveFailures >= failureThreshold;

      cache = {
        ...cache,
        source: 'cache',
        stale: true,
        staleReason: cache.fetchedAt ? 'poll-error' : 'empty-cache',
        error: withRemediation(
          error.message || 'Failed to poll Up2Stream metadata',
          'check device IP/base URL, network reachability, and HTTP timeout settings'
        )
      };

      emitHealth(cache.error);
      logger.error?.('[streamPoller] poll failed:', cache.error);
      return getStatus();
    }
  }

  function clearTimer() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  function scheduleNextTick() {
    clearTimer();
    const backoffIndex = Math.min(Math.max(0, consecutiveFailures - 1), backoffMs.length - 1);
    const delay = consecutiveFailures > 0 ? (backoffMs[backoffIndex] || intervalMs) : intervalMs;

    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, delay);
  }

  async function tick() {
    if (polling) return;
    polling = true;
    try {
      await pollOnce();
    } finally {
      polling = false;
      scheduleNextTick();
    }
  }

  function start() {
    if (timer || polling) return;
    void tick();
  }

  function stop() {
    clearTimer();
  }

  return {
    start,
    stop,
    pollOnce,
    getStatus
  };
}

module.exports = {
  createStreamPoller,
  decodeHexField,
  decodeMetadata,
  MetadataDecodeError
};
