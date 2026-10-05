// Self-updating from GitHub Releases.
// - Installed copies (NSIS setup): electron-updater downloads new versions in the background;
//   the player can restart right away, otherwise it installs when the launcher closes.
// - The portable exe can't replace itself, so it only announces the new version with a download link.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const REPO = 'tatnatYT/tatnat-launcher';
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

function createUpdater({ logDir, send }) {
  let state = { state: 'idle', current: app.getVersion() };
  const set = patch => { state = { ...state, ...patch }; send('update:status', state); };

  const logFile = path.join(logDir, 'updater.log');
  const log = (level, ...args) => {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] [${level}] ${args.map(String).join(' ')}\n`);
    } catch { /* logging must never break updates */ }
  };
  const logger = { info: (...a) => log('info', ...a), warn: (...a) => log('warn', ...a), error: (...a) => log('error', ...a), debug: () => {} };

  const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;

  // ---------- portable: just tell the player ----------
  const newer = (a, b) => {
    const pa = a.split(/[.-]/).map(Number), pb = b.split(/[.-]/).map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
    return false;
  };
  async function checkPortable() {
    set({ state: 'checking' });
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { 'User-Agent': 'tatnat-launcher', Accept: 'application/vnd.github+json' } });
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
      const rel = await res.json();
      const version = String(rel.tag_name || '').replace(/^v/, '');
      logger.info('portable check: latest', version, 'current', app.getVersion());
      if (version && newer(version, app.getVersion())) set({ state: 'portable', version, url: rel.html_url });
      else set({ state: 'none' });
    } catch (err) {
      logger.error('portable check failed', err.message);
      set({ state: 'error', message: err.message });
    }
  }

  // ---------- installed: full auto-update ----------
  let autoUpdater = null;
  function setupInstalled() {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.logger = logger;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
    autoUpdater.on('update-not-available', () => set({ state: 'none' }));
    autoUpdater.on('update-available', info => set({ state: 'downloading', version: info.version, percent: 0 }));
    autoUpdater.on('download-progress', p => set({ state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', info => set({ state: 'ready', version: info.version }));
    autoUpdater.on('error', err => { logger.error(err?.message || err); set({ state: 'error', message: String(err?.message || err) }); });
  }

  async function check() {
    if (!app.isPackaged) { set({ state: 'dev' }); return state; }
    if (portable) { await checkPortable(); return state; }
    if (!autoUpdater) setupInstalled();
    if (state.state === 'downloading' || state.state === 'ready') return state;
    try { await autoUpdater.checkForUpdates(); } catch (err) { set({ state: 'error', message: err.message }); }
    return state;
  }

  function start() {
    setTimeout(check, 3000); // let the window open first
    setInterval(check, CHECK_EVERY_MS);
  }

  // Restarts into the new version. isSilent: no installer wizard; forceRunAfter: reopen the launcher.
  function installNow() {
    if (autoUpdater && state.state === 'ready') autoUpdater.quitAndInstall(true, true);
  }

  return { start, check, installNow, getState: () => state };
}

module.exports = { createUpdater, REPO };
