const express = require('express');
const path = require('path');
const {
  buildPowerCommand,
  buildSourceCommand,
  buildVolumeCommand
} = require('./src/dax88/commands');
const { writeCommand } = require('./src/dax88/serialClient');
const { createDax88Monitor } = require('./src/agents/dax88Monitor');
const { createStreamPoller } = require('./src/agents/streamPoller');
const { createZoneController } = require('./src/agents/zoneController');
const {
  rateLimitControls,
  requestLogger,
  requireControlAuth
} = require('./src/api/security');
const {
  validatePowerPayload,
  validateSourcePayload,
  validateVolumePayload
} = require('./src/api/validators');

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '32kb' }));
app.use(requestLogger);
app.use(express.static(path.join(__dirname, 'public')));

const sseClients = new Set();

function publishEvent(eventName, payload) {
  const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    client.write(message);
  }
}

function parseActiveZones() {
  const raw = process.env.DAX88_ACTIVE_ZONES;
  if (!raw) {
    return ['01', '02', '03', '04', '05', '06', '07', '08'];
  }

  return raw
    .split(',')
    .map((zone) => zone.trim())
    .filter(Boolean)
    .map((zone) => String(Number.parseInt(zone, 10)).padStart(2, '0'))
    .filter((zone) => /^0[1-8]$/.test(zone));
}

function parseGroups(rawGroups) {
  if (!rawGroups) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawGroups);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed).reduce((acc, [groupId, zones]) => {
      if (!Array.isArray(zones)) {
        return acc;
      }

      acc[groupId] = zones
        .map((zone) => String(Number.parseInt(zone, 10)).padStart(2, '0'))
        .filter((zone) => /^0[1-8]$/.test(zone));
      return acc;
    }, {});
  } catch (_error) {
    console.warn('[server] Failed to parse DAX88_ZONE_GROUPS; ignoring group config');
    return {};
  }
}

const streamPoller = (() => {
  try {
    return createStreamPoller({
      deviceIp: process.env.UP2STREAM_BASE_URL
    });
  } catch (error) {
    console.warn('[server] stream poller disabled:', error.message);
    return {
      start: () => {},
      stop: () => {},
      getStatus: () => ({
        endpoint: null,
        metadata: { title: '', artist: '', album: '' },
        source: 'cache',
        stale: true,
        fetchedAt: null,
        error: error.message
      })
    };
  }
})();

const zoneMonitor = createDax88Monitor({
  activeZones: parseActiveZones(),
  publishDelta: (event) => publishEvent('zone-state-changed', event)
});

const zoneController = createZoneController({
  groups: parseGroups(process.env.DAX88_ZONE_GROUPS)
});

const controlRouter = express.Router();
controlRouter.use(requireControlAuth);
controlRouter.use(rateLimitControls);

function ok(res, data, meta = {}) {
  return res.json({ success: true, data, meta });
}

function badRequest(res, message) {
  return res.status(400).json({
    success: false,
    error: { code: 'BAD_REQUEST', message }
  });
}

function internalError(res, message, details) {
  return res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message, details }
  });
}

/**
 * POST /api/dax88/volume
 * body: { zone: number (1-8), volume: number (0-38) }
 */
controlRouter.post('/volume', async (req, res) => {
  try {
    const { zone, volume } = validateVolumePayload(req.body || {});
    const command = buildVolumeCommand(zone, volume);
    const writeResult = await writeCommand(command);

    return ok(res, { zone, volume, command, writeResult });
  } catch (error) {
    if (/must be|between|unknown fields/.test(error.message)) {
      return badRequest(res, error.message);
    }
    return internalError(res, 'Unable to set volume', error.message);
  }
});

/**
 * POST /api/dax88/power
 * body: { zone: number (1-8), power: boolean|string }
 */
controlRouter.post('/power', async (req, res) => {
  try {
    const { zone, power } = validatePowerPayload(req.body || {});
    const command = buildPowerCommand(zone, power);
    const writeResult = await writeCommand(command);

    return ok(res, { zone, power, command, writeResult });
  } catch (error) {
    if (/must be|between|unknown fields/.test(error.message)) {
      return badRequest(res, error.message);
    }
    return internalError(res, 'Unable to set power state', error.message);
  }
});

/**
 * POST /api/dax88/source
 * body: { zone: number (1-8), source: number (1-8) }
 */
controlRouter.post('/source', async (req, res) => {
  try {
    const { zone, source } = validateSourcePayload(req.body || {});
    const command = buildSourceCommand(zone, source);
    const writeResult = await writeCommand(command);

    return ok(res, { zone, source, command, writeResult });
  } catch (error) {
    if (/must be|between|unknown fields/.test(error.message)) {
      return badRequest(res, error.message);
    }
    return internalError(res, 'Unable to set source', error.message);
  }
});

/**
 * POST /api/dax88/group-command
 * body: { groupId: string, command: ZoneCommand }
 */
controlRouter.post('/group-command', async (req, res) => {
  try {
    const { groupId, command } = req.body || {};
    if (!groupId || !command) {
      return badRequest(res, 'groupId and command are required');
    }

    const result = await zoneController.executeGroupCommand({ groupId, command });
    return ok(res, result);
  } catch (error) {
    if (/Unknown|Unsupported|Invalid/.test(error.message)) {
      return badRequest(res, error.message);
    }
    return internalError(res, 'Unable to execute group command', error.message);
  }
});

app.use('/api/dax88', controlRouter);

/**
 * GET /api/stream/status
 */
app.get('/api/stream/status', (_req, res) => {
  try {
    const status = streamPoller.getStatus();
    return ok(res, status.metadata, {
      endpoint: status.endpoint,
      source: status.source,
      stale: status.stale,
      fetchedAt: status.fetchedAt,
      error: status.error
    });
  } catch (error) {
    if (error.message.includes('UP2STREAM_BASE_URL')) {
      return badRequest(res, error.message);
    }
    return internalError(res, 'Unable to get stream status', error.message);
  }
});

/**
 * GET /api/dax88/zones
 */
app.get('/api/dax88/zones', (_req, res) => {
  return ok(res, zoneMonitor.getZoneStates());
});

/**
 * SSE stream for monitor updates
 */
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  res.write('event: connected\ndata: {"ok":true}\n\n');

  req.on('close', () => {
    sseClients.delete(res);
  });
});

app.get('/api/health', (_req, res) => {
  return ok(res, { status: 'ok' });
});

async function startAgents() {
  try {
    streamPoller.start();
    await zoneMonitor.start();
  } catch (error) {
    console.error('[server] failed to start background agents:', error.message);
  }
}

function stopAgents() {
  streamPoller.stop();
  zoneMonitor.stop();
}

const server = app.listen(port, () => {
  console.log(`Audio middleware listening on http://localhost:${port}`);
  void startAgents();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopAgents();
    server.close(() => process.exit(0));
  });
}
