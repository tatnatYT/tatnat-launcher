// Headless test: install + launch a version, wait until the game window is up, then kill it.
// Usage: node scripts/smoke.js [version] [rootDir]
const path = require('path');
const os = require('os');
const { launch } = require('../src/core/launch');

const versionId = process.argv[2] || '1.21.10';
const root = process.argv[3] || path.join(os.tmpdir(), 'tatnatclient-smoke');
let last = '';

launch({
  root, versionId, account: { type: 'offline', name: 'SmokeTest' }, memoryMb: 2048,
  onProgress: (stage, d, t) => {
    const line = `${stage} ${d}/${t}`;
    if (stage !== last || d === t) { console.log(line); last = stage; }
  },
  onLog: chunk => process.stdout.write(chunk),
}).then(child => {
  let buffer = '', started = false;
  const timer = setTimeout(() => { console.log('\nSMOKE FAIL: timed out'); child.kill(); process.exit(1); }, 180000);
  const check = chunk => {
    buffer += chunk;
    if (!started && /Backend library: LWJGL|LWJGL Version|Sound engine started|Created: \d+x\d+|Setting user:/.test(buffer)) {
      started = true;
      clearTimeout(timer);
      console.log('\nSMOKE OK: game started');
      setTimeout(() => { child.kill(); process.exit(0); }, 3000);
    }
  };
  // Very old builds log almost nothing; still being alive after 40s counts as started.
  const alive = setTimeout(() => check('Setting user: (alive 40s)'), 40000);
  child.on('exit', () => clearTimeout(alive));
  child.stdout.on('data', check);
  child.stderr.on('data', check);
  child.on('exit', code => {
    if (started) return; console.log(`\nSMOKE FAIL: game exited with ${code}`); process.exit(1); });
}).catch(err => { console.error('SMOKE FAIL:', err); process.exit(1); });
