// Cross-platform "open this file in the default app".
const { exec } = require('child_process');
const path = require('path');

const target = path.resolve(process.argv[2]);
const cmd = process.platform === 'win32' ? `start "" "${target}"`
  : process.platform === 'darwin' ? `open "${target}"` : `xdg-open "${target}"`;
exec(cmd, err => { if (err) console.log(`Report written to ${target}`); });
