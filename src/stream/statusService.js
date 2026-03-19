const axios = require('axios');
const { validateUp2StreamBaseUrl } = require('../api/validators');

const HEX_FIELDS = ['Title', 'Artist', 'Album'];

function decodeHexToAscii(hexValue, options = {}) {
  const {
    fallback = hexValue,
    invalidUtf8Fallback = fallback,
    onDecodeError
  } = options;

  if (hexValue == null) {
    return hexValue;
  }

  if (typeof hexValue !== 'string') {
    return fallback;
  }

  if (!hexValue.length) {
    return '';
  }

  const cleaned = hexValue.replace(/\s+/g, '');
  if (!cleaned.length) {
    return '';
  }

  if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) {
    return fallback;
  }

  try {
    const decoded = Buffer.from(cleaned, 'hex').toString('utf8');
    const withoutNulls = decoded.replace(/\0/g, '');

    // U+FFFD indicates invalid UTF-8 sequences were encountered.
    if (withoutNulls.includes('\uFFFD')) {
      onDecodeError?.('invalid-utf8');
      return invalidUtf8Fallback;
    }

    return withoutNulls;
  } catch {
    onDecodeError?.('decode-failed');
    return fallback;
  }
}

function decodeMetadata(rawPayload) {
  const payload = { ...rawPayload };
  const decodeErrors = [];

  for (const field of HEX_FIELDS) {
    payload[field] = decodeHexToAscii(payload[field], {
      onDecodeError: (error) => {
        decodeErrors.push({ field, error });
      }
    });
  }

  if (decodeErrors.length) {
    payload.decodeError = true;
    payload.decodeErrors = decodeErrors;
  }

  return payload;
}

async function fetchPlayerStatus() {
  const baseUrl = validateUp2StreamBaseUrl(process.env.UP2STREAM_BASE_URL);
  const url = `${baseUrl}/getPlayerStatus`;
  const { data } = await axios.get(url, {
    timeout: Number.parseInt(process.env.UP2STREAM_TIMEOUT_MS || '4000', 10)
  });

  return {
    endpoint: url,
    raw: data,
    decoded: decodeMetadata(data),
    fetchedAt: new Date().toISOString()
  };
}

module.exports = {
  decodeHexToAscii,
  decodeMetadata,
  fetchPlayerStatus
};
