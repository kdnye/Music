const test = require('node:test');
const assert = require('node:assert/strict');

const { createStreamPoller, decodeHexField } = require('../src/agents/streamPoller');

test('decodeHexField throws on invalid utf8 replacement characters', () => {
  assert.throws(() => decodeHexField('ff', 'Title'), /Unable to decode Title/);
});

test('pollOnce stores live payload and metadata timestamps', async () => {
  const httpClient = {
    async get() {
      return {
        status: 200,
        data: {
          Title: '48656c6c6f',
          Artist: '576f726c64',
          Album: '54657374'
        }
      };
    }
  };

  const poller = createStreamPoller({
    deviceIp: 'http://127.0.0.1',
    httpClient,
    cacheTtlMs: 60_000,
    logger: { error: () => {} }
  });

  const status = await poller.pollOnce();

  assert.equal(status.source, 'live');
  assert.equal(status.stale, false);
  assert.equal(status.metadata.title, 'Hello');
  assert.equal(status.metadata.artist, 'World');
  assert.equal(status.metadata.album, 'Test');
  assert.equal(typeof status.fetchedAt, 'string');
  assert.equal(status.error, undefined);
});

test('pollOnce falls back to stale cache on non-200 responses', async () => {
  const responses = [
    { status: 200, data: { Title: '48656c6c6f', Artist: '576f726c64', Album: '54657374' } },
    { status: 503, data: { message: 'service unavailable' } }
  ];

  const httpClient = {
    async get() {
      return responses.shift();
    }
  };

  const poller = createStreamPoller({
    deviceIp: 'http://127.0.0.1',
    httpClient,
    cacheTtlMs: 60_000,
    logger: { error: () => {} }
  });

  await poller.pollOnce();
  const degraded = await poller.pollOnce();

  assert.equal(degraded.source, 'cache');
  assert.equal(degraded.stale, true);
  assert.equal(degraded.staleReason, 'poll-error');
  assert.equal(degraded.metadata.title, 'Hello');
  assert.match(degraded.error, /Unexpected response/);
});

test('pollOnce uses stale empty-cache shape before first successful fetch', async () => {
  const httpClient = {
    async get() {
      throw new Error('timeout');
    }
  };

  const poller = createStreamPoller({
    deviceIp: 'http://127.0.0.1',
    httpClient,
    cacheTtlMs: 60_000,
    logger: { error: () => {} }
  });

  const status = await poller.pollOnce();

  assert.equal(status.source, 'cache');
  assert.equal(status.stale, true);
  assert.equal(status.staleReason, 'empty-cache');
  assert.equal(status.metadata.title, '');
  assert.equal(status.metadata.artist, '');
  assert.equal(status.metadata.album, '');
  assert.equal(status.fetchedAt, null);
  assert.equal(status.cacheAgeMs, null);
  assert.equal(status.cacheTtlMs, 60_000);
  assert.match(status.error, /timeout/);
});
