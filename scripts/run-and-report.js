// Runs a designated test suite (or full suite by default), generates reports, and sends execution summary email.
const { spawnSync } = require('child_process');

const targetArg = process.argv[2] ? process.argv[2].toLowerCase().trim() : '';
let testScript = 'test:main';
let suiteName = 'River Stream Automation Suite';

if (targetArg === 'po-quote' || targetArg === 'po_quote' || targetArg === 'test:po-quote') {
  testScript = 'test:po-quote';
  suiteName = 'River Stream PO & Quote Automation Suite';
} else if (targetArg === 'po-ack' || targetArg === 'po_ack' || targetArg === 'test:po-ack' || targetArg === 'recon') {
  testScript = 'test:po-ack';
  suiteName = 'River Stream PO-ACK Recon Automation Suite';
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
console.log(`\n======================================================`);
console.log(`🚀 Starting Test Execution: ${suiteName} (${testScript})`);
console.log(`======================================================\n`);

const env = { ...process.env, SUITE_NAME: suiteName };
const tests = spawnSync(npm, ['run', testScript], { stdio: 'inherit', shell: process.platform === 'win32', env });

console.log(`\n======================================================`);
console.log(`📧 Generating & Sending Test Report Email: ${suiteName}`);
console.log(`======================================================\n`);

const email = spawnSync(npm, ['run', 'report:email'], { stdio: 'inherit', shell: process.platform === 'win32', env });

if (email.status !== 0) console.error('Report email step failed.');
process.exit(tests.status !== 0 ? tests.status || 1 : email.status || 0);
