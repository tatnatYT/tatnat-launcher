const { app, BrowserWindow, ipcMain, shell, safeStorage, session, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { launch, getManifest, offlineUuid } = require('./core/launch');
const { getLocalVersions, resolveVersion } = require('./core/versions');
const { installJava } = require('./core/install');
const forge = require('./core/forge');
const auth = require('./core/auth');
const { installFabric, loaderVersionOf } = require('./core/fabric');
const modrinth = require('./core/modrinth');
const texturePacks = require('./core/packs');
const packsmc = require('./core/packsmc');
const curseforge = require('./core/curseforge');
const { watchForZip } = require('./core/downloadwatch');
const modpacks = require('./core/modpacks');
const { DiscordPresence } = require('./core/discord');
const { BOOST_MODS, installBoostPack, writeBoostOptions } = require('./core/boost');
const clientMod = require('./core/clientmod');
const skins = require('./core/skins');
const { createUpdater } = require('./updater');

// Kept separate from the official launcher's .minecraft so the two never clash.
const ROOT = path.join(app.getPath('appData'), '.tatnatclient');
const OLD_ROOT = path.join(app.getPath('appData'), '.baselauncher'); // pre-rename data folder
const ICON = path.join(__dirname, '..', 'assets', 'icon.ico');
const SETTINGS_FILE = path.join(ROOT, 'launcher_settings.json');
const ACCOUNTS_FILE = path.join(ROOT, 'launcher_accounts.json');
const DEFAULT_SETTINGS = { version: null, versionTypes: ['release'], loader: 'vanilla', activePack: null, memoryMb: 4096, closeOnLaunch: false,
  discord: true, discordClientId: '', boostDisabled: [], boostExtra: [], clientMod: true };

let win;
let game = null;

// Every loader + version gets its own game folder, so mods for one never break another
// (and Fabric, Forge and NeoForge mods never mix).
const instanceDir = (mcVersion, loader = 'fabric') =>
  path.join(ROOT, 'instances', `${loader === 'forge' || loader === 'neoforge' ? loader : 'fabric'}-${mcVersion.replace(/[^\w.-]/g, '_')}`);

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
    width: 1080,
    height: 740,
    minWidth: 860,
    minHeight: 640,
    backgroundColor: '#14161a',
    title: 'tatnat launcher',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ---------- IPC ----------
ipcMain.handle('app:version', () => app.getVersion());

// ---------- self-update from GitHub Releases ----------
const updater = createUpdater({ logDir: path.join(ROOT, 'logs'), send: (ch, payload) => send(ch, payload) });
ipcMain.handle('update:status', () => updater.getState());
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:install', () => {
  if (game) throw new Error('Close Minecraft first - the update restarts the launcher.');
  updater.installNow();
});
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, settings) => {
  writeSettings({ ...readSettings(), ...settings });
  if ('discord' in settings || 'discordClientId' in settings) applyDiscordSettings();
});

ipcMain.handle('accounts:list', () => publicAccounts());

// ---------- skin changer ----------
// The active Microsoft account with a fresh token, or null for offline / no account.
async function skinAccount() {
  const store = readAccounts();
  let account = store.accounts.find(a => a.id === store.active);
  if (!account || account.type !== 'microsoft') return null;
  account = await auth.ensureFresh(account);
  saveAccount(account);
  return account;
}

const skinErr = err => { throw new Error(err instanceof skins.SkinError || err instanceof auth.AuthError ? err.message : `Skin change failed: ${err.message}`); };

ipcMain.handle('skins:state', async () => {
  const store = readAccounts();
  const active = store.accounts.find(a => a.id === store.active);
  const out = { account: active ? { type: active.type, name: active.name } : null, profile: null, profileError: null, library: skins.library(ROOT), defaults: [] };
  try { out.defaults = await skins.defaults(ROOT); } catch (err) { out.defaultsError = err.message; }
  try {
    const acc = await skinAccount();
    if (acc) out.profile = await skins.profile(acc.accessToken);
  } catch (err) { out.profileError = err.message; }
  return out;
});

// Applies a skin to the real account. source: {libraryId} | {defaultId} | {path} (+ variant).
ipcMain.handle('skins:apply', async (_e, { libraryId, defaultId, variant }) => {
  try {
    const acc = await skinAccount();
    if (!acc) throw new skins.SkinError('Changing your skin needs a Microsoft account (offline accounts have no skin).');
    const buf = libraryId ? skins.libraryBuffer(ROOT, libraryId) : skins.defaultBuffer(ROOT, defaultId);
    await skins.uploadSkin(acc.accessToken, buf, variant);
    const p = await skins.profile(acc.accessToken);
    // Keep the sidebar head in sync.
    if (p.skin?.url) {
      saveAccount({ ...acc, skinUrl: p.skin.url });
      send('accounts:changed', publicAccounts());
    }
    return p;
  } catch (err) { return skinErr(err); }
});

ipcMain.handle('skins:cape', async (_e, capeId) => {
  try {
    const acc = await skinAccount();
    if (!acc) throw new skins.SkinError('Capes need a Microsoft account.');
    await skins.setCape(acc.accessToken, capeId || null);
    return await skins.profile(acc.accessToken);
  } catch (err) { return skinErr(err); }
});

ipcMain.handle('skins:import', async (_e, { files, variant }) => {
  const added = [], errors = [];
  for (const f of files || []) {
    try {
      added.push(skins.addToLibrary(ROOT, fs.readFileSync(f), path.basename(f, path.extname(f)), variant));
    } catch (err) { errors.push(`${path.basename(f)}: ${err.message}`); }
  }
  return { added, errors };
});

ipcMain.handle('skins:pickFiles', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose skin files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Minecraft skin', extensions: ['png'] }] });
  return r.canceled ? [] : r.filePaths;
});

// Saves the currently worn skin (from Mojang) into the library.
ipcMain.handle('skins:saveCurrent', async () => {
  try {
    const acc = await skinAccount();
    if (!acc) throw new skins.SkinError('Sign in with Microsoft first.');
    const p = await skins.profile(acc.accessToken);
    if (!p.skin?.texture) throw new skins.SkinError('No skin to save.');
    const buf = Buffer.from(p.skin.texture.split(',')[1], 'base64');
    return skins.addToLibrary(ROOT, buf, `${p.name}'s skin`, p.skin.variant);
  } catch (err) { return skinErr(err); }
});

ipcMain.handle('skins:update', (_e, { id, changes }) => skins.updateLibrary(ROOT, id, changes));
ipcMain.handle('skins:remove', (_e, id) => skins.removeFromLibrary(ROOT, id));

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
const EXTERNAL_HOSTS = ['www.youtube.com', 'www.minecraft.net', 'fabricmc.net', 'modrinth.com', 'www.electronjs.org', 'discord.com', 'www.packsmc.com', 'packsmc.com', 'github.com', 'www.curseforge.com', 'curseforge.com', 'console.curseforge.com'];
ipcMain.handle('open:external', (_e, url) => {
  const u = new URL(url);
  if (u.protocol === 'https:' && EXTERNAL_HOSTS.includes(u.hostname)) return shell.openExternal(url);
});

ipcMain.handle('folder:open', () => {
  fs.mkdirSync(ROOT, { recursive: true });
  return shell.openPath(ROOT);
});

// ---------- where mods / texture packs go ----------
// The window describes the target as either { packId } (a modpack) or { version, loader }.
async function resolveTarget(t = {}) {
  if (t.packId) {
    const meta = await modpacks.readMeta(ROOT, t.packId);
    return { gameDir: modpacks.packDir(ROOT, meta.id), mcVersion: meta.mcVersion, fabric: true, pack: meta };
  }
  const fabric = t.loader === 'fabric' || t.loader === 'boost';
  const forgeLike = t.loader === 'forge' || t.loader === 'neoforge';
  return { gameDir: fabric || forgeLike ? instanceDir(t.version, t.loader) : ROOT, mcVersion: t.version, fabric, loader: t.loader, pack: null };
}

async function pickFiles(title, name, extensions) {
  const res = await dialog.showOpenDialog(win, { title, properties: ['openFile', 'multiSelections'], filters: [{ name, extensions }] });
  return res.canceled ? [] : res.filePaths;
}

function openSubfolder(dir, sub) {
  const full = path.join(dir, sub);
  fs.mkdirSync(full, { recursive: true });
  return shell.openPath(full);
}

// ---------- mods (Modrinth + your own jars, Fabric) ----------
ipcMain.handle('mods:search', (_e, { query, mcVersion, offset, loader }) =>
  modrinth.search({ query, mcVersion, offset, type: 'mod', loader: loader === 'forge' || loader === 'neoforge' ? loader : 'fabric' }));
ipcMain.handle('mods:list', async (_e, { target }) => modrinth.listInstalled((await resolveTarget(target)).gameDir));
ipcMain.handle('mods:install', async (_e, { target, projectId }) => {
  const t = await resolveTarget(target);
  const loader = t.loader === 'forge' || t.loader === 'neoforge' ? t.loader : 'fabric';
  return modrinth.install({ dir: t.gameDir, projectId, mcVersion: t.mcVersion, loader, onStatus: s => send('mods:status', s) });
});
ipcMain.handle('mods:remove', async (_e, { target, projectId }) => modrinth.remove({ dir: (await resolveTarget(target)).gameDir, projectId }));
ipcMain.handle('mods:toggle', async (_e, { target, projectId, enabled }) =>
  modrinth.setEnabled({ dir: (await resolveTarget(target)).gameDir, projectId, enabled }));
ipcMain.handle('mods:add', async (_e, { target, files }) => {
  const list = files?.length ? files : await pickFiles('Add mod files', 'Fabric mods', ['jar']);
  return modrinth.addLocalMods({ dir: (await resolveTarget(target)).gameDir, files: list });
});
ipcMain.handle('mods:openFolder', async (_e, { target }) => openSubfolder((await resolveTarget(target)).gameDir, 'mods'));

// ---------- texture packs ----------
ipcMain.handle('packs:search', (_e, { query, mcVersion, offset }) => modrinth.search({ query, mcVersion, offset, type: 'resourcepack' }));
ipcMain.handle('packs:list', async (_e, { target }) => texturePacks.list((await resolveTarget(target)).gameDir));
ipcMain.handle('packs:install', async (_e, { target, projectId }) => {
  const t = await resolveTarget(target);
  return texturePacks.install({ dir: t.gameDir, projectId, mcVersion: t.mcVersion });
});
ipcMain.handle('packs:remove', async (_e, { target, name }) => texturePacks.remove({ dir: (await resolveTarget(target)).gameDir, name }));
ipcMain.handle('packs:toggle', async (_e, { target, name, enabled }) =>
  texturePacks.setEnabled({ dir: (await resolveTarget(target)).gameDir, name, enabled }));
ipcMain.handle('packs:add', async (_e, { target, files }) => {
  const list = files?.length ? files : await pickFiles('Add texture packs', 'Texture packs', ['zip']);
  return texturePacks.addLocal({ dir: (await resolveTarget(target)).gameDir, files: list });
});
ipcMain.handle('packs:openFolder', async (_e, { target }) => openSubfolder((await resolveTarget(target)).gameDir, 'resourcepacks'));

// ---------- PacksMC (the player's own API key, encrypted like the account tokens) ----------
// API keys the player pastes in (PacksMC, CurseForge), encrypted like the account tokens.
const secretFile = name => path.join(ROOT, `${name}_key`);

function readSecret(name) {
  try {
    const raw = JSON.parse(fs.readFileSync(secretFile(name), 'utf8'));
    return raw.encrypted ? safeStorage.decryptString(Buffer.from(raw.data, 'base64')) : raw.data;
  } catch {
    return '';
  }
}

function writeSecret(name, value) {
  if (!value) { fs.rmSync(secretFile(name), { force: true }); return; }
  const encrypted = safeStorage.isEncryptionAvailable();
  const data = encrypted ? safeStorage.encryptString(value).toString('base64') : value;
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(secretFile(name), JSON.stringify({ encrypted, data }));
}
const readPacksMcKey = () => readSecret('packsmc');
const writePacksMcKey = key => writeSecret('packsmc', key);

ipcMain.handle('curseforge:hasKey', () => !!readSecret('curseforge'));
ipcMain.handle('curseforge:setKey', async (_e, key) => {
  key = String(key || '').trim();
  if (!key) { writeSecret('curseforge', ''); return false; }
  await curseforge.checkKey(key); // only store keys CurseForge accepts
  writeSecret('curseforge', key);
  return true;
});

// Dropped .zip files are either texture packs or CurseForge modpack exports.
ipcMain.handle('files:classifyZips', (_e, files) => {
  const out = { modpacks: [], packs: [] };
  for (const f of files) (curseforge.readManifest(f) ? out.modpacks : out.packs).push(f);
  return out;
});

ipcMain.handle('packsmc:hasKey', () => !!readPacksMcKey());
ipcMain.handle('packsmc:setKey', async (_e, key) => {
  key = String(key || '').trim();
  if (!key) { writePacksMcKey(''); return null; }
  const who = await packsmc.checkKey(key); // only store keys PacksMC accepts
  writePacksMcKey(key);
  return who;
});
ipcMain.handle('packsmc:search', (_e, { query, cursor }) => packsmc.search({ key: readPacksMcKey(), query, cursor }));
// PacksMC downloads must happen on their site. "Get" opens the pack page; the launcher then
// watches the Downloads folder and adds the zip once it arrives (matched by PacksMC's file size).
const pmcWatches = new Map(); // pack id -> stop()
const WATCH_FOR_MS = 15 * 60 * 1000;

function watchForPack({ id, pack, dir }) {
  pmcWatches.get(id)?.();
  const stop = watchForZip({
    folder: app.getPath('downloads'),
    sizeBytes: pack.sizeBytes,
    timeoutMs: WATCH_FOR_MS,
    onFound: async full => {
      pmcWatches.delete(id);
      try {
        const data = fs.readFileSync(full);
        if (data.subarray(0, 2).toString() !== 'PK') throw new Error(`${path.basename(full)} isn't a zip file.`);
        const title = await texturePacks.saveDownloaded({ dir, id: `pmc:${id}`, filename: path.basename(full), data, meta: pack });
        send('packsmc:added', { id, title, file: path.basename(full) });
      } catch (err) {
        send('packsmc:added', { id, error: err.message });
      }
    },
    onTimeout: () => { pmcWatches.delete(id); send('packsmc:added', { id, timedOut: true, title: pack.title }); },
  });
  pmcWatches.set(id, stop);
}

ipcMain.handle('packsmc:get', async (_e, { target, id }) => {
  const pack = await packsmc.packInfo({ key: readPacksMcKey(), id });
  const dir = (await resolveTarget(target)).gameDir;
  watchForPack({ id, pack, dir });
  await shell.openExternal(pack.pageUrl);
  return { title: pack.title };
});
ipcMain.handle('packsmc:cancel', (_e, { id }) => { pmcWatches.get(id)?.(); });

// ---------- the player's FPS Boost pack ----------
function boostPrefs() {
  const s = readSettings();
  return { disabled: s.boostDisabled, extra: s.boostExtra };
}

ipcMain.handle('boost:get', () => ({ builtins: BOOST_MODS, ...boostPrefs() }));
ipcMain.handle('boost:setBuiltin', (_e, { slug, enabled }) => {
  const s = readSettings();
  const off = new Set(s.boostDisabled);
  if (enabled) off.delete(slug); else off.add(slug);
  writeSettings({ ...s, boostDisabled: [...off] });
  return boostPrefs();
});
ipcMain.handle('boost:addExtra', (_e, mod) => {
  const s = readSettings();
  if (BOOST_MODS.some(m => m.slug === mod.slug)) {
    // A built-in the player switched off and is now adding back.
    writeSettings({ ...s, boostDisabled: s.boostDisabled.filter(x => x !== mod.slug) });
  } else if (!s.boostExtra.some(m => m.id === mod.id)) {
    writeSettings({ ...s, boostExtra: [...s.boostExtra, { id: mod.id, slug: mod.slug, title: mod.title, icon: mod.icon || null }] });
  }
  return boostPrefs();
});
// Removing a mod from the FPS Boost setup takes it out of the pack, so it isn't reinstalled next launch.
ipcMain.handle('boost:removeMod', (_e, { id, slug }) => {
  const s = readSettings();
  const builtin = BOOST_MODS.find(m => m.slug === slug || m.slug === id);
  writeSettings({
    ...s,
    boostExtra: s.boostExtra.filter(m => m.id !== id && (!slug || m.slug !== slug)),
    boostDisabled: builtin && !s.boostDisabled.includes(builtin.slug) ? [...s.boostDisabled, builtin.slug] : s.boostDisabled,
  });
  return boostPrefs();
});

// ---------- modpacks ----------
ipcMain.handle('modpacks:list', () => modpacks.list(ROOT));
ipcMain.handle('modpacks:search', (_e, { query, offset }) => modrinth.search({ query, offset, type: 'modpack' }));
ipcMain.handle('modpacks:create', async (_e, { name, mcVersion, boost }) => {
  const loaderVersion = loaderVersionOf(await installFabric(ROOT, mcVersion), mcVersion); // also checks Fabric support
  const meta = await modpacks.create(ROOT, { name, mcVersion, loaderVersion });
  if (boost) {
    const dir = modpacks.packDir(ROOT, meta.id);
    await installBoostPack({ dir, mcVersion, ...boostPrefs(), onStatus: s => send('modpacks:status', s) });
    await writeBoostOptions(dir);
  }
  return meta;
});
ipcMain.handle('modpacks:rename', (_e, { id, name }) => modpacks.update(ROOT, id, { name: String(name).trim().slice(0, 48) || 'My modpack' }));
ipcMain.handle('modpacks:delete', (_e, { id }) => modpacks.remove(ROOT, id));
ipcMain.handle('modpacks:openFolder', (_e, { id }) => shell.openPath(modpacks.packDir(ROOT, id)));
ipcMain.handle('modpacks:installModrinth', (_e, { projectId }) =>
  modpacks.installFromModrinth(ROOT, projectId, { onStatus: s => send('modpacks:status', s) }));
ipcMain.handle('modpacks:import', async (_e, { files } = {}) => {
  const list = files?.length ? files : await pickFiles('Import modpack', 'Modrinth (.mrpack) or CurseForge (.zip) modpacks', ['mrpack', 'zip']);
  const onStatus = s => send('modpacks:status', s);
  const imported = [];
  for (const f of list) {
    if (/\.mrpack$/i.test(f)) imported.push(await modpacks.importMrpack(ROOT, f, { onStatus }));
    else if (/\.zip$/i.test(f)) imported.push(await modpacks.importCurseForge(ROOT, f, { key: readSecret('curseforge'), onStatus }));
  }
  return imported;
});
ipcMain.handle('modpacks:importLink', (_e, { url }) =>
  modpacks.importLink(ROOT, url, { curseforgeKey: readSecret('curseforge'), onStatus: s => send('modpacks:status', s) }));
ipcMain.handle('modpacks:export', async (_e, { id }) => {
  const meta = await modpacks.readMeta(ROOT, id);
  const res = await dialog.showSaveDialog(win, {
    title: 'Export modpack',
    defaultPath: path.join(app.getPath('downloads'), `${meta.name.replace(/[^\w\- ]+/g, '').trim() || 'modpack'}.mrpack`),
    filters: [{ name: 'Modrinth modpack', extensions: ['mrpack'] }],
  });
  if (res.canceled || !res.filePath) return null;
  const loaderVersion = meta.loaderVersion || loaderVersionOf(await installFabric(ROOT, meta.mcVersion), meta.mcVersion);
  const result = await modpacks.exportPack(ROOT, id, res.filePath, { loaderVersion });
  shell.showItemInFolder(res.filePath);
  return { ...result, file: res.filePath };
});

ipcMain.handle('game:launch', async (_e, { version, loader = 'vanilla', packId = null, memoryMb }) => {
  if (game) throw new Error('Minecraft is already running');
  const store = readAccounts();
  let account = store.accounts.find(a => a.id === store.active);
  if (!account) throw new Error('Sign in first.');
  writeSettings({ ...readSettings(), version, loader, activePack: packId, memoryMb });

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
    let useFabric = !packId && (loader === 'fabric' || loader === 'boost');
    if (packId) {
      const meta = await modpacks.update(ROOT, packId, { lastPlayed: Date.now() });
      send('game:progress', { stage: `Preparing ${meta.name}`, done: 0, total: 1 });
      versionId = await installFabric(ROOT, meta.mcVersion, meta.loaderVersion);
      gameDir = modpacks.packDir(ROOT, meta.id);
      const modsFolder = path.join(gameDir, 'mods');
      Object.assign(playing, {
        version: meta.mcVersion, loader: 'modpack', packName: meta.name,
        modCount: fs.existsSync(modsFolder) ? fs.readdirSync(modsFolder).filter(f => f.endsWith('.jar')).length : 0,
      });
    }
    if (loader === 'boost' && !packId) {
      try {
        send('game:progress', { stage: 'Installing Fabric', done: 0, total: 1 });
        versionId = await installFabric(ROOT, version);
        gameDir = instanceDir(version);
        send('game:progress', { stage: 'Installing FPS Boost mods', done: 0, total: 1 });
        const res = await installBoostPack({ dir: gameDir, mcVersion: version, ...boostPrefs(), onStatus: s => send('game:log', `[tatnat launcher] ${s}\n`) });
        if (res.added.length) send('game:log', `[tatnat launcher] FPS Boost added: ${res.added.join(', ')}\n`);
        if (res.unavailable.length) send('game:log', `[tatnat launcher] Not available for ${version} yet: ${res.unavailable.join(', ')}\n`);
        if (await writeBoostOptions(gameDir)) send('game:log', '[tatnat launcher] Applied FPS-friendly video settings\n');
      } catch (err) {
        if (!/support/i.test(err.message)) throw err;
        // Fabric doesn't exist for very old versions: still launch, with the JVM tuning only.
        send('game:log', `[tatnat launcher] ${err.message} Launching vanilla with the optimised Java settings.\n`);
        useFabric = false;
        playing.loader = 'vanilla';
        versionId = version;
        gameDir = ROOT;
      }
    }
    if (!packId && (loader === 'forge' || loader === 'neoforge')) {
      const label = loader === 'forge' ? 'Forge' : 'NeoForge';
      send('game:progress', { stage: `Installing ${label}`, done: 0, total: 1 });
      // The installer needs Java: use the runtime this Minecraft version ships with.
      const vanilla = await resolveVersion(ROOT, version, await getManifest(ROOT));
      const javaBin = await installJava(ROOT, vanilla, (stage, done, total) => send('game:progress', { stage, done, total }));
      versionId = await forge.installLoader({
        root: ROOT, kind: loader, mcVersion: version, javaBin,
        onStatus: s => send('game:progress', { stage: s, done: 0, total: 1 }),
        onLog: text => send('game:log', text),
      });
      gameDir = instanceDir(version, loader);
      const modsFolder = path.join(gameDir, 'mods');
      playing.modCount = fs.existsSync(modsFolder) ? fs.readdirSync(modsFolder).filter(f => f.endsWith('.jar')).length : 0;
    }
    if (useFabric) {
      if (loader === 'fabric') {
        send('game:progress', { stage: 'Installing Fabric', done: 0, total: 1 });
        versionId = await installFabric(ROOT, version);
      }
      gameDir = instanceDir(version);
      const modsFolder = path.join(gameDir, 'mods');
      playing.modCount = fs.existsSync(modsFolder) ? fs.readdirSync(modsFolder).filter(f => f.endsWith('.jar')).length : 0;
    }
    if (gameDir !== ROOT) {
      // Fabric, FPS Boost or a modpack: add or remove the tatnat client mod to match the setting.
      try {
        const r = clientMod.sync({ gameDir, mcVersion: playing.version, loader: playing.loader, enabled: readSettings().clientMod !== false });
        if (r === 'added' || r === 'updated') send('game:log', '[tatnat launcher] tatnat client mod ready: press Right Shift in game\n');
        if (r === 'removed') send('game:log', '[tatnat launcher] tatnat client mod turned off, removed it\n');
      } catch (err) {
        send('game:log', `[tatnat launcher] Could not set up the tatnat client mod: ${err.message}\n`);
      }
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
    send('game:log', `\n[tatnat launcher] Minecraft exited with code ${code}\n`);
    setGameState('idle');
    if (win && !win.isDestroyed()) win.restore();
  });
});

ipcMain.handle('game:kill', () => { game?.kill(); });

// ---------- Discord Rich Presence ----------
// Pictures are Minecraft heads served by mc-heads.net, so the Discord app needs no uploaded art.
const LOGO_URL = 'https://mc-heads.net/avatar/5de9cae8516c461bb8051e7d52c00a26/256'; // tatnat
const TAB_STATUS = {
  play: 'Picking a version', modpacks: 'Building a modpack', mods: 'Browsing mods', packs: 'Picking texture packs', accounts: 'Managing accounts',
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
    assets: { large_image: LOGO_URL, large_text: 'tatnat launcher' },
    buttons: [{ label: 'tatnat on YouTube', url: 'https://www.youtube.com/@tatnatmc' }],
  };
  if (gameState === 'running' && playing) {
    activity.details = `Playing Minecraft ${playing.version}`;
    const mods = `${playing.modCount} mod${playing.modCount === 1 ? '' : 's'}`;
    activity.state = playing.loader === 'modpack' ? `${playing.packName} · ${mods}`
      : playing.loader === 'boost' ? `FPS Boost · ${mods}`
      : playing.loader === 'fabric' ? `Fabric · ${mods}`
      : playing.loader === 'forge' ? `Forge · ${mods}`
      : playing.loader === 'neoforge' ? `NeoForge · ${mods}`
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
  updater.start();
  applyDiscordSettings();
});
app.on('before-quit', () => presence.stop());
app.on('window-all-closed', () => app.quit());
