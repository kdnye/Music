const crypto = require('crypto');
const {
  buildPowerCommand,
  buildSourceCommand,
  buildVolumeCommand
} = require('../dax88/commands');
const { writeCommand } = require('../dax88/serialClient');

const DEFAULT_INTER_WRITE_DELAY_MS = 50;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeZoneId(zoneId) {
  const n = Number.parseInt(zoneId, 10);
  if (!Number.isInteger(n) || n < 1 || n > 8) {
    throw new Error(`Invalid zone id: ${zoneId}`);
  }
  return String(n).padStart(2, '0');
}

function normalizeZones(zones = []) {
  return [...new Set(zones.map(normalizeZoneId))].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
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

function createZoneController({
  groups = {},
  serialPort,
  writeFn = writeCommand,
  interWriteDelayMs = DEFAULT_INTER_WRITE_DELAY_MS,
  logger = console
} = {}) {
  async function writeWithFallback(serialCommand) {
    if (!serialPort) {
      return writeFn(serialCommand);
    }

    return new Promise((resolve, reject) => {
      serialPort.write(serialCommand, (error) => {
        if (error) return reject(error);
        serialPort.drain((drainError) => {
          if (drainError) return reject(drainError);
          resolve({ skipped: false });
        });
      });
    });
  }

  async function executeGroupCommand({ groupId, command }) {
    const rawZones = groups[groupId];
    if (!Array.isArray(rawZones) || rawZones.length === 0) {
      throw new Error(`Unknown or empty group: ${groupId}`);
    }

    const requestId = crypto.randomUUID();
    const zones = normalizeZones(rawZones);
    const results = [];

    for (let i = 0; i < zones.length; i += 1) {
      const zoneId = zones[i];
      try {
        const serialCommand = buildZoneCommand(zoneId, command);
        await writeWithFallback(serialCommand);
        results.push({ zoneId, ok: true });
      } catch (error) {
        logger.error?.(`[zoneController] write failed for zone ${zoneId}:`, error.message);
        results.push({ zoneId, ok: false, error: error.message || 'Unknown serial write error' });
      }

      if (i < zones.length - 1) {
        await delay(interWriteDelayMs);
      }
    }

    const succeeded = results.filter((item) => item.ok).length;

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

  return {
    executeGroupCommand
  };
}

module.exports = {
  createZoneController,
  normalizeZoneId,
  normalizeZones,
  buildZoneCommand
};
