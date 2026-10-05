// Watches a folder for a newly downloaded .zip of (about) a known size - used for packs that
// must be downloaded in the browser. Files already there when watching starts are ignored.
const fs = require('fs');
const path = require('path');

function watchForZip({ folder, sizeBytes = 0, timeoutMs = 15 * 60 * 1000, intervalMs = 1500, onFound, onTimeout }) {
  const started = Date.now();
  const seen = new Set();
  try { for (const f of fs.readdirSync(folder)) seen.add(f); } catch { /* folder missing */ }
  const matches = size => !sizeBytes || Math.abs(size - sizeBytes) <= Math.max(4096, sizeBytes * 0.02);

  const scan = () => {
    let names = [];
    try { names = fs.readdirSync(folder); } catch { return; }
    for (const name of names) {
      // Browsers download to .crdownload / .part and rename when finished, so a .zip is complete.
      if (seen.has(name) || !/\.zip$/i.test(name)) continue;
      const full = path.join(folder, name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      seen.add(name);
      if (st.mtimeMs < started - 5000 || !matches(st.size)) continue;
      stop();
      onFound(full);
      return;
    }
  };
  const timer = setInterval(scan, intervalMs);
  const timeout = setTimeout(() => { stop(); onTimeout?.(); }, timeoutMs);
  function stop() { clearInterval(timer); clearTimeout(timeout); }
  return stop;
}

module.exports = { watchForZip };
