const axios = require('axios');
const { validateUp2StreamBaseUrl } = require('../api/validators');

const HEX_FIELDS = ['Title', 'Artist', 'Album'];

function decodeHexToAscii(hexValue) {
  if (typeof hexValue !== 'string' || !hexValue.length) {
    return '';
  }

  const cleaned = hexValue.replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) {
    return hexValue;
  }

  let output = '';
  for (let i = 0; i < cleaned.length; i += 2) {
    const code = Number.parseInt(cleaned.slice(i, i + 2), 16);
    if (!Number.isNaN(code) && code > 0) {
      output += String.fromCharCode(code);
    }
  }
  return output;
}

function decodeMetadata(rawPayload) {
  const payload = { ...rawPayload };

  for (const field of HEX_FIELDS) {
    payload[field] = decodeHexToAscii(payload[field]);
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
