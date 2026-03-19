const fs = require('fs');
const path = require('path');

const DEFAULT_GROUPS_PATH = path.join(process.cwd(), 'config', 'groups.json');

function normalizeZone(zone) {
  const zoneNumber = Number.parseInt(zone, 10);
  if (!Number.isInteger(zoneNumber) || zoneNumber < 1 || zoneNumber > 8) {
    return null;
  }
  return String(zoneNumber).padStart(2, '0');
}

function normalizeGroups(groups) {
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) {
    return {};
  }

  return Object.entries(groups).reduce((acc, [groupId, zones]) => {
    if (!Array.isArray(zones)) {
      return acc;
    }

    const normalized = [...new Set(zones.map(normalizeZone).filter(Boolean))];
    if (normalized.length > 0) {
      acc[groupId] = normalized;
    }

    return acc;
  }, {});
}

function parseGroupJson(rawJson, sourceLabel, logger = console) {
  if (!rawJson) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawJson);
    return normalizeGroups(parsed);
  } catch (error) {
    logger.warn?.(`[groups] Failed to parse ${sourceLabel}: ${error.message}`);
    return {};
  }
}

function loadFileGroups({ groupsFilePath = DEFAULT_GROUPS_PATH, logger = console } = {}) {
  if (!fs.existsSync(groupsFilePath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(groupsFilePath, 'utf8');
    return parseGroupJson(raw, groupsFilePath, logger);
  } catch (error) {
    logger.warn?.(`[groups] Failed to read group file ${groupsFilePath}: ${error.message}`);
    return {};
  }
}

function loadGroups({ env = process.env, groupsFilePath = env.DAX88_GROUPS_FILE || DEFAULT_GROUPS_PATH, logger = console } = {}) {
  const fileGroups = loadFileGroups({ groupsFilePath, logger });
  const envGroups = parseGroupJson(env.DAX88_ZONE_GROUPS, 'DAX88_ZONE_GROUPS', logger);

  return {
    ...fileGroups,
    ...envGroups
  };
}

module.exports = {
  DEFAULT_GROUPS_PATH,
  loadGroups,
  normalizeGroups,
  parseGroupJson
};
