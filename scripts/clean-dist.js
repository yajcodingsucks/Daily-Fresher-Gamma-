// Deletes dist\ before a build, so no half-built files (or a 0-byte app.asar) are left behind.
// If a file is locked it says which program usually holds it, instead of failing in the middle of the build.

const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
try {
  fs.rmSync(dist, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  console.log('✓ dist\\ deleted');
} catch (err) {
  console.error(`
✗ dist\\ could not be deleted: ${err.code || ''} ${err.path || err.message}

A program still has a file in dist\\ open:
  • Daily Fresher Invoices started from dist\\ — close it.
  • Visual Studio Code — it keeps .asar files open once it has looked at them. Close VS Code completely
    (all windows), run "npm run dist" from a normal Command Prompt or PowerShell, then open VS Code again.
`);
  process.exit(1);
}
