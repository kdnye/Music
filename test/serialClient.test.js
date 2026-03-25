const test = require('node:test');
const assert = require('node:assert/strict');

const { enqueueCommand, getSerialConfig, parseIntWithFallback } = require('../src/dax88/serialClient');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('enqueueCommand executes queued tasks in strict FIFO order', async () => {
  const executionOrder = [];

  const first = enqueueCommand(async () => {
    await sleep(20);
    executionOrder.push('first');
    return 'first-result';
  }, { interWriteDelayMs: 0, timeoutMs: 500 });

  const second = enqueueCommand(async () => {
    executionOrder.push('second');
    return 'second-result';
  }, { interWriteDelayMs: 0, timeoutMs: 500 });

  const third = enqueueCommand(async () => {
    executionOrder.push('third');
    return 'third-result';
  }, { interWriteDelayMs: 0, timeoutMs: 500 });

  const results = await Promise.all([first, second, third]);

  assert.deepEqual(results, ['first-result', 'second-result', 'third-result']);
  assert.deepEqual(executionOrder, ['first', 'second', 'third']);
});

test('enqueueCommand applies configured inter-write delay before starting next task', async () => {
  let firstTaskFinishedAt = 0;
  let secondTaskStartedAt = 0;

  await Promise.all([
    enqueueCommand(async () => {
      firstTaskFinishedAt = Date.now();
    }, { interWriteDelayMs: 50, timeoutMs: 500 }),
    enqueueCommand(async () => {
      secondTaskStartedAt = Date.now();
    }, { interWriteDelayMs: 0, timeoutMs: 500 })
  ]);

  assert.ok(secondTaskStartedAt >= firstTaskFinishedAt + 40);
});

test('parseIntWithFallback returns fallback on invalid values', () => {
  assert.equal(parseIntWithFallback('42', 10), 42);
  assert.equal(parseIntWithFallback(undefined, 10), 10);
  assert.equal(parseIntWithFallback('invalid', 10), 10);
});

test('getSerialConfig respects serial env overrides for bluetooth adapters', () => {
  const originalEnv = {
    DAX88_SERIAL_PORT: process.env.DAX88_SERIAL_PORT,
    DAX88_SERIAL_BAUD_RATE: process.env.DAX88_SERIAL_BAUD_RATE,
    DAX88_SERIAL_DATA_BITS: process.env.DAX88_SERIAL_DATA_BITS,
    DAX88_SERIAL_PARITY: process.env.DAX88_SERIAL_PARITY,
    DAX88_SERIAL_STOP_BITS: process.env.DAX88_SERIAL_STOP_BITS
  };

  process.env.DAX88_SERIAL_PORT = '/dev/rfcomm0';
  process.env.DAX88_SERIAL_BAUD_RATE = '9600';
  process.env.DAX88_SERIAL_DATA_BITS = '8';
  process.env.DAX88_SERIAL_PARITY = 'none';
  process.env.DAX88_SERIAL_STOP_BITS = '1';

  const config = getSerialConfig();
  assert.equal(config.path, '/dev/rfcomm0');
  assert.equal(config.baudRate, 9600);
  assert.equal(config.dataBits, 8);
  assert.equal(config.parity, 'none');
  assert.equal(config.stopBits, 1);

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});
