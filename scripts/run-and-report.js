// Runs the full suite, always sends the email report, then exits with the test run's status
// so CI and callers still see failures.
const { spawnSync } = require('child_process');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tests = spawnSync(npm, ['run', 'test:main'], { stdio: 'inherit', shell: process.platform === 'win32' });
const email = spawnSync(npm, ['run', 'report:email'], { stdio: 'inherit', shell: process.platform === 'win32' });

if (email.status !== 0) console.error('Report email step failed.');
process.exit(tests.status !== 0 ? tests.status || 1 : email.status || 0);
