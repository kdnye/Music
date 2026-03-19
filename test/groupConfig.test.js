const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadGroups } = require('../src/config/groups');

test('loadGroups reads config file and allows env override', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-test-'));
  const groupsFile = path.join(tempDir, 'groups.json');

  fs.writeFileSync(groupsFile, JSON.stringify({
    sales: ['01', '02'],
    support: ['03']
  }));

  const groups = loadGroups({
    groupsFilePath: groupsFile,
    env: {
      DAX88_ZONE_GROUPS: JSON.stringify({
        support: ['04', 'bad-zone'],
        ops: ['05', '05']
      })
    },
    logger: { warn: () => {} }
  });

  assert.deepEqual(groups, {
    sales: ['01', '02'],
    support: ['04'],
    ops: ['05']
  });
});
