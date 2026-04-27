const crypto = require('crypto');
const {
  buildPowerCommand,
  buildSourceCommand,
  buildVolumeCommand
} = require('./commands');
const { writeCommand: defaultWriteCommand } = require('./serialClient');

const DEFAULT_INTER_WRITE_DELAY_MS = 50;

function withRemediation(message, remediation) {
  return `${message}. Remediation: ${remediation}`;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeZoneId(zoneId) {
  const parsed = Number.parseInt(zoneId, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new Error(withRemediation(
      `Invalid zone id: ${zoneId}`,
      'use a numeric zone between 1 and 8'
    ));
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
    throw new Error(withRemediation(
      'command must be a function, string, or object',
      'send command as { type, ... } or provide a zone-aware formatter function'
    ));
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
      throw new Error(withRemediation(
        `Unsupported command type: ${command.type}`,
        'use one of: power, source, volume'
      ));
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
    throw new Error(withRemediation(
      result.error || 'Unknown serial write error',
      'inspect serial queue errors and retry command once connectivity is stable'
    ));
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
    throw new Error(withRemediation(
      'groupId is required',
      'provide a non-empty group key defined in config/groups.json or DAX88_ZONE_GROUPS'
    ));
  }

  const rawZones = groups[groupId];
  if (!Array.isArray(rawZones) || rawZones.length === 0) {
    throw new Error(withRemediation(
      `Unknown or empty group: ${groupId}`,
      'create the group with at least one valid zone in config/groups.json'
    ));
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
      logger.error?.(`[zone_controller] write failed for zone ${zoneId}:`, withRemediation(
        error.message || 'Unknown serial write error',
        `validate zone ${zoneId} command format and serial connectivity, then retry`
      ));
      results.push({
        zoneId,
        ok: false,
        error: withRemediation(
          error.message || 'Unknown serial write error',
          `validate zone ${zoneId} command format and serial connectivity, then retry`
        )
      });
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
