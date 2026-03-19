const {
  validatePowerPayload,
  validateSourcePayload,
  validateVolumePayload
} = require('../api/validators');

function pad2(value) {
  return String(value).padStart(2, '0');
}

function buildVolumeCommand(zone, volume) {
  const validated = validateVolumePayload({ zone, volume });
  const z = pad2(validated.zone);
  const v = pad2(validated.volume);
  return `<${z}VO${v}\r`;
}

function buildPowerCommand(zone, power) {
  const validated = validatePowerPayload({ zone, power });
  const z = pad2(validated.zone);
  const state = validated.power ? '01' : '00';
  return `<${z}PR${state}\r`;
}

function buildSourceCommand(zone, source) {
  const validated = validateSourcePayload({ zone, source });
  const z = pad2(validated.zone);
  const s = pad2(validated.source);
  return `<${z}CH${s}\r`;
}

module.exports = {
  buildPowerCommand,
  buildSourceCommand,
  buildVolumeCommand
};
