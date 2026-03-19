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
const { loadGroups } = require('./src/config/groups');
const {
  issueBrowserToken,
  purgeExpiredBrowserTokens,
  rateLimitControls,
  requestLogger,
  requireControlAuth,
  verifyConfiguredToken
} = require('./src/api/security');
const {
  validatePowerPayload,
  validateVolume
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

const streamPoller = (() => {
  try {
    return createStreamPoller({
      deviceIp: process.env.UP2STREAM_BASE_URL,
      cacheTtlMs: Number.parseInt(process.env.UP2STREAM_CACHE_TTL_MS || '20000', 10)
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
        staleReason: 'poller-disabled',
        fetchedAt: null,
        cacheTtlMs: Number.parseInt(process.env.UP2STREAM_CACHE_TTL_MS || '20000', 10),
        cacheAgeMs: null,
        error: error.message
      })
    };
  }
})();

const officeGroups = loadGroups();
const DAX88_VOLUME_RANGE = Object.freeze({ min: 0, max: 38 });
const DAX88_SOURCE_RANGE = Object.freeze({ min: 1, max: 8 });
const ALLOWED_PHYSICAL_ZONES = new Set(['01', '02', '03', '04', '05', '06']);
const ALLOWED_GROUP_KEYS = new Set(Object.keys(officeGroups));
const SERIAL_INTER_WRITE_DELAY_MS = Number.parseInt(process.env.DAX88_INTER_WRITE_DELAY_MS || '50', 10);
const SERIAL_QUEUE_TASK_TIMEOUT_MS = Number.parseInt(process.env.DAX88_QUEUE_TASK_TIMEOUT_MS || '2500', 10);

let serialQueueTail = Promise.resolve();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Serial queue task timed out (${label}) after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

function enqueueSerialTask(task, { timeoutMs = SERIAL_QUEUE_TASK_TIMEOUT_MS, label = 'serial-task' } = {}) {
  const run = async () => {
    const result = await withTimeout(Promise.resolve().then(task), timeoutMs, label);
    await wait(SERIAL_INTER_WRITE_DELAY_MS);
    return result;
  };

  const queuedTask = serialQueueTail.then(run, run);
  serialQueueTail = queuedTask.catch(() => {});
  return queuedTask;
}

async function dispatchQueuedCommand(command, { timeoutMs, label = 'serial-write' } = {}) {
  try {
    const writeResult = await enqueueSerialTask(
      () => writeCommand(command),
      { timeoutMs, label }
    );

    return { ok: true, command, writeResult };
  } catch (error) {
    return {
      ok: false,
      command,
      error: error.message || 'Unknown serial queue error'
    };
  }
}

const zoneMonitor = createDax88Monitor({
  activeZones: parseActiveZones(),
  writeQuery: async (query, { zoneId } = {}) => {
    const queued = await dispatchQueuedCommand(query, {
      label: `status-monitor-zone-${zoneId || 'unknown'}`
    });

    if (!queued.ok) {
      throw new Error(queued.error);
    }
  },
  publishDelta: (event) => publishEvent('zone-state-changed', event)
});

const zoneController = createZoneController({
  groups: officeGroups,
  interWriteDelayMs: 0,
  writeFn: (serialCommand) => dispatchQueuedCommand(serialCommand, { label: 'group-command' })
});

function formatProtocolValue(value, { min, max, field }) {
  if (!Number.isInteger(value)) {
    return {
      ok: false,
      status: 400,
      error: `${field} must be an integer between ${min} and ${max}`,
      field,
      received: value
    };
  }

  if (value < min || value > max) {
    return {
      ok: false,
      status: 400,
      error: `${field} must be between ${min} and ${max}`,
      field,
      received: value
    };
  }

  return {
    ok: true,
    value,
    protocol: value.toString(10).toUpperCase().padStart(2, '0')
  };
}

function validateTargetCommandPayload({ target, commandField, value, range }) {
  if (typeof target !== 'string' || !target.trim()) {
    return {
      ok: false,
      status: 400,
      error: 'target must be a non-empty string',
      field: 'target',
      received: target
    };
  }

  const normalizedZoneTarget = String(Number.parseInt(target, 10)).padStart(2, '0');
  const isZoneTarget = ALLOWED_PHYSICAL_ZONES.has(normalizedZoneTarget);
  const isGroupTarget = ALLOWED_GROUP_KEYS.has(target);

  if (!isZoneTarget && !isGroupTarget) {
    return {
      ok: false,
      status: 400,
      error: 'target must be an allowed physical zone or known group key',
      field: 'target',
      received: target
    };
  }

  const normalizedValue = formatProtocolValue(value, { ...range, field: commandField });
  if (!normalizedValue.ok) {
    return normalizedValue;
  }

  return {
    ok: true,
    payload: {
      targetType: isZoneTarget ? 'zone' : 'group',
      target: isZoneTarget ? normalizedZoneTarget : target,
      [commandField]: normalizedValue.value,
      [`${commandField}Protocol`]: normalizedValue.protocol
    }
  };
}

function createTargetCommandValidator({ commandField, range }) {
  return (req, res, next) => {
    const validation = validateTargetCommandPayload({
      target: req.body?.target,
      commandField,
      value: req.body?.[commandField],
      range
    });

    if (!validation.ok) {
      return res.status(validation.status).json({
        error: validation.error,
        field: validation.field,
        received: validation.received
      });
    }

    req.validatedTargetCommand = validation.payload;
    return next();
  };
}

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

function unauthorized(res, message = 'Invalid credentials') {
  return res.status(401).json({
    success: false,
    error: { code: 'UNAUTHORIZED', message }
  });
}

app.post('/api/auth/login', (req, res) => {
  purgeExpiredBrowserTokens();
  const loginPassword = process.env.DASHBOARD_LOGIN_PASSWORD;
  if (!loginPassword) {
    return res.status(503).json({
      success: false,
      error: {
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Dashboard login password is not configured'
      }
    });
  }

  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!verifyConfiguredToken(password, loginPassword)) {
    return unauthorized(res);
  }

  const issued = issueBrowserToken();
  return ok(res, { token: issued.token, expiresAt: issued.expiresAt });
});

app.get('/api/auth/status', requireControlAuth, (_req, res) => {
  purgeExpiredBrowserTokens();
  return ok(res, { authenticated: true });
});

/**
 * POST /api/dax88/volume
 * body: { target: string (physical zone or group key), volume: number (0-38) }
 */
controlRouter.post('/volume', createTargetCommandValidator({
  commandField: 'volume',
  range: DAX88_VOLUME_RANGE
}), async (req, res) => {
  try {
    const {
      targetType,
      target,
      volume,
      volumeProtocol
    } = req.validatedTargetCommand;

    if (targetType === 'group') {
      const result = await zoneController.executeGroupCommand({
        groupId: target,
        command: { type: 'volume', volume }
      });

      return ok(res, {
        targetType,
        target,
        volume,
        volumeProtocol,
        results: result.results,
        summary: result.summary,
        requestId: result.requestId
      });
    }

    const zone = Number.parseInt(target, 10);
    const command = buildVolumeCommand(zone, volume);
    const queueResult = await dispatchQueuedCommand(command, {
      label: `volume-zone-${target}`
    });
    if (!queueResult.ok) {
      throw new Error(queueResult.error);
    }

    return ok(res, {
      targetType,
      target,
      volume,
      volumeProtocol,
      command,
      writeResult: queueResult.writeResult,
      queue: { ok: queueResult.ok }
    });
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
    const queueResult = await dispatchQueuedCommand(command, {
      label: `power-zone-${String(zone).padStart(2, '0')}`
    });
    if (!queueResult.ok) {
      throw new Error(queueResult.error);
    }

    return ok(res, {
      zone,
      power,
      command,
      writeResult: queueResult.writeResult,
      queue: { ok: queueResult.ok }
    });
  } catch (error) {
    if (/must be|between|unknown fields/.test(error.message)) {
      return badRequest(res, error.message);
    }
    return internalError(res, 'Unable to set power state', error.message);
  }
});

/**
 * POST /api/dax88/source
 * body: { target: string (physical zone or group key), source: number (1-8) }
 */
controlRouter.post('/source', createTargetCommandValidator({
  commandField: 'source',
  range: DAX88_SOURCE_RANGE
}), async (req, res) => {
  try {
    const {
      targetType,
      target,
      source,
      sourceProtocol
    } = req.validatedTargetCommand;

    if (targetType === 'group') {
      const result = await zoneController.executeGroupCommand({
        groupId: target,
        command: { type: 'source', source }
      });

      return ok(res, {
        targetType,
        target,
        source,
        sourceProtocol,
        results: result.results,
        summary: result.summary,
        requestId: result.requestId
      });
    }

    const zone = Number.parseInt(target, 10);
    const command = buildSourceCommand(zone, source);
    const queueResult = await dispatchQueuedCommand(command, {
      label: `source-zone-${target}`
    });
    if (!queueResult.ok) {
      throw new Error(queueResult.error);
    }

    return ok(res, {
      targetType,
      target,
      source,
      sourceProtocol,
      command,
      writeResult: queueResult.writeResult,
      queue: { ok: queueResult.ok }
    });
  } catch (error) {
    if (/must be|between|unknown fields/.test(error.message)) {
      return badRequest(res, error.message);
    }
    return internalError(res, 'Unable to set source', error.message);
  }
});


/**
 * POST /api/dax88/group/:groupId/volume
 * body: { volume: number (0-38) }
 */
controlRouter.post('/group/:groupId/volume', async (req, res) => {
  try {
    const { groupId } = req.params;
    if (!groupId) {
      return badRequest(res, 'groupId is required');
    }

    const volume = validateVolume(req.body?.volume);
    const result = await zoneController.executeGroupCommand({
      groupId,
      command: { type: 'volume', volume }
    });

    return ok(res, {
      groupId,
      volume,
      results: result.results,
      summary: result.summary,
      requestId: result.requestId
    });
  } catch (error) {
    if (/Unknown|Unsupported|Invalid|must be|between|unknown fields/.test(error.message)) {
      return badRequest(res, error.message);
    }
    return internalError(res, 'Unable to set group volume', error.message);
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
      staleReason: status.staleReason,
      fetchedAt: status.fetchedAt,
      cacheTtlMs: status.cacheTtlMs,
      cacheAgeMs: status.cacheAgeMs,
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
  return ok(res, {
    status: 'ok',
    agents: {
      streamPoller: streamPollingLoop.getStatus(),
      dax88Monitor: dax88PollingLoop.getStatus()
    }
  });
});

function createGuardedPollingLoop({
  name,
  intervalMs,
  logger = console,
  runCycle
}) {
  let timer = null;
  let active = false;
  let stopped = true;
  let retryTimer = null;
  let lastRunStartedAt = null;
  let lastRunFinishedAt = null;

  function clearTimers() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function scheduleNext(delayMs = intervalMs) {
    if (stopped) return;

    timer = setTimeout(() => {
      void execute();
    }, delayMs);
  }

  function scheduleRetry(delayMs = Math.max(100, Math.floor(intervalMs / 3))) {
    if (stopped || retryTimer) return;

    logger.warn?.(`[${name}] previous cycle still active; scheduling retry in ${delayMs}ms`);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void execute();
    }, delayMs);
  }

  async function execute() {
    if (stopped) return;

    if (active) {
      scheduleRetry();
      return;
    }

    active = true;
    lastRunStartedAt = new Date().toISOString();

    try {
      await runCycle();
    } catch (error) {
      logger.error?.(`[${name}] cycle failed:`, error.message);
    } finally {
      lastRunFinishedAt = new Date().toISOString();
      active = false;
      scheduleNext(intervalMs);
    }
  }

  function start() {
    if (!stopped) {
      logger.warn?.(`[${name}] start requested while loop already running`);
      if (active) {
        scheduleRetry();
      }
      return;
    }

    stopped = false;
    clearTimers();
    void execute();
  }

  function stop() {
    stopped = true;
    clearTimers();
  }

  function getStatus() {
    return {
      intervalMs,
      active,
      lastRunStartedAt,
      lastRunFinishedAt
    };
  }

  return {
    start,
    stop,
    getStatus
  };
}

const streamPollingLoop = createGuardedPollingLoop({
  name: 'streamPollerLoop',
  intervalMs: 5000,
  runCycle: () => streamPoller.pollOnce()
});

const dax88PollingLoop = createGuardedPollingLoop({
  name: 'dax88MonitorLoop',
  intervalMs: 3000,
  runCycle: () => zoneMonitor.pollOnce()
});

async function startAgents() {
  try {
    streamPollingLoop.start();
    if (process.env.DAX88_SERIAL_DISABLED === 'true') {
      console.warn('[server] dax88 monitor loop disabled by DAX88_SERIAL_DISABLED=true');
    } else {
      dax88PollingLoop.start();
    }
  } catch (error) {
    console.error('[server] failed to start background agents:', error.message);
  }
}

function stopAgents() {
  streamPollingLoop.stop();
  dax88PollingLoop.stop();
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
