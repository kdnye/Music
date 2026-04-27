const { URL } = require('url');

function withRemediation(message, remediation) {
  return `${message}. Remediation: ${remediation}`;
}

function assertInteger(name, value) {
  if (!Number.isInteger(value)) {
    throw new Error(withRemediation(
      `${name} must be an integer`,
      `send ${name} as a JSON number, not a string or decimal`
    ));
  }
}

function validateZone(zone) {
  assertInteger('zone', zone);
  if (zone < 1 || zone > 8) {
    throw new Error(withRemediation('zone must be between 1 and 8', 'choose a DAX88 zone in the 1-8 range'));
  }
  return zone;
}

function validateVolume(volume) {
  assertInteger('volume', volume);
  if (volume < 0 || volume > 38) {
    throw new Error(withRemediation('volume must be between 0 and 38', 'set volume to a protocol-safe value from 0 to 38'));
  }
  return volume;
}

function validateSource(source) {
  assertInteger('source', source);
  if (source < 1 || source > 8) {
    throw new Error(withRemediation('source must be between 1 and 8', 'select an available source input from 1 to 8'));
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

  throw new Error(withRemediation(
    'power must be boolean or one of: on/off, true/false, 1/0',
    'provide power as true/false (recommended) or one of the accepted string tokens'
  ));
}

function rejectUnknownFields(payload, allowedFields) {
  const fields = Object.keys(payload || {});
  const unknown = fields.filter((field) => !allowedFields.includes(field));
  if (unknown.length > 0) {
    throw new Error(withRemediation(
      `unknown fields: ${unknown.join(', ')}`,
      `remove unsupported fields and only send: ${allowedFields.join(', ')}`
    ));
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
    throw new Error(withRemediation(
      'UP2STREAM_BASE_URL is required',
      'set UP2STREAM_BASE_URL (for example http://192.168.1.50) before starting the server'
    ));
  }

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (_error) {
    throw new Error(withRemediation(
      'UP2STREAM_BASE_URL must be a valid URL',
      'provide an absolute URL such as http://device-ip or https://device-host'
    ));
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(withRemediation(
      'UP2STREAM_BASE_URL must use http or https',
      'update the URL scheme to http:// or https://'
    ));
  }

  if (!parsed.hostname) {
    throw new Error(withRemediation(
      'UP2STREAM_BASE_URL must include a hostname',
      'set a resolvable hostname or IP address in UP2STREAM_BASE_URL'
    ));
  }

  return parsed.toString().replace(/\/$/, '');
}

module.exports = {
  validatePower,
  validatePowerPayload,
  validateSourcePayload,
  validateUp2StreamBaseUrl,
  validateVolume,
  validateVolumePayload,
  validateZone
};
