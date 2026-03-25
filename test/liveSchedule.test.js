const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createLiveScheduleAgent,
  isInsideWindow,
  normalizeSchedule,
  parseTimeOfDay
} = require('../src/scheduling/liveSchedule');

test('parseTimeOfDay parses HH:MM', () => {
  assert.equal(parseTimeOfDay('00:00'), 0);
  assert.equal(parseTimeOfDay('23:59'), (23 * 60) + 59);
});

test('isInsideWindow handles same-day and overnight windows', () => {
  const sameDayWindow = { days: [1], start: '09:00', end: '17:00' };
  assert.equal(isInsideWindow({ weekday: 1, minutesOfDay: 10 * 60 }, sameDayWindow), true);
  assert.equal(isInsideWindow({ weekday: 1, minutesOfDay: 18 * 60 }, sameDayWindow), false);

  const overnightWindow = { days: [1], start: '22:00', end: '06:00' };
  assert.equal(isInsideWindow({ weekday: 1, minutesOfDay: 23 * 60 }, overnightWindow), true);
  assert.equal(isInsideWindow({ weekday: 1, minutesOfDay: 5 * 60 }, overnightWindow), true);
});

test('normalizeSchedule validates timezone and zone schedules', () => {
  const normalized = normalizeSchedule({
    enabled: true,
    timezone: 'America/Phoenix',
    keepAliveIntervalMinutes: 10,
    businessHours: { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' },
    zoneSchedules: [
      { zoneId: '1', days: [1, 2], start: '09:00', end: '11:00', powerOffAtEnd: true }
    ]
  });

  assert.equal(normalized.zoneSchedules[0].zoneId, '01');
  assert.equal(normalized.zoneSchedules[0].powerOffAtEnd, true);
});

test('createLiveScheduleAgent powers zone on at start and sends keepalive on interval', async () => {
  const commands = [];
  const clock = { current: new Date('2026-03-23T16:00:00.000Z') };

  const agent = createLiveScheduleAgent({
    getSchedule: () => ({
      enabled: true,
      timezone: 'UTC',
      keepAliveIntervalMinutes: 5,
      businessHours: { days: [1, 2, 3, 4, 5], start: '00:00', end: '23:59' },
      zoneSchedules: [{ zoneId: '01', days: [1, 2, 3, 4, 5], start: '00:00', end: '23:59', powerOffAtEnd: true }]
    }),
    executeZonePowerCommand: async (command) => {
      commands.push(command);
    },
    now: () => clock.current,
    logger: { info: () => {} }
  });

  await agent.runCycle();
  assert.deepEqual(commands.map((entry) => entry.reason), ['schedule-start', 'keepalive']);

  commands.length = 0;
  clock.current = new Date('2026-03-23T16:02:00.000Z');
  await agent.runCycle();
  assert.equal(commands.length, 0);

  clock.current = new Date('2026-03-23T16:06:00.000Z');
  await agent.runCycle();
  assert.deepEqual(commands.map((entry) => entry.reason), ['keepalive']);
});
