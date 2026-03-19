const { URL } = require('url');

function assertInteger(name, value) {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
}

function validateZone(zone) {
  assertInteger('zone', zone);
  if (zone < 1 || zone > 8) {
    throw new Error('zone must be between 1 and 8');
  }
  return zone;
}

function validateVolume(volume) {
  assertInteger('volume', volume);
  if (volume < 0 || volume > 38) {
    throw new Error('volume must be between 0 and 38');
  }
  return volume;
}

function validateSource(source) {
  assertInteger('source', source);
  if (source < 1 || source > 8) {
    throw new Error('source must be between 1 and 8');
  }
  return source;
}

function validatePower(power) {
  if (typeof power === 'boolean') {
    return power;
  }

  if (typeof power === 'string') {
    const normalized = power.trim().toLowerCase();
    if (['on', 'true', '1'].includes(normalized)) return true;
    if (['off', 'false', '0'].includes(normalized)) return false;
  }

  throw new Error('power must be boolean or one of: on/off, true/false, 1/0');
}

function rejectUnknownFields(payload, allowedFields) {
  const fields = Object.keys(payload || {});
  const unknown = fields.filter((field) => !allowedFields.includes(field));
  if (unknown.length > 0) {
    throw new Error(`unknown fields: ${unknown.join(', ')}`);
  }
}

function validateVolumePayload(payload) {
  rejectUnknownFields(payload, ['zone', 'volume']);

  return {
    zone: validateZone(payload.zone),
    volume: validateVolume(payload.volume)
  };
}

function validatePowerPayload(payload) {
  rejectUnknownFields(payload, ['zone', 'power']);

  return {
    zone: validateZone(payload.zone),
    power: validatePower(payload.power)
  };
}

function validateSourcePayload(payload) {
  rejectUnknownFields(payload, ['zone', 'source']);

  return {
    zone: validateZone(payload.zone),
    source: validateSource(payload.source)
  };
}

function validateUp2StreamBaseUrl(baseUrl) {
  if (!baseUrl) {
    throw new Error('UP2STREAM_BASE_URL is required');
  }

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (_error) {
    throw new Error('UP2STREAM_BASE_URL must be a valid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('UP2STREAM_BASE_URL must use http or https');
  }

  if (!parsed.hostname) {
    throw new Error('UP2STREAM_BASE_URL must include a hostname');
  }

  return parsed.toString().replace(/\/$/, '');
}

module.exports = {
  validatePower,
  validatePowerPayload,
  validateSourcePayload,
  validateUp2StreamBaseUrl,
  validateVolumePayload,
  validateZone
};
