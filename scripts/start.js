// Launches the app with Electron. Clears ELECTRON_RUN_AS_NODE, which some
// shells (e.g. VS Code terminals) inherit and which makes Electron behave as
// plain Node instead of opening a window.
const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.join(__dirname, '..'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});
child.on('exit', (code) => process.exit(code ?? 0));
