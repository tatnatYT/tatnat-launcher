const { app, BrowserWindow, ipcMain, shell, safeStorage, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { launch, getManifest, offlineUuid } = require('./core/launch');
const { getLocalVersions } = require('./core/versions');
const auth = require('./core/auth');
const { installFabric } = require('./core/fabric');
const modrinth = require('./core/modrinth');
const { DiscordPresence } = require('./core/discord');

// Kept separate from the official launcher's .minecraft so the two never clash.
const ROOT = path.join(app.getPath('appData'), '.tatnatclient');
const OLD_ROOT = path.join(app.getPath('appData'), '.baselauncher'); // pre-rename data folder
const ICON = path.join(__dirname, '..', 'assets', 'icon.ico');
const SETTINGS_FILE = path.join(ROOT, 'launcher_settings.json');
const ACCOUNTS_FILE = path.join(ROOT, 'launcher_accounts.json');
const DEFAULT_SETTINGS = { version: null, versionTypes: ['release'], loader: 'vanilla', memoryMb: 4096, closeOnLaunch: false,
  discord: true, discordClientId: '' };

let win;
let game = null;

// Fabric versions each get their own game folder, so mods for one version never break another.
const instanceDir = mcVersion => path.join(ROOT, 'instances', `fabric-${mcVersion.replace(/[^\w.-]/g, '_')}`);

// Electron's own data (incl. the key that encrypts saved logins) lives inside our folder,
// so renaming the app can never orphan the accounts again.
const USER_DATA = path.join(ROOT, 'electron');

// Carry over downloads/accounts from before the launcher was renamed.
function migrateOldRoot() {
  if (!fs.existsSync(ROOT) && fs.existsSync(OLD_ROOT)) {
    try { fs.renameSync(OLD_ROOT, ROOT); } catch { /* in use (e.g. a game is running) - start fresh */ }
  }
  const oldKey = path.join(app.getPath('appData'), 'base-launcher', 'Local State');
  const newKey = path.join(USER_DATA, 'Local State');
  if (fs.existsSync(oldKey) && !fs.existsSync(newKey)) {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.copyFileSync(oldKey, newKey);
  }
}
migrateOldRoot();
app.setPath('userData', USER_DATA);

// ---------- settings ----------
function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

function writeSettings(settings) {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ---------- accounts (tokens encrypted with the OS keychain when available) ----------
function readAccounts() {
  try {
    const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    const json = raw.encrypted ? safeStorage.decryptString(Buffer.from(raw.data, 'base64')) : raw.data;
    return JSON.parse(json);
  } catch {
    return { active: null, accounts: [] };
  }
}

function writeAccounts(store) {
  fs.mkdirSync(ROOT, { recursive: true });
  const json = JSON.stringify(store);
  const encrypted = safeStorage.isEncryptionAvailable();
  const data = encrypted ? safeStorage.encryptString(json).toString('base64') : json;
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({ encrypted, data }));
}

// What the window gets to see: never tokens.
function publicAccounts() {
  const { active, accounts } = readAccounts();
  return {
    active,
    accounts: accounts.map(({ id, type, name, uuid, skinUrl }) => ({ id, type, name, uuid, skinUrl })),
  };
}

function saveAccount(account) {
  const store = readAccounts();
  const i = store.accounts.findIndex(a => a.id === account.id);
  if (i >= 0) store.accounts[i] = account; else store.accounts.push(account);
  store.active = account.id;
  writeAccounts(store);
}

// Opens Microsoft's sign-in page and resolves with the OAuth code from the redirect.
function microsoftLogin() {
  return new Promise((resolve, reject) => {
    const loginWin = new BrowserWindow({
      width: 520,
      height: 680,
      parent: win,
      modal: true,
      title: 'Sign in with Microsoft',
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      // A fresh in-memory session each time, so no Microsoft cookies are kept around.
      webPreferences: { session: session.fromPartition(`msa-${Date.now()}`) },
    });
    let settled = false;
    const finish = (err, code) => {
      if (settled) return;
      settled = true;
      if (!loginWin.isDestroyed()) loginWin.close();
      err ? reject(err) : resolve(code);
    };
    const check = url => {
      if (!url.startsWith(auth.REDIRECT_URI)) return;
      const params = new URL(url).searchParams;
      if (params.get('code')) finish(null, params.get('code'));
      else finish(new auth.AuthError(params.get('error_description') || 'Sign-in was cancelled'));
    };
    loginWin.webContents.on('will-redirect', (_e, url) => check(url));
    loginWin.webContents.on('will-navigate', (_e, url) => check(url));
    loginWin.webContents.on('did-navigate', (_e, url) => check(url));
    loginWin.on('closed', () => finish(new auth.AuthError('Sign-in was cancelled')));
    loginWin.loadURL(auth.AUTHORIZE_URL);
  });
}

// ---------- window ----------
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 660,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#14161a',
    title: 'TTT Client',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ---------- IPC ----------
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, settings) => {
  writeSettings({ ...readSettings(), ...settings });
  if ('discord' in settings || 'discordClientId' in settings) applyDiscordSettings();
});

ipcMain.handle('accounts:list', () => publicAccounts());

ipcMain.handle('accounts:loginMicrosoft', async () => {
  const code = await microsoftLogin();
  const account = await auth.loginWithCode(code);
  saveAccount({ id: `ms-${account.uuid}`, ...account });
  return publicAccounts();
});

ipcMain.handle('accounts:addOffline', (_e, name) => {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Names are 3–16 letters, numbers or underscores.');
  saveAccount({ id: `off-${name.toLowerCase()}`, type: 'offline', name, uuid: offlineUuid(name), skinUrl: null });
  return publicAccounts();
});

ipcMain.handle('accounts:select', (_e, id) => {
  const store = readAccounts();
  if (store.accounts.some(a => a.id === id)) { store.active = id; writeAccounts(store); }
  return publicAccounts();
});

ipcMain.handle('accounts:remove', (_e, id) => {
  const store = readAccounts();
  store.accounts = store.accounts.filter(a => a.id !== id);
  if (store.active === id) store.active = store.accounts[0]?.id || null;
  writeAccounts(store);
  return publicAccounts();
});

ipcMain.handle('versions:list', async () => {
  const manifest = await getManifest(ROOT);
  const local = await getLocalVersions(ROOT, manifest);
  return { latest: manifest.latest, versions: [...local, ...manifest.versions.map(v => ({ id: v.id, type: v.type }))] };
});

// Only ever open known sites in the user's browser.
const EXTERNAL_HOSTS = ['www.youtube.com', 'www.minecraft.net', 'fabricmc.net', 'modrinth.com', 'www.electronjs.org', 'discord.com'];
ipcMain.handle('open:external', (_e, url) => {
  const u = new URL(url);
  if (u.protocol === 'https:' && EXTERNAL_HOSTS.includes(u.hostname)) return shell.openExternal(url);
});

ipcMain.handle('folder:open', () => {
  fs.mkdirSync(ROOT, { recursive: true });
  return shell.openPath(ROOT);
});

// ---------- mods (Modrinth, Fabric) ----------
ipcMain.handle('mods:search', (_e, { query, mcVersion, offset }) => modrinth.search({ query, mcVersion, offset }));
ipcMain.handle('mods:list', (_e, { mcVersion }) => modrinth.listInstalled(instanceDir(mcVersion)));
ipcMain.handle('mods:install', (_e, { mcVersion, projectId }) =>
  modrinth.install({ dir: instanceDir(mcVersion), projectId, mcVersion, onStatus: s => send('mods:status', s) }));
ipcMain.handle('mods:remove', (_e, { mcVersion, projectId }) => modrinth.remove({ dir: instanceDir(mcVersion), projectId }));
ipcMain.handle('mods:toggle', (_e, { mcVersion, projectId, enabled }) =>
  modrinth.setEnabled({ dir: instanceDir(mcVersion), projectId, enabled }));
ipcMain.handle('mods:openFolder', (_e, { mcVersion }) => {
  const dir = path.join(instanceDir(mcVersion), 'mods');
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

ipcMain.handle('game:launch', async (_e, { version, loader = 'vanilla', memoryMb }) => {
  if (game) throw new Error('Minecraft is already running');
  const store = readAccounts();
  let account = store.accounts.find(a => a.id === store.active);
  if (!account) throw new Error('Sign in first.');
  writeSettings({ ...readSettings(), version, loader, memoryMb });

  playing = { version, loader, modCount: 0, name: account.name, uuid: account.type === 'microsoft' ? account.uuid : null, start: null };
  setGameState('installing');
  try {
    if (account.type === 'microsoft') {
      send('game:progress', { stage: 'Signing in', done: 0, total: 1 });
      try {
        account = await auth.ensureFresh(account);
      } catch (err) {
        throw new Error(err instanceof auth.AuthError ? err.message : 'Your session expired. Remove the account and sign in again.');
      }
      saveAccount(account);
      send('accounts:changed', publicAccounts()); // name or skin may have changed
    }
    let versionId = version;
    let gameDir = ROOT;
    if (loader === 'fabric') {
      send('game:progress', { stage: 'Installing Fabric', done: 0, total: 1 });
      versionId = await installFabric(ROOT, version);
      gameDir = instanceDir(version);
      const modsFolder = path.join(gameDir, 'mods');
      playing.modCount = fs.existsSync(modsFolder) ? fs.readdirSync(modsFolder).filter(f => f.endsWith('.jar')).length : 0;
    }
    game = await launch({
      root: ROOT,
      gameDir,
      versionId,
      account,
      memoryMb,
      onProgress: (stage, done, total) => send('game:progress', { stage, done, total }),
      onLog: text => send('game:log', text),
    });
  } catch (err) {
    setGameState('idle');
    throw err;
  }
  playing.start = Date.now();
  setGameState('running');
  if (readSettings().closeOnLaunch) win.minimize();
  game.on('exit', code => {
    game = null;
    send('game:log', `\n[TTT Client] Minecraft exited with code ${code}\n`);
    setGameState('idle');
    if (win && !win.isDestroyed()) win.restore();
  });
});

ipcMain.handle('game:kill', () => { game?.kill(); });

// ---------- Discord Rich Presence ----------
// Pictures are Minecraft heads served by mc-heads.net, so the Discord app needs no uploaded art.
const LOGO_URL = 'https://mc-heads.net/avatar/5de9cae8516c461bb8051e7d52c00a26/256'; // tatnat
const TAB_STATUS = {
  play: 'Picking a version', mods: 'Browsing mods', accounts: 'Managing accounts',
  console: 'Reading the console', settings: 'Tweaking settings', credits: 'Reading the credits',
};
const presence = new DiscordPresence();
let gameState = 'idle';
let playing = null;    // details of the launch in progress / running game
let launcherView = {}; // { tab } reported by the window

function setGameState(s) {
  gameState = s;
  send('game:state', s);
  updatePresence();
}

function buildActivity() {
  const activity = {
    assets: { large_image: LOGO_URL, large_text: 'TTT Client' },
    buttons: [{ label: 'tatnat on YouTube', url: 'https://www.youtube.com/@tatnatmc' }],
  };
  if (gameState === 'running' && playing) {
    activity.details = `Playing Minecraft ${playing.version}`;
    activity.state = playing.loader === 'fabric'
      ? `Fabric · ${playing.modCount} mod${playing.modCount === 1 ? '' : 's'}`
      : 'Vanilla';
    activity.timestamps = { start: playing.start };
    activity.assets.small_image = `https://mc-heads.net/avatar/${playing.uuid || encodeURIComponent(playing.name)}/64`;
    activity.assets.small_text = playing.name;
  } else if (gameState === 'installing' && playing) {
    activity.details = 'Getting ready to play';
    activity.state = `Minecraft ${playing.version}`;
  } else {
    activity.details = 'In the launcher';
    activity.state = TAB_STATUS[launcherView.tab] || 'Picking a version';
  }
  return activity;
}

function updatePresence() {
  presence.setActivity(buildActivity());
}

function applyDiscordSettings() {
  const s = readSettings();
  presence.configure(s.discord ? s.discordClientId.trim() : '');
  updatePresence();
}

ipcMain.handle('presence:status', () => {
  const s = readSettings();
  if (!s.discord) return 'off';
  if (!s.discordClientId.trim()) return 'no-id';
  if (presence.invalidId) return 'bad-id';
  return presence.ready ? 'connected' : 'waiting';
});

ipcMain.handle('presence:view', (_e, view) => {
  launcherView = view || {};
  updatePresence();
});

app.whenReady().then(() => {
  createWindow();
  applyDiscordSettings();
});
app.on('before-quit', () => presence.stop());
app.on('window-all-closed', () => app.quit());
