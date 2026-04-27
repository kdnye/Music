const fs = require('fs');
const path = require('path');

function withRemediation(message, remediation) {
  return `${message}. Remediation: ${remediation}`;
}

const DEFAULT_SCHEDULE = Object.freeze({
  enabled: false,
  timezone: 'America/Phoenix',
  keepAliveIntervalMinutes: 5,
  businessHours: {
    days: [1, 2, 3, 4, 5],
    start: '08:00',
    end: '18:00'
  },
  zoneSchedules: []
});

function normalizeZoneId(zoneId) {
  const parsed = Number.parseInt(zoneId, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new Error(withRemediation(
      `zoneId must be between 01 and 08. Received: ${zoneId}`,
      'set zoneId to a numeric value from 1 to 8'
    ));
  }

  return String(parsed).padStart(2, '0');
}

function parseTimeOfDay(raw) {
  if (typeof raw !== 'string') {
    throw new Error(withRemediation(
      'time must be a string in HH:MM format',
      'send times as zero-padded 24-hour strings, for example 08:30'
    ));
  }

  const match = raw.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    throw new Error(withRemediation(
      `Invalid time format: ${raw}. Use HH:MM`,
      'use a 24-hour HH:MM value such as 17:45'
    ));
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(withRemediation(
      `Invalid time value: ${raw}`,
      'ensure hours are 00-23 and minutes are 00-59'
    ));
  }

  return hours * 60 + minutes;
}

function normalizeDays(days) {
  if (!Array.isArray(days) || days.length === 0) {
    throw new Error(withRemediation(
      'days must be a non-empty array of weekday numbers 0-6',
      'provide at least one weekday where 0=Sun ... 6=Sat'
    ));
  }

  const normalized = [...new Set(days.map((value) => Number.parseInt(value, 10)))].sort((a, b) => a - b);
  for (const day of normalized) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new Error(withRemediation(
        `Invalid weekday value: ${day}`,
        'each day must be an integer from 0 to 6'
      ));
    }
  }
  return normalized;
}

function normalizeSchedule(payload = {}) {
  const enabled = Boolean(payload.enabled);
  const timezone = typeof payload.timezone === 'string' && payload.timezone.trim()
    ? payload.timezone.trim()
    : DEFAULT_SCHEDULE.timezone;

  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch (_error) {
    throw new Error(withRemediation(
      `Invalid timezone: ${timezone}`,
      'use an IANA timezone such as America/Phoenix or UTC'
    ));
  }

  const keepAliveIntervalMinutes = Number.parseInt(
    payload.keepAliveIntervalMinutes ?? DEFAULT_SCHEDULE.keepAliveIntervalMinutes,
    10
  );
  if (!Number.isInteger(keepAliveIntervalMinutes) || keepAliveIntervalMinutes < 1 || keepAliveIntervalMinutes > 60) {
    throw new Error(withRemediation(
      'keepAliveIntervalMinutes must be an integer between 1 and 60',
      'set keepAliveIntervalMinutes to a whole number in the allowed range'
    ));
  }

  const businessHours = payload.businessHours || {};
  const normalizedBusinessHours = {
    days: normalizeDays(businessHours.days || DEFAULT_SCHEDULE.businessHours.days),
    start: businessHours.start || DEFAULT_SCHEDULE.businessHours.start,
    end: businessHours.end || DEFAULT_SCHEDULE.businessHours.end
  };
  parseTimeOfDay(normalizedBusinessHours.start);
  parseTimeOfDay(normalizedBusinessHours.end);

  const zoneSchedules = Array.isArray(payload.zoneSchedules) ? payload.zoneSchedules : [];
  const normalizedZoneSchedules = zoneSchedules.map((entry) => {
    const zoneId = normalizeZoneId(entry.zoneId);
    const start = entry.start || normalizedBusinessHours.start;
    const end = entry.end || normalizedBusinessHours.end;

    parseTimeOfDay(start);
    parseTimeOfDay(end);

    return {
      zoneId,
      days: normalizeDays(entry.days || normalizedBusinessHours.days),
      start,
      end,
      keepAlive: entry.keepAlive !== false,
      powerOnAtStart: entry.powerOnAtStart !== false,
      powerOffAtEnd: Boolean(entry.powerOffAtEnd)
    };
  });

  return {
    enabled,
    timezone,
    keepAliveIntervalMinutes,
    businessHours: normalizedBusinessHours,
    zoneSchedules: normalizedZoneSchedules
  };
}

function ensureParentDirectory(filePath) {
  const parentDirectory = path.dirname(filePath);
  fs.mkdirSync(parentDirectory, { recursive: true });
}

function createScheduleStore({
  filePath = process.env.DAX88_SCHEDULE_FILE || path.resolve(process.cwd(), 'config/schedules.json'),
  logger = console
} = {}) {
  let current = { ...DEFAULT_SCHEDULE };

  function load() {
    try {
      if (!fs.existsSync(filePath)) {
        current = normalizeSchedule(DEFAULT_SCHEDULE);
        return current;
      }

      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      current = normalizeSchedule(parsed);
      return current;
    } catch (error) {
      logger.warn?.('[schedule] failed to load schedule file, using defaults:', withRemediation(
        error.message,
        'fix schedule JSON/timezone values, then reload configuration'
      ));
      current = normalizeSchedule(DEFAULT_SCHEDULE);
      return current;
    }
  }

  function save(nextSchedule) {
    const normalized = normalizeSchedule(nextSchedule);
    ensureParentDirectory(filePath);
    fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    current = normalized;
    return current;
  }

  function get() {
    return current;
  }

  load();

  return {
    get,
    load,
    save,
    filePath
  };
}

function getZonedParts({ date, timeZone }) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };

  const weekday = weekdayMap[parts.find((part) => part.type === 'weekday')?.value] ?? null;
  const hours = Number.parseInt(parts.find((part) => part.type === 'hour')?.value || '0', 10);
  const minutes = Number.parseInt(parts.find((part) => part.type === 'minute')?.value || '0', 10);

  return {
    weekday,
    minutesOfDay: (hours * 60) + minutes
  };
}

function isInsideWindow({ minutesOfDay, weekday }, windowConfig) {
  const startMinutes = parseTimeOfDay(windowConfig.start);
  const endMinutes = parseTimeOfDay(windowConfig.end);
  const includesDay = windowConfig.days.includes(weekday);

  if (!includesDay) {
    return false;
  }

  if (startMinutes === endMinutes) {
    return true;
  }

  if (startMinutes < endMinutes) {
    return minutesOfDay >= startMinutes && minutesOfDay < endMinutes;
  }

  return minutesOfDay >= startMinutes || minutesOfDay < endMinutes;
}

function createLiveScheduleAgent({
  getSchedule,
  executeZonePowerCommand,
  now = () => new Date(),
  logger = console
}) {
  if (typeof getSchedule !== 'function') {
    throw new Error(withRemediation('getSchedule must be provided', 'pass a function that returns the current schedule payload'));
  }

  if (typeof executeZonePowerCommand !== 'function') {
    throw new Error(withRemediation(
      'executeZonePowerCommand must be provided',
      'pass an async function that sends per-zone power commands'
    ));
  }

  const zoneState = new Map();

  async function runCycle() {
    const schedule = normalizeSchedule(getSchedule());
    if (!schedule.enabled) {
      return { ran: false, reason: 'disabled' };
    }

    const clock = getZonedParts({ date: now(), timeZone: schedule.timezone });
    const inBusinessHours = isInsideWindow(clock, schedule.businessHours);

    if (!inBusinessHours) {
      return { ran: false, reason: 'outside-business-hours' };
    }

    const intervalMs = schedule.keepAliveIntervalMinutes * 60_000;
    const activeZoneIds = new Set();

    for (const zoneSchedule of schedule.zoneSchedules) {
      if (!isInsideWindow(clock, zoneSchedule)) {
        const previous = zoneState.get(zoneSchedule.zoneId);
        if (previous?.active && zoneSchedule.powerOffAtEnd) {
          await executeZonePowerCommand({ zoneId: zoneSchedule.zoneId, power: false, reason: 'schedule-end' });
        }
        zoneState.set(zoneSchedule.zoneId, { active: false, lastKeepAliveAt: previous?.lastKeepAliveAt || 0 });
        continue;
      }

      activeZoneIds.add(zoneSchedule.zoneId);
      const previous = zoneState.get(zoneSchedule.zoneId) || { active: false, lastKeepAliveAt: 0 };
      if (!previous.active && zoneSchedule.powerOnAtStart) {
        await executeZonePowerCommand({ zoneId: zoneSchedule.zoneId, power: true, reason: 'schedule-start' });
      }

      const nowEpoch = now().getTime();
      const elapsed = nowEpoch - (previous.lastKeepAliveAt || 0);
      if (zoneSchedule.keepAlive && elapsed >= intervalMs) {
        await executeZonePowerCommand({ zoneId: zoneSchedule.zoneId, power: true, reason: 'keepalive' });
        zoneState.set(zoneSchedule.zoneId, { active: true, lastKeepAliveAt: nowEpoch });
      } else {
        zoneState.set(zoneSchedule.zoneId, { active: true, lastKeepAliveAt: previous.lastKeepAliveAt || 0 });
      }
    }

    logger.info?.(`[liveSchedule] active zones: ${Array.from(activeZoneIds).join(',') || 'none'}`);

    return {
      ran: true,
      inBusinessHours,
      activeZones: Array.from(activeZoneIds)
    };
  }

  return {
    runCycle
  };
}

module.exports = {
  DEFAULT_SCHEDULE,
  createLiveScheduleAgent,
  createScheduleStore,
  getZonedParts,
  isInsideWindow,
  normalizeSchedule,
  parseTimeOfDay
};
