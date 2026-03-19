const MAX_ZONE = 8;
const MAX_VOLUME = 38;
const MAX_SOURCE = 8;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function assertInteger(name, value) {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
}

function validateZone(zone) {
  assertInteger('zone', zone);
  if (zone < 1 || zone > MAX_ZONE) {
    throw new Error(`zone must be between 1 and ${MAX_ZONE}`);
  }
  return pad2(zone);
}

function validateVolume(volume) {
  assertInteger('volume', volume);
  if (volume < 0 || volume > MAX_VOLUME) {
    throw new Error(`volume must be between 0 and ${MAX_VOLUME}`);
  }
  return pad2(volume);
}

function validateSource(source) {
  assertInteger('source', source);
  if (source < 1 || source > MAX_SOURCE) {
    throw new Error(`source must be between 1 and ${MAX_SOURCE}`);
  }
  return pad2(source);
}

function validatePower(power) {
  if (typeof power === 'boolean') return power;
  if (typeof power === 'string') {
    const normalized = power.toLowerCase();
    if (['on', 'true', '1'].includes(normalized)) return true;
    if (['off', 'false', '0'].includes(normalized)) return false;
  }
  throw new Error('power must be boolean or one of: on/off, true/false, 1/0');
}

function buildVolumeCommand(zone, volume) {
  const z = validateZone(zone);
  const v = validateVolume(volume);
  return `<${z}VO${v}\r`;
}

function buildPowerCommand(zone, power) {
  const z = validateZone(zone);
  const state = validatePower(power) ? '01' : '00';
  return `<${z}PR${state}\r`;
}

function buildSourceCommand(zone, source) {
  const z = validateZone(zone);
  const s = validateSource(source);
  return `<${z}CH${s}\r`;
}

module.exports = {
  buildPowerCommand,
  buildSourceCommand,
  buildVolumeCommand,
  validatePower,
  validateSource,
  validateVolume,
  validateZone
};
