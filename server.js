const express = require('express');
const path = require('path');
const {
  buildPowerCommand,
  buildSourceCommand,
  buildVolumeCommand
} = require('./src/dax88/commands');
const { writeCommand } = require('./src/dax88/serialClient');
const { fetchPlayerStatus } = require('./src/stream/statusService');

const app = express();
const port = Number.parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

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
app.post('/api/dax88/volume', async (req, res) => {
  try {
    const { zone, volume } = req.body || {};
    const command = buildVolumeCommand(zone, volume);
    const writeResult = await writeCommand(command);

    return ok(res, { zone, volume, command, writeResult });
  } catch (error) {
    if (/must be|between/.test(error.message)) {
      return badRequest(res, error.message);
    }
    return internalError(res, 'Unable to set volume', error.message);
  }
});

/**
 * POST /api/dax88/power
 * body: { zone: number (1-8), power: boolean|string }
 */
app.post('/api/dax88/power', async (req, res) => {
  try {
    const { zone, power } = req.body || {};
    const command = buildPowerCommand(zone, power);
    const writeResult = await writeCommand(command);

    return ok(res, { zone, power, command, writeResult });
  } catch (error) {
    if (/must be|between/.test(error.message)) {
      return badRequest(res, error.message);
    }
    return internalError(res, 'Unable to set power state', error.message);
  }
});

/**
 * POST /api/dax88/source
 * body: { zone: number (1-8), source: number (1-8) }
 */
app.post('/api/dax88/source', async (req, res) => {
  try {
    const { zone, source } = req.body || {};
    const command = buildSourceCommand(zone, source);
    const writeResult = await writeCommand(command);

    return ok(res, { zone, source, command, writeResult });
  } catch (error) {
    if (/must be|between/.test(error.message)) {
      return badRequest(res, error.message);
    }
    return internalError(res, 'Unable to set source', error.message);
  }
});

/**
 * GET /api/stream/status
 */
app.get('/api/stream/status', async (_req, res) => {
  try {
    const status = await fetchPlayerStatus();
    return ok(res, status.decoded, {
      endpoint: status.endpoint,
      fetchedAt: status.fetchedAt
    });
  } catch (error) {
    if (error.message.includes('UP2STREAM_BASE_URL')) {
      return badRequest(res, error.message);
    }
    return internalError(res, 'Unable to fetch stream status', error.message);
  }
});

app.get('/api/health', (_req, res) => {
  return ok(res, { status: 'ok' });
});

app.listen(port, () => {
  console.log(`Audio middleware listening on http://localhost:${port}`);
});
