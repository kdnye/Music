const test = require('node:test');
const assert = require('node:assert/strict');

const { createZoneController } = require('../src/agents/zoneController');

test('executeGroupCommand fans out in deterministic order with continue-on-error summary', async () => {
  const writes = [];
  let attempts = 0;

  const zoneController = createZoneController({
    groups: {
      team: ['03', '01', '02']
    },
    interWriteDelayMs: 1,
    writeFn: async (command) => {
      writes.push(command);
      attempts += 1;
      if (attempts === 2) {
        throw new Error('simulated write failure');
      }
      return { skipped: false };
    },
    logger: { error: () => {} }
  });

  const response = await zoneController.executeGroupCommand({
    groupId: 'team',
    command: { type: 'volume', volume: 15 }
  });

  assert.deepEqual(writes, ['<01VO15\r', '<02VO15\r', '<03VO15\r']);
  assert.deepEqual(response.results, [
    { zoneId: '01', ok: true },
    { zoneId: '02', ok: false, error: 'simulated write failure' },
    { zoneId: '03', ok: true }
  ]);
  assert.deepEqual(response.summary, { total: 3, succeeded: 2, failed: 1 });
  assert.ok(response.requestId);
});
