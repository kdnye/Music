const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { createDax88Monitor, parseDax88StatusFrame } = require('../src/agents/dax88Monitor');

test('parseDax88StatusFrame parses a valid frame', () => {
  const parsed = parseDax88StatusFrame('>01010A0101000000000001\r');

  assert.equal(parsed.zoneId, '01');
  assert.equal(parsed.power, true);
  assert.equal(parsed.source, 10);
  assert.equal(parsed.volume, 1);
  assert.equal(parsed.mute, true);
});

test('parseDax88StatusFrame returns null for malformed frames', () => {
  assert.equal(parseDax88StatusFrame('invalid-frame'), null);
  assert.equal(parseDax88StatusFrame('>09010A0101000000000001\r'), null);
  assert.equal(parseDax88StatusFrame('>01GG0A0101000000000001\r'), null);
  assert.equal(parseDax88StatusFrame('>01010A0101000000000001FF\r'), null);
});

test('monitor pollOnce skips state mutation for malformed frame and preserves last known-good state', async () => {
  const serialPort = new EventEmitter();
  const warned = [];
  const frames = ['>01010A0101000000000001\r', '>01INVALID0000000000000\r'];
  let index = 0;

  const monitor = createDax88Monitor({
    activeZones: ['01'],
    serialPort,
    logger: { warn: (...args) => warned.push(args), error: () => {} },
    writeQuery: async () => {
      const frame = frames[index];
      index += 1;
      setTimeout(() => {
        serialPort.emit('data', Buffer.from(frame, 'utf8'));
      }, 0);
    }
  });

  await monitor.pollOnce();
  const firstState = monitor.getZoneStates()['01'];
  assert.equal(firstState.zoneId, '01');

  const secondResult = await monitor.pollOnce();
  assert.equal(secondResult.events.length, 0);
  assert.equal(monitor.getZoneStates()['01'].volume, firstState.volume);
  assert.equal(warned.length, 1);
});
