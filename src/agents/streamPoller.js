const axios = require('axios');
const { validateUp2StreamBaseUrl } = require('../api/validators');

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_CACHE_TTL_MS = 20000;
const HEX_FIELDS = ['Title', 'Artist', 'Album'];

function looksLikeHex(value) {
  return typeof value === 'string' && value.length > 0 && /^[0-9a-fA-F\s]+$/.test(value) && value.replace(/\s+/g, '').length % 2 === 0;
}

function decodeHex(value) {
  if (!looksLikeHex(value)) {
    return value;
  }

  try {
    return Buffer.from(value.replace(/\s+/g, ''), 'hex').toString('utf8').replace(/\0/g, '').trim();
  } catch (_error) {
    return value;
  }
}

function decodeMetadata(payload = {}) {
  const decoded = { ...payload };

  for (const field of HEX_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(decoded, field)) {
      decoded[field] = decodeHex(decoded[field]);
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
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  logger = console
} = {}) {
  const baseUrl = validateUp2StreamBaseUrl(deviceIp || process.env.UP2STREAM_BASE_URL);
  const endpoint = `${baseUrl}/getPlayerStatus`;

  let timer = null;
  let polling = false;
  let cache = {
    metadata: { title: '', artist: '', album: '' },
    source: 'cache',
    stale: true,
    fetchedAt: null,
    error: null
  };

  async function pollOnce() {
    try {
      const response = await httpClient.get(endpoint, { timeout: timeoutMs });
      if (response.status !== 200 || !response.data || typeof response.data !== 'object') {
        throw new Error(`Unexpected response (${response.status})`);
      }

      const now = new Date().toISOString();
      cache = {
        metadata: decodeMetadata(response.data),
        source: 'live',
        stale: false,
        fetchedAt: now,
        error: null
      };

      return getStatus();
    } catch (error) {
      cache = {
        ...cache,
        source: cache.fetchedAt ? 'cache' : 'live',
        stale: true,
        error: error.message || 'Failed to poll Up2Stream metadata'
      };
      logger.error?.('[streamPoller] poll failed:', cache.error);
      return getStatus();
    }
  }

  function isStale() {
    if (!cache.fetchedAt) return true;
    const ageMs = Date.now() - new Date(cache.fetchedAt).getTime();
    return ageMs > cacheTtlMs;
  }

  function getStatus() {
    return {
      endpoint,
      metadata: cache.metadata,
      source: cache.stale || isStale() ? 'cache' : cache.source,
      stale: cache.stale || isStale(),
      fetchedAt: cache.fetchedAt,
      error: cache.error || undefined
    };
  }

  async function tick() {
    if (polling) return;
    polling = true;
    try {
      await pollOnce();
    } finally {
      polling = false;
    }
  }

  function start() {
    if (timer) return;
    void tick();
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
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
  decodeHex,
  decodeMetadata
};
