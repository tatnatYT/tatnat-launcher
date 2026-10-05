const $ = id => document.getElementById(id);
const api = window.launcher;

const LOADER_SUFFIX = { fabric: ' · Fabric', boost: ' · FPS Boost' };
const TYPE_LABEL = { release: 'Release', snapshot: 'Snapshot', old_beta: 'Beta', old_alpha: 'Alpha', custom: 'Installed' };

let settings = {};
let versionData = { latest: {}, versions: [] };
let accountData = { active: null, accounts: [] };
let state = 'idle';
let loginDismissed = false;

// Electron wraps errors from the main process; show only the useful part.
const cleanError = err => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// ---------- tabs ----------
function showTab(name) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${name}`));
  moveIndicator();
  if (name === 'console') $('logDot').hidden = true;
  if (name === 'mods') refreshMods();
  api.setPresenceView({ tab: name });
}
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// Slide the menu highlight onto the active item.
function moveIndicator() {
  const active = document.querySelector('.nav-btn.active');
  const ind = $('navIndicator');
  if (!active) { ind.style.height = '0'; return; }
  ind.style.transform = `translateY(${active.offsetTop}px)`;
  ind.style.height = `${active.offsetHeight}px`;
}
window.addEventListener('resize', moveIndicator);
document.fonts?.ready.then(moveIndicator);

// Ctrl+1..6 jumps between menu items.
document.addEventListener('keydown', e => {
  if (!e.ctrlKey || e.altKey || e.shiftKey) return;
  const btn = document.querySelector(`.nav-btn[data-key="${e.key}"]`);
  if (btn) { e.preventDefault(); showTab(btn.dataset.tab); }
});

// The little status card above the account.
let progressStage = '';
function updateStatus() {
  const card = $('statusCard');
  const label = `Minecraft ${$('version').value || '…'}${LOADER_SUFFIX[settings.loader] || ''}`;
  card.classList.remove('ready', 'busy', 'running');
  if (state === 'installing') {
    card.classList.add('busy');
    $('statusTitle').textContent = 'Getting ready…';
    $('statusSub').textContent = progressStage || label;
  } else if (state === 'running') {
    card.classList.add('running');
    $('statusTitle').textContent = 'Playing';
    $('statusSub').textContent = label;
  } else if (!activeAccount()) {
    $('statusTitle').textContent = 'Not signed in';
    $('statusSub').textContent = 'Add an account to play';
  } else {
    card.classList.add('ready');
    $('statusTitle').textContent = 'Ready to play';
    $('statusSub').textContent = label;
  }
  $('runDot').hidden = state !== 'running';
}

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 8000);
}

// ---------- accounts ----------
function headEl(account, cls = '') {
  const el = document.createElement('div');
  el.className = `head ${cls}`;
  paintHead(el, account);
  return el;
}

function paintHead(el, account) {
  el.classList.remove('skin', 'empty');
  if (!account) { el.classList.add('empty'); return; }
  // Offline accounts (and accounts without a skin) show the default Steve skin.
  const url = account.skinUrl || 'https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb';
  el.style.setProperty('--skin', `url("${url}")`);
  el.classList.add('skin');
}

function activeAccount() {
  return accountData.accounts.find(a => a.id === accountData.active) || null;
}

function renderAccounts() {
  const active = activeAccount();
  paintHead($('cardHead'), active);
  $('cardName').textContent = active ? active.name : 'Not signed in';
  $('cardType').textContent = active ? (active.type === 'microsoft' ? 'Microsoft account' : 'Offline account') : 'Sign in to play';

  const list = $('accountList');
  list.replaceChildren();
  if (!accountData.accounts.length) {
    const p = document.createElement('p');
    p.className = 'empty-accounts';
    p.textContent = 'No accounts yet.';
    list.append(p);
  }
  for (const acc of accountData.accounts) {
    const row = document.createElement('div');
    row.className = `account-row${acc.id === accountData.active ? ' active' : ''}`;
    const meta = document.createElement('div');
    meta.className = 'account-meta';
    meta.innerHTML = '<strong></strong><span></span>';
    meta.querySelector('strong').textContent = acc.name;
    meta.querySelector('span').textContent = acc.type === 'microsoft' ? 'Microsoft · online' : 'Offline';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = acc.id === accountData.active ? 'Playing as' : '';
    const remove = document.createElement('button');
    remove.className = 'remove-btn';
    remove.title = 'Remove account';
    remove.textContent = '✕';
    remove.addEventListener('click', async e => {
      e.stopPropagation();
      accountData = await api.removeAccount(acc.id);
      renderAccounts();
    });
    row.addEventListener('click', async () => {
      accountData = await api.selectAccount(acc.id);
      renderAccounts();
    });
    row.append(headEl(acc, 'lg'), meta, badge, remove);
    list.append(row);
  }

  $('login').hidden = accountData.accounts.length > 0 || loginDismissed;
  updatePlayButton();
  updateStatus();
}

async function microsoftLogin() {
  const buttons = document.querySelectorAll('[data-action="ms-login"]');
  buttons.forEach(b => { b.disabled = true; });
  $('loginError').hidden = true;
  try {
    accountData = await api.loginMicrosoft();
    renderAccounts();
  } catch (err) {
    const msg = cleanError(err);
    if (/cancelled/i.test(msg)) return; // the user closed the window themselves
    if (!$('login').hidden) { $('loginError').textContent = msg; $('loginError').hidden = false; }
    else toast(msg);
  } finally {
    buttons.forEach(b => { b.disabled = false; });
  }
}
document.querySelectorAll('[data-action="ms-login"]').forEach(b => b.addEventListener('click', microsoftLogin));

$('loginOffline').addEventListener('click', () => {
  loginDismissed = true;
  $('login').hidden = true;
  showTab('accounts');
  $('offlineName').focus();
});

$('offlineForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $('offlineName').value.trim();
  try {
    accountData = await api.addOffline(name);
    $('offlineName').value = '';
    renderAccounts();
  } catch (err) {
    toast(cleanError(err));
  }
});

api.onAccounts(a => { accountData = a; renderAccounts(); });

// ---------- versions ----------
function enabledTypes() {
  return new Set(settings.versionTypes || ['release']);
}

function renderChips() {
  const on = enabledTypes();
  document.querySelectorAll('#typeChips button').forEach(b => b.classList.toggle('on', on.has(b.dataset.type)));
}

document.querySelectorAll('#typeChips button').forEach(b => b.addEventListener('click', () => {
  const on = enabledTypes();
  if (on.has(b.dataset.type)) { if (on.size > 1) on.delete(b.dataset.type); } else on.add(b.dataset.type);
  settings.versionTypes = [...on];
  api.setSettings({ versionTypes: settings.versionTypes });
  renderChips();
  renderVersions();
}));

function renderVersions() {
  const on = enabledTypes();
  const select = $('version');
  const current = select.value || settings.version || versionData.latest.release;
  select.replaceChildren();
  const shown = versionData.versions.filter(v => v.type === 'custom' || on.has(v.type) || v.id === current);
  for (const v of shown) {
    const opt = document.createElement('option');
    opt.value = v.id;
    const tag = v.id === versionData.latest.release ? ' — latest release'
      : v.id === versionData.latest.snapshot ? ' — latest snapshot'
      : v.type !== 'release' ? ` — ${TYPE_LABEL[v.type] || v.type}` : '';
    opt.textContent = v.id + tag;
    select.append(opt);
  }
  select.value = shown.some(v => v.id === current) ? current : (shown[0]?.id || '');
  updateHero();
}

function updateHero() {
  updateStatus();
  const id = $('version').value;
  const v = versionData.versions.find(x => x.id === id);
  $('heroVersion').textContent = id ? `Minecraft ${id}` : 'Minecraft';
  if (!v) { $('heroSub').textContent = 'Pick a version and press play.'; return; }
  const label = id === versionData.latest.release ? 'Latest release'
    : id === versionData.latest.snapshot ? 'Latest snapshot'
    : TYPE_LABEL[v.type] || v.type;
  $('heroSub').textContent = `${label} · Java Edition${LOADER_SUFFIX[settings.loader] || ''}`;
}

$('version').addEventListener('change', () => {
  settings.version = $('version').value;
  api.setSettings({ version: settings.version });
  updateHero();
  mods.loadedFor = null; // mods are per Minecraft version
  loadInstalled(); // keeps the menu's mod count in step
});

async function loadVersions() {
  try {
    versionData = await api.listVersions();
    renderVersions();
  } catch (err) {
    toast(`Could not load versions: ${cleanError(err)}`);
  }
}

// ---------- play ----------
function updatePlayButton() {
  const btn = $('play');
  btn.classList.toggle('running', state === 'running');
  btn.textContent = state === 'installing' ? 'LOADING…' : state === 'running' ? 'STOP' : 'PLAY';
  btn.disabled = state === 'installing';
}

$('play').addEventListener('click', async () => {
  if (state === 'running') { api.kill(); return; }
  if (!activeAccount()) { loginDismissed = false; renderAccounts(); return; }
  const version = $('version').value;
  if (!version) return;
  $('toast').hidden = true;
  try {
    await api.launch({ version, loader: settings.loader, memoryMb: settings.memoryMb });
  } catch (err) {
    toast(cleanError(err));
    appendLog(`\n[TTT Client] Launch failed: ${cleanError(err)}\n`);
  }
});

api.onState(s => {
  state = s;
  document.body.dataset.game = s;
  $('progressWrap').hidden = s !== 'installing';
  if (s !== 'installing') progressStage = '';
  updatePlayButton();
  updateStatus();
});

api.onProgress(({ stage, done, total }) => {
  $('progressWrap').hidden = false;
  $('progressStage').textContent = stage;
  $('progressCount').textContent = total > 1 ? `${done} / ${total}` : '';
  $('progressFill').style.width = `${total ? (done / total) * 100 : 0}%`;
  if (stage !== progressStage) { progressStage = stage; updateStatus(); }
});

// ---------- console ----------
// The game logs log4j XML events; turn them into the familiar "[time] [thread/LEVEL]: msg" lines.
let logBuffer = '';
const MAX_LOG_CHARS = 400_000;

function appendLog(text) {
  const log = $('log');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
  log.append(text);
  if (log.textContent.length > MAX_LOG_CHARS) log.textContent = log.textContent.slice(-MAX_LOG_CHARS / 2);
  if (atBottom) log.scrollTop = log.scrollHeight;
  if (!$('tab-console').classList.contains('active')) $('logDot').hidden = false;
}

const cdata = (xml, tag) => {
  const m = xml.match(new RegExp(`<log4j:${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></log4j:${tag}>`));
  return m ? m[1] : '';
};

function formatEvent(xml) {
  const attr = name => (xml.match(new RegExp(`${name}="([^"]*)"`)) || [])[1] || '';
  const time = new Date(Number(attr('timestamp'))).toTimeString().slice(0, 8);
  const thrown = cdata(xml, 'Throwable');
  return `[${time}] [${attr('thread')}/${attr('level')}]: ${cdata(xml, 'Message')}\n${thrown ? thrown.trimEnd() + '\n' : ''}`;
}

api.onLog(chunk => {
  logBuffer += chunk;
  let out = '';
  for (;;) {
    const start = logBuffer.indexOf('<log4j:Event');
    if (start === -1) {
      // Plain text: flush complete lines, keep a possible partial tag for the next chunk.
      const cut = logBuffer.lastIndexOf('\n') + 1;
      out += logBuffer.slice(0, cut);
      logBuffer = logBuffer.slice(cut);
      break;
    }
    out += logBuffer.slice(0, start).replace(/^\s+$/, '');
    const end = logBuffer.indexOf('</log4j:Event>', start);
    if (end === -1) { logBuffer = logBuffer.slice(start); break; }
    out += formatEvent(logBuffer.slice(start, end));
    logBuffer = logBuffer.slice(end + '</log4j:Event>'.length).replace(/^\s*\n/, '');
  }
  if (out) appendLog(out);
});

$('clearLog').addEventListener('click', () => { $('log').textContent = ''; });

// ---------- settings ----------
function renderMemory() {
  $('memory').value = settings.memoryMb;
  $('memoryOut').textContent = `${(settings.memoryMb / 1024).toFixed(1)} GB`;
}
$('memory').addEventListener('input', () => {
  settings.memoryMb = Number($('memory').value);
  renderMemory();
});
$('memory').addEventListener('change', () => api.setSettings({ memoryMb: settings.memoryMb }));
$('closeOnLaunch').addEventListener('change', () => api.setSettings({ closeOnLaunch: $('closeOnLaunch').checked }));
$('openFolder').addEventListener('click', () => api.openFolder());

// ---------- loader ----------
function renderLoader() {
  document.querySelectorAll('#loader button').forEach(b => b.classList.toggle('on', b.dataset.loader === settings.loader));
  $('fabricBanner').hidden = settings.loader !== 'vanilla';
  updateHero();
}

function setLoader(loader) {
  settings.loader = loader;
  api.setSettings({ loader });
  renderLoader();
}
document.querySelectorAll('#loader button').forEach(b => b.addEventListener('click', () => setLoader(b.dataset.loader)));
$('useFabric').addEventListener('click', () => setLoader('fabric'));

// ---------- mods ----------
const mods = { query: '', offset: 0, total: 0, results: [], installed: new Map(), busy: new Set(), loading: false, loadedFor: null };
const fmt = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const mcVersion = () => $('version').value;

function modIcon(src) {
  const img = document.createElement('img');
  img.className = 'mod-icon';
  img.alt = '';
  if (src) img.src = src; else img.style.visibility = 'hidden';
  img.onerror = () => { img.style.visibility = 'hidden'; };
  return img;
}

function modBody(title, slugOrId, meta, desc, stats) {
  const body = document.createElement('div');
  body.className = 'mod-body';
  const head = document.createElement('div');
  head.className = 'mod-title';
  const link = document.createElement('button');
  link.textContent = title;
  link.title = 'Open on Modrinth';
  link.addEventListener('click', () => api.openExternal(`https://modrinth.com/mod/${slugOrId}`));
  const by = document.createElement('span');
  by.textContent = meta;
  head.append(link, by);
  body.append(head);
  if (desc) { const p = document.createElement('p'); p.className = 'mod-desc'; p.textContent = desc; body.append(p); }
  if (stats) { const s = document.createElement('div'); s.className = 'mod-stats'; s.textContent = stats; body.append(s); }
  return body;
}

function installButton(id) {
  const btn = document.createElement('button');
  btn.className = 'install-btn';
  if (mods.busy.has(id)) { btn.textContent = 'Installing…'; btn.classList.add('busy'); btn.disabled = true; }
  else if (mods.installed.has(id)) { btn.textContent = 'Installed ✓'; btn.classList.add('done'); btn.disabled = true; }
  else { btn.textContent = 'Install'; btn.addEventListener('click', () => installMod(id)); }
  return btn;
}

function listMessage(text) {
  const p = document.createElement('p');
  p.className = 'list-msg';
  p.textContent = text;
  return p;
}

function renderResults() {
  const list = $('modResults');
  list.replaceChildren();
  if (!mods.results.length) {
    list.append(listMessage(mods.loading ? 'Searching…' : `No Fabric mods found for Minecraft ${mcVersion()}.`));
    return;
  }
  for (const m of mods.results) {
    const card = document.createElement('div');
    card.className = 'mod-card';
    card.append(modIcon(m.icon), modBody(m.title, m.slug, `by ${m.author}`, m.description, `${fmt(m.downloads)} downloads`), installButton(m.id));
    list.append(card);
  }
  if (mods.results.length < mods.total) {
    const more = document.createElement('button');
    more.className = 'ghost-btn more-btn';
    more.textContent = 'Load more';
    more.addEventListener('click', () => searchMods(true));
    list.append(more);
  }
}

function renderInstalled() {
  const list = $('installedList');
  list.replaceChildren();
  $('installedCount').textContent = mods.installed.size ? `(${mods.installed.size})` : '';
  $('modsBadge').textContent = mods.installed.size;
  $('modsBadge').hidden = !mods.installed.size;
  if (!mods.installed.size) { list.append(listMessage(`No mods installed for Minecraft ${mcVersion()} yet.`)); return; }
  for (const [id, m] of mods.installed) {
    const card = document.createElement('div');
    card.className = `mod-card${m.enabled ? '' : ' disabled'}`;
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'switch';
    toggle.checked = m.enabled;
    toggle.title = m.enabled ? 'Enabled' : 'Disabled';
    toggle.addEventListener('change', async () => {
      await api.toggleMod({ mcVersion: mcVersion(), projectId: id, enabled: toggle.checked });
      await loadInstalled();
    });
    const remove = document.createElement('button');
    remove.className = 'remove-btn';
    remove.title = 'Remove mod';
    remove.textContent = '✕';
    remove.addEventListener('click', async () => {
      await api.removeMod({ mcVersion: mcVersion(), projectId: id });
      await loadInstalled();
    });
    const meta = `${m.versionNumber}${m.dependency ? ' · dependency' : ''}`;
    card.append(modIcon(m.icon), modBody(m.title, id, meta, null, m.filename), toggle, remove);
    list.append(card);
  }
}

async function loadInstalled() {
  const list = await api.listMods({ mcVersion: mcVersion() });
  mods.installed = new Map(list.map(m => [m.id, m]));
  renderInstalled();
  renderResults();
}

let searchSeq = 0;
async function searchMods(append = false) {
  const seq = ++searchSeq;
  if (!append) { mods.offset = 0; mods.results = []; mods.loading = true; renderResults(); }
  try {
    const res = await api.searchMods({ query: mods.query, mcVersion: mcVersion(), offset: mods.offset });
    if (seq !== searchSeq) return; // a newer search started meanwhile
    mods.total = res.total;
    mods.results = append ? [...mods.results, ...res.hits] : res.hits;
    mods.offset = mods.results.length;
  } catch (err) {
    if (seq === searchSeq) toast(`Modrinth: ${cleanError(err)}`);
  } finally {
    if (seq === searchSeq) { mods.loading = false; renderResults(); }
  }
}

async function installMod(id) {
  mods.busy.add(id);
  renderResults();
  try {
    const names = await api.installMod({ mcVersion: mcVersion(), projectId: id });
    if (names.length > 1) appendLog(`[TTT Client] Installed ${names.join(', ')}\n`);
  } catch (err) {
    toast(cleanError(err));
  } finally {
    mods.busy.delete(id);
    await loadInstalled();
  }
}

// Reload the Mods tab when it's shown for a different Minecraft version.
function refreshMods() {
  const v = mcVersion();
  $('modsTarget').textContent = `Fabric · Minecraft ${v}`;
  if (mods.loadedFor === v) return;
  mods.loadedFor = v;
  loadInstalled();
  searchMods();
}

let searchTimer;
$('modSearch').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { mods.query = $('modSearch').value.trim(); searchMods(); }, 350);
});

document.querySelectorAll('#modsView button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#modsView button').forEach(x => x.classList.toggle('on', x === b));
  $('modsBrowse').hidden = b.dataset.view !== 'browse';
  $('modsInstalled').hidden = b.dataset.view !== 'installed';
}));

$('openModsFolder').addEventListener('click', () => api.openModsFolder({ mcVersion: mcVersion() }));
api.onModStatus(s => appendLog(`[TTT Client] ${s}\n`));

// ---------- credits / external links ----------
document.querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', () => api.openExternal(b.dataset.link)));

// ---------- Discord ----------
const DISCORD_STATUS = {
  off: 'Off',
  'no-id': 'Needs an application ID',
  'bad-id': "Discord doesn't recognise this ID",
  waiting: 'Waiting for Discord…',
  connected: 'Connected to Discord',
};

async function renderDiscordStatus() {
  const status = await api.presenceStatus();
  $('discordStatus').className = `discord-status ${status}`;
  $('discordStatus').textContent = DISCORD_STATUS[status];
}

function renderDiscord() {
  $('discordOn').checked = settings.discord;
  $('discordId').value = settings.discordClientId;
  document.querySelector('.discord-setting').classList.toggle('off', !settings.discord);
  renderDiscordStatus();
}

$('discordOn').addEventListener('change', async () => {
  settings.discord = $('discordOn').checked;
  await api.setSettings({ discord: settings.discord });
  renderDiscord();
});

$('discordId').addEventListener('change', async () => {
  const id = $('discordId').value.trim();
  if (id && !/^\d{17,20}$/.test(id)) { toast('A Discord application ID is a long number, like 1234567890123456789.'); return; }
  settings.discordClientId = id;
  await api.setSettings({ discordClientId: id });
  renderDiscord();
});

// Connecting takes a moment (or Discord opens later), so keep the label fresh.
setInterval(() => { if ($('tab-settings').classList.contains('active')) renderDiscordStatus(); }, 2000);

// ---------- boot ----------
(async () => {
  [settings, accountData] = await Promise.all([api.getSettings(), api.listAccounts()]);
  renderMemory();
  renderChips();
  renderLoader();
  $('closeOnLaunch').checked = !!settings.closeOnLaunch;
  renderAccounts();
  renderDiscord();
  moveIndicator();
  api.appVersion().then(v => { $('appVersion').textContent = `v${v}`; });
  await loadVersions();
  loadInstalled();
})();
