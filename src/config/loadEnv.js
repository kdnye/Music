const fs = require('fs');
const path = require('path');

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex === -1) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  if (!key) {
    return null;
  }

  const rawValue = trimmed.slice(separatorIndex + 1).trim();
  const quoted = rawValue.match(/^(["'])(.*)\1$/);
  const value = quoted ? quoted[2] : rawValue;

  return [key, value];
}

function loadEnvFile({ filePath = path.resolve(process.cwd(), '.env') } = {}) {
  if (!fs.existsSync(filePath)) {
    return { loaded: false, filePath };
  }

  const contents = fs.readFileSync(filePath, 'utf8');
  const lines = contents.split(/\r?\n/);
  let applied = 0;

  for (const line of lines) {
    const entry = parseEnvLine(line);
    if (!entry) continue;

    const [key, value] = entry;
    if (process.env[key] == null) {
      process.env[key] = value;
      applied += 1;
    }
  }

  return { loaded: true, filePath, applied };
}

module.exports = {
  loadEnvFile
};
