const test = require('node:test');
const assert = require('node:assert/strict');

const { enqueueCommand } = require('../src/dax88/serialClient');

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
