const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-api-'));
process.env.APP_DATA_DIR = tmpDir;
process.env.AI_API_KEY = '';

async function main() {
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/dashboard`);
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.success, true);
    assert.ok(data.data.user, 'dashboard should include viewer user');
    assert.ok(Array.isArray(data.data.todayTasks), 'dashboard should include today tasks');
    assert.strictEqual(Object.hasOwn(data.data, 'recentIssues'), false, 'dashboard should no longer expose error notebook issues');
    assert.ok(data.data.abilityProfile, 'dashboard should include ability profile summary');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const statePath = path.join(tmpDir, 'app-state.json');
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
