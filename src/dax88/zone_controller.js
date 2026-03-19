const crypto = require('crypto');
const {
  buildPowerCommand,
  buildSourceCommand,
  buildVolumeCommand
} = require('./commands');
const { writeCommand: defaultWriteCommand } = require('./serialClient');

const DEFAULT_INTER_WRITE_DELAY_MS = 50;

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeZoneId(zoneId) {
  const parsed = Number.parseInt(zoneId, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new Error(`Invalid zone id: ${zoneId}`);
  }

  return String(parsed).padStart(2, '0');
}

function normalizeZones(zones = []) {
  const normalized = zones.map(normalizeZoneId);
  const deduped = [...new Set(normalized)];
  return deduped.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
}

function buildZoneCommand(zoneId, command) {
  if (typeof command === 'function') {
    return command(zoneId);
  }

  if (typeof command === 'string') {
    return command.replaceAll('{zone}', zoneId);
  }

  if (!command || typeof command !== 'object') {
    throw new Error('command must be a function, string, or object');
  }

  const zone = Number.parseInt(zoneId, 10);

  switch (command.type) {
    case 'power':
      return buildPowerCommand(zone, command.power);
    case 'source':
      return buildSourceCommand(zone, command.source);
    case 'volume':
      return buildVolumeCommand(zone, command.volume);
    default:
      throw new Error(`Unsupported command type: ${command.type}`);
  }
}

async function writeToSerial({ serialPort, writeFn, serialCommand }) {
  if (serialPort) {
    await new Promise((resolve, reject) => {
      serialPort.write(serialCommand, (error) => {
        if (error) {
          reject(error);
          return;
        }

        serialPort.drain((drainError) => {
          if (drainError) {
            reject(drainError);
            return;
          }

          resolve();
        });
      });
    });

    return;
  }

  const result = await writeFn(serialCommand);
  if (result && result.ok === false) {
    throw new Error(result.error || 'Unknown serial write error');
  }
}

async function executeGroupedZoneAction({
  groupId,
  command,
  groups = {},
  serialPort,
  writeFn = defaultWriteCommand,
  interWriteDelayMs = DEFAULT_INTER_WRITE_DELAY_MS,
  logger = console
} = {}) {
  if (!groupId || typeof groupId !== 'string') {
    throw new Error('groupId is required');
  }

  const rawZones = groups[groupId];
  if (!Array.isArray(rawZones) || rawZones.length === 0) {
    throw new Error(`Unknown or empty group: ${groupId}`);
  }

  const zones = normalizeZones(rawZones);
  const results = [];
  const requestId = crypto.randomUUID();

  for (let index = 0; index < zones.length; index += 1) {
    const zoneId = zones[index];

    try {
      const serialCommand = buildZoneCommand(zoneId, command);
      await writeToSerial({ serialPort, writeFn, serialCommand });
      results.push({ zoneId, ok: true });
    } catch (error) {
      logger.error?.(`[zone_controller] write failed for zone ${zoneId}:`, error.message);
      results.push({ zoneId, ok: false, error: error.message || 'Unknown serial write error' });
    }

    if (index < zones.length - 1 && interWriteDelayMs > 0) {
      await wait(interWriteDelayMs);
    }
  }

  const succeeded = results.filter((result) => result.ok).length;

  return {
    requestId,
    results,
    summary: {
      total: results.length,
      succeeded,
      failed: results.length - succeeded
    }
  };
}

function createZoneController({
  groups = {},
  serialPort,
  writeFn = defaultWriteCommand,
  interWriteDelayMs = DEFAULT_INTER_WRITE_DELAY_MS,
  logger = console
} = {}) {
  return {
    executeGroupCommand: ({ groupId, command }) => executeGroupedZoneAction({
      groupId,
      command,
      groups,
      serialPort,
      writeFn,
      interWriteDelayMs,
      logger
    })
  };
}

module.exports = {
  DEFAULT_INTER_WRITE_DELAY_MS,
  buildZoneCommand,
  createZoneController,
  executeGroupedZoneAction,
  normalizeZoneId,
  normalizeZones
};
