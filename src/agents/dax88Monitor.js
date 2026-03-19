const { initPort, ensureOpen } = require('../dax88/serialClient');

const DEFAULT_INTERVAL_MS = 3000;
const DEFAULT_READ_TIMEOUT_MS = 1200;
const FRAME_REGEX = /^>(\d{2})([0-9A-Fa-f]{20})\r?$/;

function normalizeActiveZones(activeZones = []) {
  if (!Array.isArray(activeZones) || activeZones.length === 0) {
    return ['01', '02', '03', '04', '05', '06', '07', '08'];
  }

  return activeZones
    .map((zone) => String(zone).padStart(2, '0'))
    .filter((zone) => /^[0-9]{2}$/.test(zone))
    .map((zone) => String(Number.parseInt(zone, 10)).padStart(2, '0'))
    .filter((zone) => /^0[1-8]$/.test(zone));
}

function parseSignedByte(hex) {
  const value = Number.parseInt(hex, 16);
  if (Number.isNaN(value)) return 0;
  return value > 127 ? value - 256 : value;
}

function parseStatusFrame(frame) {
  const match = FRAME_REGEX.exec(frame.trim());
  if (!match) {
    throw new Error('Malformed DAX88 status frame');
  }

  const zoneId = match[1];
  const payload = match[2];
  const bytes = payload.match(/../g);

  if (!bytes || bytes.length !== 10) {
    throw new Error('Malformed DAX88 payload length');
  }

  const [aa, bb, cc, dd, ee, ff, gg, hh, ii, jj] = bytes;

  return {
    zoneId,
    power: aa !== '00',
    source: Number.parseInt(bb, 16),
    volume: Number.parseInt(cc, 16),
    mute: dd === '01',
    doNotDisturb: ee === '01',
    treble: parseSignedByte(ff),
    bass: parseSignedByte(gg),
    balance: parseSignedByte(hh),
    keypadOnline: ii !== '00',
    partyMode: jj === '01',
    raw: { aa, bb, cc, dd, ee, ff, gg, hh, ii, jj }
  };
}

function createSerialFrameReader(serialPort, timeoutMs) {
  return function readFrame() {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const cleanup = () => {
        clearTimeout(timeout);
        serialPort.off('data', onData);
      };

      const onData = (chunk) => {
        buffer += chunk.toString('utf8');
        const terminatorIndex = buffer.indexOf('\r');
        if (terminatorIndex === -1) return;

        const frame = buffer.slice(0, terminatorIndex + 1);
        cleanup();
        resolve(frame);
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Serial read timeout'));
      }, timeoutMs);

      serialPort.on('data', onData);
    });
  };
}

function stateChanged(previousState, nextState) {
  return JSON.stringify(previousState) !== JSON.stringify(nextState);
}

function createDax88Monitor({
  activeZones,
  serialPort = initPort(),
  intervalMs = DEFAULT_INTERVAL_MS,
  readTimeoutMs = DEFAULT_READ_TIMEOUT_MS,
  writeQuery,
  publishDelta,
  logger = console
} = {}) {
  const zones = normalizeActiveZones(activeZones);
  const zoneStates = {};
  let timer = null;
  let polling = false;
  const readFrame = createSerialFrameReader(serialPort, readTimeoutMs);

  async function pollZone(zoneId) {
    const query = `?${zoneId}\r`;
    if (typeof writeQuery === 'function') {
      await writeQuery(query, { zoneId });
    } else {
      await new Promise((resolve, reject) => {
        serialPort.write(query, (error) => {
          if (error) return reject(error);
          serialPort.drain((drainError) => {
            if (drainError) return reject(drainError);
            resolve();
          });
        });
      });
    }

    const frame = await readFrame();
    const nextState = parseStatusFrame(frame);

    const previousState = zoneStates[zoneId];
    zoneStates[zoneId] = nextState;

    if (stateChanged(previousState, nextState)) {
      const event = {
        type: 'zone-state-changed',
        zoneId,
        state: nextState,
        changedAt: new Date().toISOString()
      };

      if (typeof publishDelta === 'function') {
        publishDelta(event);
      }

      return event;
    }

    return null;
  }

  async function pollOnce() {
    const events = [];

    for (const zoneId of zones) {
      try {
        const event = await pollZone(zoneId);
        if (event) {
          events.push(event);
        }
      } catch (error) {
        logger.error?.(`[dax88Monitor] poll failed for zone ${zoneId}:`, error.message);
      }
    }

    return {
      zoneStates: { ...zoneStates },
      events
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

  async function start() {
    if (process.env.DAX88_SERIAL_DISABLED === 'true') {
      logger.warn?.('[dax88Monitor] disabled by DAX88_SERIAL_DISABLED=true');
      return;
    }

    if (timer) return;
    await ensureOpen(serialPort);
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
    getZoneStates: () => ({ ...zoneStates })
  };
}

module.exports = {
  createDax88Monitor,
  normalizeActiveZones,
  parseStatusFrame
};
