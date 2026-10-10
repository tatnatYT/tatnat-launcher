const $ = id => document.getElementById(id);
const api = window.launcher;

const LOADER_SUFFIX = { fabric: ' · Fabric', boost: ' · FPS Boost', forge: ' · Forge', neoforge: ' · NeoForge' };
const TYPE_LABEL = { release: 'Release', snapshot: 'Snapshot', old_beta: 'Beta', old_alpha: 'Alpha', custom: 'Installed' };

let settings = {};
let versionData = { latest: {}, versions: [] };
let accountData = { active: null, accounts: [] };
let state = 'idle';
let instances = []; // every game that is starting or running (several can run at once)
// Update checks for Mods > Installed (per version / modpack).
const upd = { found: { mod: {}, pack: {}, shader: {} }, checkedFor: null, checking: false, busy: new Set() };
let loginDismissed = false;

// Electron wraps errors from the main process; show only the useful part.
const cleanError = err => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// Lists are rebuilt whenever something changes (e.g. a button turns into "Installed ✓").
// Keep the reader's scroll position and don't replay the entrance animation for those
// refreshes; a list that only held a message (new search, first load) still animates in.
function resetList(list) {
  const top = list.scrollTop;
  const refresh = !!list.querySelector('.mod-card, .pack-card, .account-row, .boost-row');
  list.replaceChildren();
  if (refresh) list.dataset.quiet = '1';
  requestAnimationFrame(() => {
    list.scrollTop = top;
    delete list.dataset.quiet;
  });
}

// ---------- tabs ----------
function showTab(name) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === `tab-${name}`));
  moveIndicator();
  if (name === 'console') $('logDot').hidden = true;
  if (name === 'mods') refreshMods();
  if (name === 'packs') refreshPacks();
  if (name === 'shaders') refreshShaders();
  if (name === 'modpacks') loadModpacks();
  if (name === 'skins') window.onSkinsTab?.();
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

// Ctrl+1..8 jumps between menu items.
document.addEventListener('keydown', e => {
  if (!e.ctrlKey || e.altKey || e.shiftKey) return;
  const btn = document.querySelector(`.nav-btn[data-key="${e.key}"]`);
  if (btn) { e.preventDefault(); showTab(btn.dataset.tab); }
});

// The little status card above the account.
let progressStage = '';
function updateStatus() {
  const card = $('statusCard');
  const pack = activePack();
  const label = pack ? `${pack.name} · Minecraft ${pack.mcVersion}` : `Minecraft ${$('version').value || '…'}${LOADER_SUFFIX[settings.loader] || ''}`;
  card.classList.remove('ready', 'busy', 'running');
  if (state === 'installing') {
    card.classList.add('busy');
    $('statusTitle').textContent = 'Getting ready…';
    $('statusSub').textContent = progressStage || label;
  } else if (state === 'running') {
    card.classList.add('running');
    const n = instances.filter(i => i.state === 'running').length;
    $('statusTitle').textContent = n > 1 ? `Playing · ${n} games open` : 'Playing';
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
// Flappy tatnat files scores under the account you play with.
window.flappyPlayerName = () => activeAccount()?.name || 'Player';
// ... and uses that account's own head as the bird.
window.flappySkinUrl = () => activeAccount()?.skinUrl || 'https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb';

function renderAccounts() {
  const active = activeAccount();
  paintHead($('cardHead'), active);
  $('cardName').textContent = active ? active.name : 'Not signed in';
  $('cardType').textContent = active ? (active.type === 'microsoft' ? 'Microsoft account' : 'Offline account') : 'Sign in to play';

  const list = $('accountList');
  resetList(list);
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
  const pack = activePack();
  if (pack) {
    $('heroVersion').textContent = pack.name;
    $('heroSub').textContent = `Modpack · Fabric · Minecraft ${pack.mcVersion} · ${pack.modCount} mod${pack.modCount === 1 ? '' : 's'}`;
    return;
  }
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
  targetChanged(); // mods and texture packs are per version
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
// Several games can run at once; the Play button is about the selected version / modpack only.
const keyFor = (version, loader, packId) => (packId ? `pack:${packId}` : `${loader}:${version}`);
const currentKey = () => keyFor($('version').value, settings.loader, activePack()?.id || null);
const instanceFor = key => instances.find(i => i.key === key) || null;

function updatePlayButton() {
  const btn = $('play');
  const mine = instanceFor(currentKey());
  btn.classList.toggle('running', mine?.state === 'running');
  btn.textContent = mine?.state === 'installing' ? 'LOADING…' : mine?.state === 'running' ? 'STOP' : 'PLAY';
  btn.disabled = mine?.state === 'installing';
}

api.onInstances(list => {
  instances = list;
  updatePlayButton();
  updateStatus();
  renderModpacks();
});

$('play').addEventListener('click', async () => {
  const mine = instanceFor(currentKey());
  if (mine?.state === 'running') { api.kill(mine.key); return; }
  if (!activeAccount()) { loginDismissed = false; renderAccounts(); return; }
  const version = $('version').value;
  if (!version && !activePack()) return;
  $('toast').hidden = true;
  try {
    await api.launch({ version, loader: settings.loader, packId: activePack()?.id || null, memoryMb: settings.memoryMb });
  } catch (err) {
    toast(cleanError(err));
    appendLog(`\n[Eclipse Client] Launch failed: ${cleanError(err)}\n`);
  }
});

api.onState(s => {
  state = s;
  document.body.dataset.game = s;
  $('progressWrap').hidden = s !== 'installing';
  if (s !== 'installing') progressStage = '';
  updatePlayButton();
  updateStatus();
  if (s === 'idle') loadModpacks();
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

// ---------- target: a modpack, or a version + loader ----------
let modpackList = [];
const activePack = () => modpackList.find(p => p.id === settings.activePack) || null;
const fmt = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

// Where mods and texture packs go right now - also what Play launches.
function target() {
  const pack = activePack();
  return pack ? { packId: pack.id } : { version: $('version').value, loader: settings.loader };
}
const targetKey = () => JSON.stringify(target());
const mcVersion = () => activePack()?.mcVersion || $('version').value;
const LOADER_NAME = { vanilla: 'Vanilla', fabric: 'Fabric', boost: 'FPS Boost', forge: 'Forge', neoforge: 'NeoForge' };
function targetLabel() {
  const pack = activePack();
  return pack ? `Modpack “${pack.name}” · Minecraft ${pack.mcVersion}` : `${LOADER_NAME[settings.loader]} · Minecraft ${mcVersion()}`;
}
const modsAllowed = () => !!activePack() || settings.loader !== 'vanilla';
// True when the Mods tab is editing the FPS Boost setup (so changes join the player's boost pack).
const editingBoost = () => !activePack() && settings.loader === 'boost';

// Anything that changes the target reloads the lists that depend on it.
function targetChanged() {
  mods.loadedFor = null;
  packs.loadedFor = null;
  shaderState.loadedFor = null;
  renderPackChip();
  updateHero();
  updatePlayButton();
  $('fabricBanner').hidden = modsAllowed();
  if ($('tab-mods').classList.contains('active')) refreshMods();
  if ($('tab-packs').classList.contains('active')) refreshPacks();
  if ($('tab-shaders').classList.contains('active')) refreshShaders();
  // Updates are per version: forget the last check, then check again once everything is listed.
  upd.found = { mod: {}, pack: {}, shader: {} };
  upd.checkedFor = null;
  const loads = [loadInstalledMods(), loadInstalledPacks()]; // keeps the menu badges in step
  if (shadersSupported()) loads.push(loadInstalledShaders()); else { shaderState.installed = []; renderInstalledExtras(); }
  Promise.allSettled(loads).then(() => checkUpdates());
}

// ---------- loader ----------
function renderLoader() {
  document.querySelectorAll('#loader button').forEach(b => b.classList.toggle('on', b.dataset.loader === settings.loader));
}

function setLoader(loader) {
  settings.loader = loader;
  api.setSettings({ loader });
  renderLoader();
  targetChanged();
}
document.querySelectorAll('#loader button').forEach(b => b.addEventListener('click', () => setLoader(b.dataset.loader)));
$('useFabric').addEventListener('click', () => setLoader('fabric'));

// ---------- shared list pieces ----------
function modIcon(src) {
  const img = document.createElement('img');
  img.className = 'mod-icon';
  img.alt = '';
  if (src) img.src = src; else img.style.visibility = 'hidden';
  img.onerror = () => { img.style.visibility = 'hidden'; };
  return img;
}

// kind: 'mod' | 'resourcepack' | 'modpack' (for the Modrinth link); slug null = not on Modrinth.
function modBody(title, slug, meta, desc, stats, kind = 'mod') {
  const body = document.createElement('div');
  body.className = 'mod-body';
  const head = document.createElement('div');
  head.className = 'mod-title';
  const link = document.createElement('button');
  link.textContent = title;
  if (slug) {
    link.title = 'Open on Modrinth';
    link.addEventListener('click', () => api.openExternal(`https://modrinth.com/${kind}/${slug}`));
  } else {
    link.disabled = true;
  }
  const by = document.createElement('span');
  by.textContent = meta;
  head.append(link, by);
  body.append(head);
  if (desc) { const p = document.createElement('p'); p.className = 'mod-desc'; p.textContent = desc; body.append(p); }
  if (stats) { const s = document.createElement('div'); s.className = 'mod-stats'; s.textContent = stats; body.append(s); }
  return body;
}

function actionButton(state, onClick, labels = {}) {
  const btn = document.createElement('button');
  btn.className = 'install-btn';
  if (state === 'busy') { btn.textContent = labels.busy || 'Installing…'; btn.classList.add('busy'); btn.disabled = true; }
  else if (state === 'done') { btn.textContent = labels.done || 'Installed ✓'; btn.classList.add('done'); btn.disabled = true; }
  else { btn.textContent = labels.idle || 'Install'; btn.addEventListener('click', onClick); }
  return btn;
}

function listMessage(text) {
  const p = document.createElement('p');
  p.className = 'list-msg';
  p.textContent = text;
  return p;
}

function loadMoreButton(onClick) {
  const more = document.createElement('button');
  more.className = 'ghost-btn more-btn';
  more.textContent = 'Load more';
  more.addEventListener('click', onClick);
  return more;
}

function iconButton(title, svgPath, onClick, danger = false) {
  const b = document.createElement('button');
  b.className = `ghost-btn icon-btn${danger ? ' danger' : ''}`;
  b.title = title;
  b.innerHTML = `<svg viewBox="0 0 24 24"><path d="${svgPath}"/></svg>`;
  b.addEventListener('click', onClick);
  return b;
}

function setBadge(id, n) {
  $(id).textContent = n;
  $(id).hidden = !n;
}

function wireSegmented(groupId, views) {
  document.querySelectorAll(`#${groupId} button`).forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll(`#${groupId} button`).forEach(x => x.classList.toggle('on', x === b));
    for (const [view, el] of Object.entries(views)) $(el).hidden = b.dataset.view !== view;
  }));
}

function debounceInput(inputId, onSearch) {
  let timer;
  $(inputId).addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => onSearch($(inputId).value.trim()), 350);
  });
}

// ---------- mods ----------
const mods = { query: '', offset: 0, total: 0, results: [], installed: new Map(), busy: new Set(), loading: false, loadedFor: null };

function renderModResults() {
  const list = $('modResults');
  resetList(list);
  if (!mods.results.length) {
    list.append(listMessage(mods.loading ? 'Searching…' : `No Fabric mods found for Minecraft ${mcVersion()}.`));
    return;
  }
  for (const m of mods.results) {
    const card = document.createElement('div');
    card.className = 'mod-card';
    const state = mods.busy.has(m.id) ? 'busy' : mods.installed.has(m.id) ? 'done' : 'idle';
    card.append(modIcon(m.icon), modBody(m.title, m.slug, `by ${m.author}`, m.description, `${fmt(m.downloads)} downloads`),
      actionButton(state, () => installMod(m.id)));
    list.append(card);
  }
  if (mods.results.length < mods.total) list.append(loadMoreButton(() => searchMods(true)));
}

function renderInstalledMods() {
  const list = $('installedList');
  resetList(list);
  $('installedCount').textContent = mods.installed.size ? `(${mods.installed.size})` : '';
  setBadge('modsBadge', mods.installed.size);
  if (!mods.installed.size) { list.append(listMessage(`No mods here yet. Install some, or add your own .jar files.`)); return; }
  for (const [id, m] of mods.installed) {
    const card = document.createElement('div');
    card.className = `mod-card${m.enabled ? '' : ' disabled'}`;
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'switch';
    toggle.checked = m.enabled;
    toggle.title = m.enabled ? 'Enabled' : 'Disabled';
    toggle.addEventListener('change', async () => {
      await api.toggleMod({ target: target(), projectId: id, enabled: toggle.checked });
      await loadInstalledMods();
    });
    const remove = document.createElement('button');
    remove.className = 'remove-btn';
    remove.title = 'Remove mod';
    remove.textContent = '✕';
    remove.addEventListener('click', async () => {
      await api.removeMod({ target: target(), projectId: id });
      if (editingBoost()) { await api.removeBoostMod({ id, slug: m.slug }); renderBoostPack(); }
      await loadInstalledMods();
    });
    const meta = [m.versionNumber, m.local ? 'added by you' : m.dependency ? 'dependency' : ''].filter(Boolean).join(' · ');
    card.append(modIcon(m.icon), modBody(m.title, m.local ? null : (m.slug || id), meta, null, m.filename), ...rowActions('mod', { ...m, id }), toggle, remove);
    list.append(card);
  }
  updateUpdatesBar();
}

// ---------- updates (Mods > Installed lists mods, texture packs and shaders together) ----------

const ICON_UPDATE = '<svg viewBox="0 0 24 24"><path d="M12 3.5v10.5"/><path d="M7.5 9.5L12 14l4.5-4.5"/><path d="M4 14.5V18a2.5 2.5 0 002.5 2.5h11A2.5 2.5 0 0020 18v-3.5"/></svg>';
const ICON_SWAP = '<svg viewBox="0 0 24 24"><path d="M20 8H5"/><path d="M8.5 4.5L5 8l3.5 3.5"/><path d="M4 16h15"/><path d="M15.5 12.5L19 16l-3.5 3.5"/></svg>';

// Can this row switch versions? Only things that came from Modrinth through the launcher.
const versioned = item => item.id && !item.local && !String(item.id).startsWith('pmc:') && !String(item.id).startsWith('file:');

// The small buttons on an installed row: the green update arrow (only when a newer version is
// out) and the version switcher.
function rowActions(kind, item) {
  const out = [];
  if (!versioned(item)) return out;
  const key = `${kind}:${item.id}`;
  const busy = upd.busy.has(key);
  const next = upd.found[kind][item.id];
  if (next) {
    const b = document.createElement('button');
    b.className = 'row-icon update';
    b.innerHTML = ICON_UPDATE;
    b.title = busy ? 'Updating…' : `Update to ${next.versionNumber} (you have ${item.versionNumber || 'an older version'})`;
    b.disabled = busy;
    b.addEventListener('click', () => runUpdates([{ kind, item }]));
    out.push(b);
  }
  const v = document.createElement('button');
  v.className = 'row-icon swap';
  v.innerHTML = ICON_SWAP;
  v.title = 'Change version';
  v.disabled = busy;
  v.addEventListener('click', e => { e.stopPropagation(); openVersionPicker(v, kind, item); });
  out.push(v);
  return out;
}

// ---------- version picker ----------
let picker = null;
function closeVersionPicker() {
  if (picker) picker.remove();
  picker = null;
}
document.addEventListener('mousedown', e => { if (picker && !picker.contains(e.target)) closeVersionPicker(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeVersionPicker(); });

const TYPE_TAG = { release: 'Release', beta: 'Beta', alpha: 'Alpha' };
async function openVersionPicker(anchor, kind, item) {
  closeVersionPicker();
  const box = document.createElement('div');
  box.className = 'version-picker';
  const head = document.createElement('div');
  head.className = 'vp-head';
  head.innerHTML = '<strong></strong><span></span>';
  head.querySelector('strong').textContent = item.title;
  head.querySelector('span').textContent = `Installed: ${item.versionNumber || 'unknown'}`;
  const list = document.createElement('div');
  list.className = 'vp-list';
  list.append(listMessage('Loading versions…'));
  box.append(head, list);
  document.body.append(box);
  picker = box;
  // Under the button, kept on screen.
  const r = anchor.getBoundingClientRect();
  const w = 400;
  box.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
  const below = r.bottom + 6, room = window.innerHeight - below - 8;
  if (room >= 220) { box.style.top = `${below}px`; box.style.maxHeight = `${Math.min(380, room)}px`; }
  else { box.style.bottom = `${window.innerHeight - r.top + 6}px`; box.style.maxHeight = `${Math.min(380, r.top - 14)}px`; }

  let versions;
  try {
    versions = await api.projectVersions({ target: target(), kind, projectId: item.id });
  } catch (err) {
    if (picker === box) list.replaceChildren(listMessage(`Could not load versions: ${cleanError(err)}`));
    return;
  }
  if (picker !== box) return;
  list.replaceChildren();
  if (!versions.length) { list.append(listMessage('No other versions for this Minecraft version.')); return; }
  for (const v of versions) {
    const mine = v.id === item.versionId || (!item.versionId && v.number === item.versionNumber);
    const row = document.createElement('button');
    row.className = `vp-row${mine ? ' mine' : ''}`;
    row.disabled = mine;
    row.innerHTML = '<span class="vp-num"></span><span class="vp-tag"></span><span class="vp-date"></span>';
    row.querySelector('.vp-num').textContent = v.number;
    row.querySelector('.vp-tag').textContent = mine ? 'Installed' : TYPE_TAG[v.type] || v.type;
    row.querySelector('.vp-tag').dataset.type = mine ? 'mine' : v.type;
    row.querySelector('.vp-date').textContent = new Date(v.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    row.title = v.name && v.name !== v.number ? v.name : v.gameVersions.slice(-3).join(', ');
    row.addEventListener('click', () => { closeVersionPicker(); switchVersion(kind, item, v); });
    list.append(row);
  }
}

// Installs one exact version in place of the current one, keeping it on or off as it was.
async function switchVersion(kind, item, v) {
  const key = `${kind}:${item.id}`;
  upd.busy.add(key);
  renderAllInstalled();
  try {
    if (kind === 'mod') {
      await api.installMod({ target: target(), projectId: item.id, versionId: v.id });
      if (item.enabled === false) await api.toggleMod({ target: target(), projectId: item.id, enabled: false });
    } else if (kind === 'shader') {
      await api.updateShader({ target: target(), projectId: item.id, versionId: v.id });
    } else {
      await api.installPack({ target: target(), projectId: item.id, versionId: v.id });
      if (!item.enabled) {
        const now = (await api.listPacks({ target: target() })).find(p => p.id === item.id);
        if (now) await api.togglePack({ target: target(), name: now.name, enabled: false });
      }
    }
    toast(`${item.title} is now on ${v.number}.`);
  } catch (err) {
    toast(`Could not switch ${item.title}: ${cleanError(err)}`);
  } finally {
    upd.busy.delete(key);
  }
  await Promise.all([loadInstalledMods(), loadInstalledPacks(), shadersSupported() ? loadInstalledShaders() : null]);
  checkUpdates(true); // an older version now has an update again, a newer one doesn't
}


async function runUpdates(list) {
  for (const { kind, item } of list) upd.busy.add(`${kind}:${item.id}`);
  renderAllInstalled();
  const failed = [];
  for (const { kind, item } of list) {
    try {
      if (kind === 'mod') {
        await api.installMod({ target: target(), projectId: item.id });
        if (item.enabled === false) await api.toggleMod({ target: target(), projectId: item.id, enabled: false });
      }
      else if (kind === 'shader') await api.updateShader({ target: target(), projectId: item.id });
      else {
        await api.installPack({ target: target(), projectId: item.id });
        // Installing switches a pack on; keep it off if it was off.
        if (!item.enabled) {
          const now = (await api.listPacks({ target: target() })).find(p => p.id === item.id);
          if (now) await api.togglePack({ target: target(), name: now.name, enabled: false });
        }
      }
      delete upd.found[kind][item.id];
    } catch (err) {
      failed.push(`${item.title}: ${cleanError(err)}`);
    } finally {
      upd.busy.delete(`${kind}:${item.id}`);
    }
  }
  await Promise.all([loadInstalledMods(), loadInstalledPacks(), loadInstalledShaders()]);
  toast(failed.length ? `Some updates failed. ${failed.join(' · ')}` : `Updated ${list.length} item${list.length === 1 ? '' : 's'}.`);
}

async function checkUpdates(force = false) {
  const key = targetKey();
  if (upd.checking || (!force && upd.checkedFor === key)) return;
  upd.checking = true;
  upd.checkedFor = key;
  updateUpdatesBar();
  const pick = arr => arr.filter(x => x.id && !x.local).map(x => ({ id: x.id, versionId: x.versionId || null, versionNumber: x.versionNumber || '' }));
  try {
    const [mod, pack, shader] = await Promise.all([
      modsAllowed() ? api.checkUpdates({ target: target(), kind: 'mod', items: pick([...mods.installed].map(([id, m]) => ({ ...m, id }))) }) : {},
      api.checkUpdates({ target: target(), kind: 'pack', items: pick(packs.installed.filter(p => !p.id?.startsWith('pmc:'))) }),
      shadersSupported() ? api.checkUpdates({ target: target(), kind: 'shader', items: pick(shaderState.installed) }) : {},
    ]);
    if (upd.checkedFor === key) { upd.found = { mod, pack, shader }; upd.fingerprint = installedFingerprint(); }
  } catch (err) {
    toast(`Could not check for updates: ${cleanError(err)}`);
  } finally {
    upd.checking = false;
  }
  renderAllInstalled();
}

// What is installed (project + version) right now; a change means the last check is stale.
function installedFingerprint() {
  const all = [...[...mods.installed].map(([id, m]) => `m:${id}@${m.versionId || m.versionNumber}`),
    ...packs.installed.map(p => `p:${p.id}@${p.versionId || p.versionNumber}`),
    ...shaderState.installed.map(p => `s:${p.id}@${p.versionId || p.versionNumber}`)];
  return all.sort().join('|');
}

// Called whenever a list reloads: installing, removing or switching anything re-checks for updates.
let recheckTimer;
function maybeRecheck() {
  clearTimeout(recheckTimer);
  recheckTimer = setTimeout(() => {
    if (upd.checking || upd.checkedFor !== targetKey()) return;
    if (installedFingerprint() !== upd.fingerprint) checkUpdates(true);
  }, 900);
}

function pendingUpdates() {
  const out = [];
  for (const [id, m] of mods.installed) if (upd.found.mod[id]) out.push({ kind: 'mod', item: { ...m, id } });
  for (const p of packs.installed) if (upd.found.pack[p.id]) out.push({ kind: 'pack', item: p });
  for (const p of shaderState.installed) if (upd.found.shader[p.id]) out.push({ kind: 'shader', item: p });
  return out;
}

// Home tiles show what's installed; the menu gets a green dot where updates are waiting.
function renderUpdateMarks() {
  const pending = pendingUpdates();
  const count = kind => pending.filter(p => p.kind === kind).length;
  const tile = (id, total, label, kind) => {
    const n = count(kind);
    $(id).textContent = total ? `${total} ${label}${n ? ` · ${n} update${n === 1 ? '' : 's'}` : ''}` : 'None yet';
    $(id).classList.toggle('has-updates', !!n);
  };
  tile('tileMods', mods.installed.size, 'installed', 'mod');
  tile('tilePacks', packs.installed.length, 'installed', 'pack');
  tile('tileShaders', shaderState.installed.length, 'installed', 'shader');
  document.querySelector('.nav-btn[data-tab="mods"]').classList.toggle('has-updates', pending.length > 0);
  document.querySelector('.nav-btn[data-tab="packs"]').classList.toggle('has-updates', count('pack') > 0);
  document.querySelector('.nav-btn[data-tab="shaders"]').classList.toggle('has-updates', count('shader') > 0);
}

function updateUpdatesBar() {
  renderUpdateMarks();
  const n = pendingUpdates().length;
  $('checkUpdates').disabled = upd.checking;
  $('checkUpdates').textContent = upd.checking ? 'Checking…' : 'Check for updates';
  $('updateAll').hidden = !n;
  $('updateAll').textContent = `Update all (${n})`;
  $('updatesInfo').textContent = upd.checking ? 'Looking for newer versions on Modrinth…'
    : n ? `${n} update${n === 1 ? '' : 's'} available.`
    : upd.checkedFor === targetKey() ? 'Everything is up to date.'
    : 'Everything installed for this version: mods, texture packs and shaders.';
}

// The texture pack and shader sections of Mods > Installed.
function renderInstalledExtras() {
  const pl = $('installedPacksList');
  resetList(pl);
  $('installedPacksCount').textContent = packs.installed.length ? `(${packs.installed.length})` : '';
  if (!packs.installed.length) pl.append(listMessage('No texture packs for this version.'));
  for (const p of packs.installed) pl.append(packCard(p));
  const sl = $('installedShadersList');
  resetList(sl);
  $('installedShadersCount').textContent = shaderState.installed.length ? `(${shaderState.installed.length})` : '';
  if (!shadersSupported()) sl.append(listMessage('Shaders need a mod loader (Fabric, FPS Boost, NeoForge or Forge).'));
  else if (!shaderState.installed.length) sl.append(listMessage('No shaders for this version.'));
  for (const p of shaderState.installed) sl.append(shaderCard(p));
  updateUpdatesBar();
}

function renderAllInstalled() {
  renderInstalledMods();
  renderInstalledPacks();
  renderInstalledShaders();
}

$('checkUpdates').addEventListener('click', () => checkUpdates(true));
setInterval(() => checkUpdates(true), 30 * 60 * 1000);
$('updateAll').addEventListener('click', () => runUpdates(pendingUpdates()));
// Opening Installed loads everything for this version and checks for updates once.
document.querySelector('#modsView [data-view="installed"]').addEventListener('click', async () => {
  await Promise.all([loadInstalledPacks(), shadersSupported() ? loadInstalledShaders() : null]);
  checkUpdates();
});

async function loadInstalledMods() {
  if (!modsAllowed()) { mods.installed = new Map(); renderInstalledMods(); renderModResults(); return; }
  const list = await api.listMods({ target: target() });
  mods.installed = new Map(list.map(m => [m.id, m]));
  renderInstalledMods();
  renderModResults();
  maybeRecheck();
}

let modSeq = 0;
async function searchMods(append = false) {
  const seq = ++modSeq;
  if (!append) { mods.offset = 0; mods.results = []; mods.loading = true; renderModResults(); }
  try {
    const res = await api.searchMods({ query: mods.query, mcVersion: mcVersion(), offset: mods.offset, loader: activePack() ? 'fabric' : settings.loader });
    if (seq !== modSeq) return; // a newer search started meanwhile
    mods.total = res.total;
    mods.results = append ? [...mods.results, ...res.hits] : res.hits;
    mods.offset = mods.results.length;
  } catch (err) {
    if (seq === modSeq) toast(`Modrinth: ${cleanError(err)}`);
  } finally {
    if (seq === modSeq) { mods.loading = false; renderModResults(); }
  }
}

async function installMod(id) {
  if (!modsAllowed()) { toast('Pick Fabric, FPS Boost or a modpack first - vanilla Minecraft cannot load mods.'); return; }
  mods.busy.add(id);
  renderModResults();
  try {
    const names = await api.installMod({ target: target(), projectId: id });
    if (names.length > 1) appendLog(`[Eclipse Client] Installed ${names.join(', ')}\n`);
    if (editingBoost()) {
      const m = mods.results.find(r => r.id === id);
      if (m) { await api.addBoostMod(m); toast(`${m.title} added to your FPS Boost pack - it installs on every version.`); renderBoostPack(); }
    }
  } catch (err) {
    toast(cleanError(err));
  } finally {
    mods.busy.delete(id);
    await loadInstalledMods();
  }
}

async function addModFiles(files) {
  if (!modsAllowed()) { toast('Pick Fabric, FPS Boost or a modpack first - vanilla Minecraft cannot load mods.'); return; }
  try {
    const added = await api.addMods({ target: target(), files });
    if (added.length) toast(`Added ${added.length} mod${added.length === 1 ? '' : 's'}: ${added.join(', ')}`);
    else if (files) toast('Only .jar files can be added as mods.');
  } catch (err) {
    toast(cleanError(err));
  }
  await loadInstalledMods();
}

function refreshMods() {
  $('modsTarget').textContent = targetLabel() + (editingBoost() ? ' · mods you add join your FPS Boost pack' : '');
  $('fabricBanner').hidden = modsAllowed();
  const key = targetKey();
  if (mods.loadedFor === key) return;
  mods.loadedFor = key;
  loadInstalledMods();
  searchMods();
}

debounceInput('modSearch', q => { mods.query = q; searchMods(); });
wireSegmented('modsView', { browse: 'modsBrowse', installed: 'modsInstalled' });
$('addModFiles').addEventListener('click', () => addModFiles(null));
$('openModsFolder').addEventListener('click', () => api.openModsFolder({ target: target() }));
api.onModStatus(s => appendLog(`[Eclipse Client] ${s}\n`));

// ---------- texture packs ----------
const packs = { source: 'modrinth', query: '', offset: 0, total: 0, cursor: null, results: [], installed: [], busy: new Set(), loading: false, loadedFor: null, pmcKey: false };
const shaderState = { query: '', offset: 0, total: 0, results: [], installed: [], busy: new Set(), loading: false, loadedFor: null };

function renderPackResults() {
  const list = $('packResults');
  resetList(list);
  if (!packs.results.length) {
    list.append(listMessage(packs.loading ? 'Searching…' : packs.source === 'packsmc' ? 'No PacksMC packs found.' : `No texture packs found for Minecraft ${mcVersion()}.`));
    return;
  }
  const have = new Set(packs.installed.map(p => p.id).filter(Boolean));
  const pmc = packs.source === 'packsmc';
  for (const p of packs.results) {
    const card = document.createElement('div');
    card.className = 'mod-card';
    const key = pmc ? `pmc:${p.id}` : p.id;
    const state = packs.busy.has(key) ? 'busy' : have.has(key) ? 'done' : 'idle';
    const stats = [p.resolution, p.versions?.length ? (p.versions.length > 1 ? `${p.versions[p.versions.length - 1]}–${p.versions[0]}` : p.versions[0]) : '',
      `${fmt(p.downloads)} downloads`].filter(Boolean).join(' · ');
    const body = modBody(p.title, pmc ? null : p.slug, p.author ? `by ${p.author}` : '', p.description, stats, 'resourcepack');
    if (pmc && p.webUrl) {
      const link = body.querySelector('.mod-title button');
      link.disabled = false;
      link.title = 'Open on PacksMC';
      link.addEventListener('click', () => api.openExternal(p.webUrl));
    }
    card.append(modIcon(p.icon), body, actionButton(state, () => (pmc ? installPacksMc(p) : installPack(p.id)),
      pmc ? { idle: 'Get on PacksMC', busy: 'Waiting for download…' } : {}));
    list.append(card);
  }
  const more = pmc ? !!packs.cursor : packs.results.length < packs.total;
  if (more) list.append(loadMoreButton(() => searchPacks(true)));
}

function renderInstalledPacks() {
  const list = $('packsList');
  resetList(list);
  $('packsCount').textContent = packs.installed.length ? `(${packs.installed.length})` : '';
  setBadge('packsBadge', packs.installed.filter(p => p.enabled).length);
  if (!packs.installed.length) { list.append(listMessage('No texture packs yet. Install one, or add your own .zip.')); return; }
  for (const p of packs.installed) list.append(packCard(p));
  renderInstalledExtras();
}

function packCard(p) {
  {
    const card = document.createElement('div');
    card.className = `mod-card${p.enabled ? '' : ' disabled'}`;
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'switch';
    toggle.checked = p.enabled;
    toggle.title = p.enabled ? 'On' : 'Off';
    toggle.addEventListener('change', async () => {
      await api.togglePack({ target: target(), name: p.name, enabled: toggle.checked });
      await loadInstalledPacks();
    });
    const remove = document.createElement('button');
    remove.className = 'remove-btn';
    remove.title = 'Remove texture pack';
    remove.textContent = '✕';
    remove.addEventListener('click', async () => {
      await api.removePack({ target: target(), name: p.name });
      await loadInstalledPacks();
    });
    const meta = [p.versionNumber, p.local ? 'added by you' : p.id?.startsWith('pmc:') ? 'from PacksMC' : 'from Modrinth'].filter(Boolean).join(' · ');
    card.append(modIcon(p.icon), modBody(p.title, null, meta, null, p.name), ...rowActions('pack', p), toggle, remove);
    return card;
  }
}

async function loadInstalledPacks() {
  packs.installed = await api.listPacks({ target: target() });
  renderInstalledPacks();
  renderPackResults();
  maybeRecheck();
}

let packSeq = 0;
async function searchPacks(append = false) {
  const seq = ++packSeq;
  if (!append) { packs.offset = 0; packs.results = []; packs.loading = true; renderPackResults(); }
  try {
    if (packs.source === 'packsmc') {
      if (!packs.pmcKey) { packs.loading = false; return; }
      const res = await api.packsmcSearch({ query: packs.query, cursor: append ? packs.cursor : null });
      if (seq !== packSeq) return;
      packs.cursor = res.nextCursor;
      packs.results = append ? [...packs.results, ...res.hits] : res.hits;
      return;
    }
    const res = await api.searchPacks({ query: packs.query, mcVersion: mcVersion(), offset: packs.offset });
    if (seq !== packSeq) return;
    packs.total = res.total;
    packs.results = append ? [...packs.results, ...res.hits] : res.hits;
    packs.offset = packs.results.length;
  } catch (err) {
    if (seq === packSeq) toast(`${packs.source === 'packsmc' ? 'PacksMC' : 'Modrinth'}: ${cleanError(err)}`);
  } finally {
    if (seq === packSeq) { packs.loading = false; renderPackResults(); }
  }
}

async function installPack(id) {
  packs.busy.add(id);
  renderPackResults();
  try {
    const title = await api.installPack({ target: target(), projectId: id });
    toast(`${title} installed and switched on.`);
  } catch (err) {
    toast(cleanError(err));
  } finally {
    packs.busy.delete(id);
    await loadInstalledPacks();
  }
}

// PacksMC only allows downloads on its own site: open the pack page, then the main process
// spots the zip in Downloads and adds it (packsmc:added below).
async function installPacksMc(p) {
  const key = `pmc:${p.id}`;
  packs.busy.add(key);
  renderPackResults();
  try {
    const { title } = await api.packsmcGet({ target: target(), id: p.id });
    toast(`Click Download on the PacksMC page - ${title} is added here automatically when it lands in Downloads.`);
  } catch (err) {
    packs.busy.delete(key);
    renderPackResults();
    toast(cleanError(err));
  }
}

api.onPacksmcAdded(async r => {
  packs.busy.delete(`pmc:${r.id}`);
  if (r.error) toast(r.error);
  else if (r.timedOut) toast(`Stopped waiting for ${r.title}. Downloaded it anyway? Drag the .zip onto the launcher.`);
  else toast(`${r.title} added from PacksMC and switched on.`);
  await loadInstalledPacks();
});

async function setPackSource(source) {
  packs.source = source;
  document.querySelectorAll('#packSource button').forEach(b => b.classList.toggle('on', b.dataset.source === source));
  $('packSearch').placeholder = source === 'packsmc' ? 'Search PacksMC texture packs…' : 'Search Modrinth texture packs…';
  if (source === 'packsmc') packs.pmcKey = await api.packsmcHasKey();
  const needsKey = source === 'packsmc' && !packs.pmcKey;
  $('pmcSetup').hidden = !needsKey;
  $('packsBrowse').classList.toggle('needs-key', needsKey);
  $('pmcChangeKey').hidden = !(source === 'packsmc' && packs.pmcKey);
  packs.results = [];
  searchPacks();
}
document.querySelectorAll('#packSource button').forEach(b => b.addEventListener('click', () => setPackSource(b.dataset.source)));
$('pmcChangeKey').addEventListener('click', () => {
  packs.pmcKey = false;
  $('pmcSetup').hidden = false;
  $('packsBrowse').classList.add('needs-key');
  $('pmcKey').focus();
});
$('pmcForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('pmcSave').disabled = true;
  $('pmcSave').textContent = 'Checking…';
  try {
    const who = await api.packsmcSetKey($('pmcKey').value);
    $('pmcKey').value = '';
    toast(who ? `Connected to PacksMC${who.username ? ` as ${who.username}` : ''}.` : 'PacksMC key removed.');
    await setPackSource('packsmc');
  } catch (err) {
    toast(cleanError(err));
  } finally {
    $('pmcSave').disabled = false;
    $('pmcSave').textContent = 'Connect';
  }
});

async function addPackFiles(files) {
  try {
    const added = await api.addPacks({ target: target(), files });
    if (added.length) toast(`Added and switched on: ${added.join(', ')}`);
    else if (files) toast('Texture packs are .zip files.');
  } catch (err) {
    toast(cleanError(err));
  }
  await loadInstalledPacks();
}

// ---------- shaders ----------
const shadersSupported = () => !!activePack() || settings.loader !== 'vanilla';

function renderShaderResults() {
  const list = $('shaderResults');
  resetList(list);
  if (!shaderState.results.length) {
    list.append(listMessage(shaderState.loading ? 'Searching…' : 'No shaders found.'));
    return;
  }
  const have = new Set(shaderState.installed.map(p => p.id).filter(Boolean));
  for (const p of shaderState.results) {
    const card = document.createElement('div');
    card.className = 'mod-card';
    const state = shaderState.busy.has(p.id) ? 'busy' : have.has(p.id) ? 'done' : 'idle';
    const body = modBody(p.title, p.slug, p.author ? `by ${p.author}` : '', p.description, `${fmt(p.downloads)} downloads`, 'shader');
    card.append(modIcon(p.icon), body, actionButton(state, () => installShader(p.id)));
    list.append(card);
  }
  if (shaderState.results.length < shaderState.total) list.append(loadMoreButton(() => searchShaders(true)));
}

function renderInstalledShaders() {
  const list = $('shadersList');
  resetList(list);
  $('shadersCount').textContent = shaderState.installed.length ? `(${shaderState.installed.length})` : '';
  setBadge('shadersBadge', shaderState.installed.some(p => p.enabled) ? 1 : 0);
  if (!shaderState.installed.length) { list.append(listMessage('No shaders yet. Install one, or add your own .zip.')); return; }
  for (const p of shaderState.installed) list.append(shaderCard(p));
  renderInstalledExtras();
}

function shaderCard(p) {
  {
    const card = document.createElement('div');
    card.className = `mod-card${p.enabled ? '' : ' disabled'}`;
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.className = 'switch';
    toggle.checked = p.enabled;
    toggle.title = p.enabled ? 'Active' : 'Use this shader';
    toggle.addEventListener('change', async () => {
      // Only one shader can be active: switching one on switches the others off.
      await api.setShader({ target: target(), name: toggle.checked ? p.name : null });
      await loadInstalledShaders();
    });
    const remove = document.createElement('button');
    remove.className = 'remove-btn';
    remove.title = 'Remove shader';
    remove.textContent = '✕';
    remove.addEventListener('click', async () => {
      await api.removeShader({ target: target(), name: p.name });
      await loadInstalledShaders();
    });
    const meta = [p.versionNumber, p.local ? 'added by you' : 'from Modrinth', p.enabled ? 'active' : ''].filter(Boolean).join(' · ');
    card.append(modIcon(p.icon), modBody(p.title, null, meta, null, p.name), ...rowActions('shader', p), toggle, remove);
    return card;
  }
}

async function loadInstalledShaders() {
  try {
    shaderState.installed = await api.listShaders({ target: target() });
  } catch {
    shaderState.installed = [];
  }
  renderInstalledShaders();
  renderShaderResults();
  maybeRecheck();
}

let shaderSeq = 0;
async function searchShaders(append = false) {
  const seq = ++shaderSeq;
  if (!append) { shaderState.offset = 0; shaderState.results = []; shaderState.loading = true; renderShaderResults(); }
  try {
    const res = await api.searchShaders({ query: shaderState.query, offset: shaderState.offset });
    if (seq !== shaderSeq) return;
    shaderState.total = res.total;
    shaderState.results = append ? [...shaderState.results, ...res.hits] : res.hits;
    shaderState.offset = shaderState.results.length;
  } catch (err) {
    if (seq === shaderSeq) toast(`Modrinth: ${cleanError(err)}`);
  } finally {
    if (seq === shaderSeq) { shaderState.loading = false; renderShaderResults(); }
  }
}

async function installShader(id) {
  if (!shadersSupported()) { toast('Shaders need a mod loader: pick Fabric, FPS Boost, NeoForge or Forge on the Play tab.'); return; }
  shaderState.busy.add(id);
  renderShaderResults();
  try {
    const title = await api.installShader({ target: target(), projectId: id });
    toast(`${title} installed and switched on.`);
  } catch (err) {
    toast(cleanError(err));
  } finally {
    shaderState.busy.delete(id);
    await loadInstalledShaders();
    loadInstalledMods(); // Iris / Sodium may have been added
  }
}

function refreshShaders() {
  $('shadersTarget').textContent = targetLabel();
  $('shadersHint').textContent = shadersSupported()
    ? (settings.loader === 'forge' && !activePack()
      ? 'Installing a shader also adds Oculus (and Embeddium) to this version, so it just works.'
      : 'Installing a shader also adds Iris (and Sodium) to this version, so it just works.')
    : 'Shaders need a mod loader: pick Fabric, FPS Boost, NeoForge or Forge on the Play tab.';
  const key = targetKey();
  if (shaderState.loadedFor === key) return;
  shaderState.loadedFor = key;
  loadInstalledShaders();
  if (!shaderState.results.length) searchShaders();
}

api.onShaderStatus(s => appendLog(`[Eclipse Client] ${s}\n`));
debounceInput('shaderSearch', q => { shaderState.query = q; searchShaders(); });
wireSegmented('shadersView', { browse: 'shadersBrowse', installed: 'shadersInstalled' });
$('addShaderFiles').addEventListener('click', async () => {
  if (!shadersSupported()) { toast('Shaders need a mod loader: pick Fabric, FPS Boost, NeoForge or Forge on the Play tab.'); return; }
  try {
    const added = await api.addShaders({ target: target() });
    if (added.length) toast(`${added.length === 1 ? added[0] : `${added.length} shaders`} added and switched on.`);
  } catch (err) {
    toast(cleanError(err));
  }
  await loadInstalledShaders();
});
$('openShadersFolder').addEventListener('click', () => api.openShadersFolder({ target: target() }));

function refreshPacks() {
  $('packsTarget').textContent = targetLabel();
  const key = targetKey();
  if (packs.loadedFor === key) return;
  packs.loadedFor = key;
  loadInstalledPacks();
  searchPacks();
}

debounceInput('packSearch', q => { packs.query = q; searchPacks(); });
wireSegmented('packsView', { browse: 'packsBrowse', installed: 'packsInstalled' });
$('addPackFiles').addEventListener('click', () => addPackFiles(null));
$('openPacksFolder').addEventListener('click', () => api.openPacksFolder({ target: target() }));

// ---------- modpacks ----------
const mp = { query: '', offset: 0, total: 0, results: [], busy: new Set(), loading: false, searched: false };

function packTile(pack, el = document.createElement('div')) {
  el.className = 'pack-tile';
  el.textContent = '';
  el.style.backgroundImage = '';
  if (pack.icon) { el.classList.add('img'); el.style.backgroundImage = `url("${pack.icon}")`; }
  else el.textContent = (pack.name.trim()[0] || '?').toUpperCase();
  return el;
}

function renderPackChip() {
  const pack = activePack();
  $('dock').classList.toggle('pack-mode', !!pack);
  if (!pack) return;
  packTile(pack, $('packChipTile'));
  $('packChipName').textContent = pack.name;
  $('packChipSub').textContent = `Fabric · Minecraft ${pack.mcVersion} · ${pack.modCount} mod${pack.modCount === 1 ? '' : 's'}`;
}

function setActivePack(id) {
  settings.activePack = id;
  api.setSettings({ activePack: id });
  targetChanged();
  renderModpacks();
}

const ICONS = {
  edit: 'M4 20h4L18.5 9.5a2.1 2.1 0 00-4-4L4 16v4zM13.5 6.5l4 4',
  export: 'M12 3v12M7 8l5-5 5 5M5 21h14',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
};

function renderModpacks() {
  const grid = $('modpackGrid');
  resetList(grid);
  setBadge('modpacksBadge', modpackList.length);
  for (const pack of modpackList) {
    const card = document.createElement('div');
    card.className = `pack-card${pack.id === settings.activePack ? ' active' : ''}`;
    const top = document.createElement('div');
    top.className = 'pack-card-top';
    const text = document.createElement('div');
    text.style.minWidth = '0';
    const h = document.createElement('h4');
    h.textContent = pack.name;
    const p = document.createElement('p');
    p.textContent = `Minecraft ${pack.mcVersion} · ${pack.modCount} mod${pack.modCount === 1 ? '' : 's'}`;
    text.append(h, p);
    if (pack.manual?.length) {
      const warn = document.createElement('span');
      warn.className = 'pack-warn';
      warn.textContent = `⚠ ${pack.manual.length} mod${pack.manual.length === 1 ? '' : 's'} to download by hand`;
      warn.addEventListener('click', () => showManual(pack));
      text.append(warn);
    }
    top.append(packTile(pack), text);

    const actions = document.createElement('div');
    actions.className = 'pack-card-actions';
    // What's happening with this pack right now: starting, running or nothing.
    const inst = instanceFor(keyFor(null, null, pack.id));
    if (inst) {
      card.classList.add(inst.state === 'running' ? 'is-running' : 'is-starting');
      const live = document.createElement('span');
      live.className = 'pack-live';
      live.textContent = inst.state === 'running' ? '● Running' : 'Starting…';
      text.append(live);
    }
    const play = document.createElement('button');
    play.className = `install-btn${inst?.state === 'running' ? ' stop' : ''}`;
    play.textContent = inst?.state === 'running' ? 'Stop' : inst ? 'Starting…' : 'Play';
    play.disabled = inst?.state === 'installing';
    play.addEventListener('click', () => {
      if (inst?.state === 'running') { api.kill(inst.key); return; }
      setActivePack(pack.id);
      showTab('play');
      $('play').click();
    });
    actions.append(play,
      iconButton('Edit mods & texture packs', ICONS.edit, () => { setActivePack(pack.id); showTab('mods'); }),
      iconButton('Export as .mrpack', ICONS.export, () => exportModpack(pack)),
      iconButton('Open folder', ICONS.folder, () => api.openModpackFolder({ id: pack.id })),
      iconButton('Delete modpack', ICONS.trash, () => deleteModpack(pack), true));
    card.append(top, actions);
    grid.append(card);
  }
  const create = document.createElement('button');
  create.className = 'pack-card pack-new';
  create.innerHTML = '<span class="plus">+</span><span>New modpack</span>';
  create.addEventListener('click', openNewPack);
  grid.append(create);
}

async function loadModpacks() {
  modpackList = await api.listModpacks();
  if (settings.activePack && !activePack()) { settings.activePack = null; api.setSettings({ activePack: null }); targetChanged(); }
  renderModpacks();
  renderPackChip();
  updateHero();
}

async function exportModpack(pack) {
  try {
    const res = await api.exportModpack({ id: pack.id });
    if (res) toast(`Exported ${pack.name}: ${res.linked} mods linked to Modrinth, ${res.bundled} bundled.`);
  } catch (err) {
    toast(cleanError(err));
  }
}

async function deleteModpack(pack) {
  if (!confirm(`Delete "${pack.name}"? Its mods, settings and worlds are removed for good.`)) return;
  await api.deleteModpack({ id: pack.id });
  if (settings.activePack === pack.id) setActivePack(null);
  await loadModpacks();
}

async function importModpacks(files) {
  toast('Importing modpack…');
  try {
    const imported = await api.importModpacks({ files });
    if (!imported.length) { $('toast').hidden = true; return; }
    await afterImport(imported);
  } catch (err) {
    toast(cleanError(err));
  }
}

// Modrinth modpacks
function renderModpackResults() {
  const list = $('modpackResults');
  resetList(list);
  if (!mp.results.length) { list.append(listMessage(mp.loading ? 'Searching…' : 'No Fabric modpacks found.')); return; }
  for (const p of mp.results) {
    const card = document.createElement('div');
    card.className = 'mod-card';
    const owned = modpackList.some(x => x.source?.projectId === p.id);
    const state = mp.busy.has(p.id) ? 'busy' : owned ? 'done' : 'idle';
    card.append(modIcon(p.icon), modBody(p.title, p.slug, `by ${p.author}`, p.description, `${fmt(p.downloads)} downloads`, 'modpack'),
      actionButton(state, () => installModrinthPack(p), { done: 'Added ✓' }));
    list.append(card);
  }
  if (mp.results.length < mp.total) list.append(loadMoreButton(() => searchModpacks(true)));
}

let mpSeq = 0;
async function searchModpacks(append = false) {
  const seq = ++mpSeq;
  mp.searched = true;
  if (!append) { mp.offset = 0; mp.results = []; mp.loading = true; renderModpackResults(); }
  try {
    const res = await api.searchModpacks({ query: mp.query, offset: mp.offset });
    if (seq !== mpSeq) return;
    mp.total = res.total;
    mp.results = append ? [...mp.results, ...res.hits] : res.hits;
    mp.offset = mp.results.length;
  } catch (err) {
    if (seq === mpSeq) toast(`Modrinth: ${cleanError(err)}`);
  } finally {
    if (seq === mpSeq) { mp.loading = false; renderModpackResults(); }
  }
}

async function installModrinthPack(p) {
  mp.busy.add(p.id);
  renderModpackResults();
  try {
    const meta = await api.installModpack({ projectId: p.id });
    await loadModpacks();
    setActivePack(meta.id);
    toast(`${meta.name} is ready - press Play.`);
  } catch (err) {
    toast(cleanError(err));
  } finally {
    mp.busy.delete(p.id);
    renderModpackResults();
  }
}

debounceInput('modpackSearch', q => { mp.query = q; searchModpacks(); });
wireSegmented('modpacksView', { mine: 'modpacksMine', browse: 'modpacksBrowse' });
document.querySelector('#modpacksView [data-view="browse"]').addEventListener('click', () => { if (!mp.searched) searchModpacks(); });
$('importModpack').addEventListener('click', () => {
  $('importStatus').hidden = true;
  $('importLink').value = '';
  $('importModal').hidden = false;
});
$('importClose').addEventListener('click', () => { $('importModal').hidden = true; });
$('importFileBtn').addEventListener('click', async () => {
  $('importModal').hidden = true;
  await importModpacks(null);
});
$('importLinkForm').addEventListener('submit', async e => {
  e.preventDefault();
  const url = $('importLink').value.trim();
  if (!url) return;
  $('importLinkBtn').disabled = true;
  $('importStatus').hidden = false;
  $('importStatus').textContent = 'Importing…';
  try {
    const meta = await api.importModpackLink({ url });
    $('importModal').hidden = true;
    await afterImport([meta]);
  } catch (err) {
    $('importStatus').textContent = cleanError(err);
  } finally {
    $('importLinkBtn').disabled = false;
  }
});

function showManual(pack) {
  $('manualIntro').textContent = `${pack.name}: ${pack.manual.length} mod${pack.manual.length === 1 ? '' : 's'} couldn't be downloaded automatically` +
    (pack.manual.some(m => /^CurseForge project/.test(m.name)) ? ' (add a CurseForge API key in Settings to fetch them for you).' : ' (their authors only allow downloads on CurseForge).');
  const list = $('manualList');
  list.replaceChildren();
  for (const m of pack.manual) {
    const row = document.createElement('div');
    row.className = 'manual-row';
    const name = document.createElement('span');
    name.textContent = m.fileName ? `${m.name} - ${m.fileName}` : m.name;
    const open = document.createElement('button');
    open.className = 'ghost-btn';
    open.textContent = 'Open';
    open.addEventListener('click', () => api.openExternal(m.url));
    row.append(name, open);
    list.append(row);
  }
  $('manualModal').hidden = false;
}
$('manualClose').addEventListener('click', () => { $('manualModal').hidden = true; });

async function afterImport(imported) {
  await loadModpacks();
  const last = imported[imported.length - 1];
  setActivePack(last.id);
  toast(`Imported ${imported.map(p => p.name).join(', ')}.`);
  const withManual = imported.find(p => p.manual?.length);
  if (withManual) showManual(withManual);
}
$('newModpack').addEventListener('click', openNewPack);
$('editPack').addEventListener('click', () => showTab('mods'));
$('leavePack').addEventListener('click', () => setActivePack(null));
api.onModpackStatus(s => {
  if (!$('newPackModal').hidden) { $('newPackStatus').hidden = false; $('newPackStatus').textContent = s; }
  appendLog(`[Eclipse Client] ${s}\n`);
});

// New modpack dialog
function openNewPack() {
  const select = $('newPackVersion');
  select.replaceChildren();
  for (const v of versionData.versions.filter(v => v.type === 'release')) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.id === versionData.latest.release ? `${v.id} (latest)` : v.id;
    select.append(opt);
  }
  select.value = versionData.latest.release;
  $('newPackName').value = '';
  $('newPackStatus').hidden = true;
  $('newPackCreate').disabled = false;
  $('newPackModal').hidden = false;
  $('newPackName').focus();
}

$('newPackCancel').addEventListener('click', () => { $('newPackModal').hidden = true; });
$('newPackForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('newPackCreate').disabled = true;
  $('newPackStatus').hidden = false;
  $('newPackStatus').textContent = 'Setting up Fabric…';
  try {
    const meta = await api.createModpack({
      name: $('newPackName').value.trim() || 'My modpack',
      mcVersion: $('newPackVersion').value,
      boost: $('newPackBoost').checked,
    });
    $('newPackModal').hidden = true;
    await loadModpacks();
    setActivePack(meta.id);
    showTab('mods');
    toast(`${meta.name} created - add mods, then press Play.`);
  } catch (err) {
    $('newPackStatus').textContent = cleanError(err);
    $('newPackCreate').disabled = false;
  }
});

// ---------- drag & drop (mods, texture packs, modpacks) ----------
let dragDepth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dragging'); } });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const files = [...e.dataTransfer.files].map(f => api.pathForFile(f)).filter(Boolean);
  if (!files.length) return;
  const jars = files.filter(f => /\.jar$/i.test(f));
  const zips = files.filter(f => /\.zip$/i.test(f));
  const mrpacks = files.filter(f => /\.mrpack$/i.test(f));
  const pngs = files.filter(f => /\.png$/i.test(f));
  if (pngs.length) { showTab('skins'); window.importSkinFiles?.(pngs); }
  // Route by file type, whatever tab you're on. A .zip is a texture pack unless it's a CurseForge modpack export.
  api.classifyZips(zips).then(({ modpacks: cfPacks, packs: texturePackZips }) => {
    if (mrpacks.length || cfPacks.length) importModpacks([...mrpacks, ...cfPacks]);
    if (texturePackZips.length) { showTab('packs'); addPackFiles(texturePackZips); }
  });
  if (jars.length) { showTab('mods'); addModFiles(jars); }
  if (!jars.length && !zips.length && !mrpacks.length && !pngs.length) toast('Drop .jar mods, .zip texture packs, .mrpack modpacks or .png skins.');
});

// ---------- credits / external links ----------
document.querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', () => api.openExternal(b.dataset.link)));

// ---------- self-update ----------
let updateState = { state: 'idle' };
function renderUpdate(s) {
  updateState = s;
  const card = $('updateCard');
  card.classList.toggle('ready', s.state === 'ready');
  const show = ['downloading', 'ready', 'portable'].includes(s.state);
  card.hidden = !show;
  if (s.state === 'downloading') {
    $('updateTitle').textContent = `Updating to v${s.version || '…'}`;
    $('updateSub').textContent = `Downloading… ${s.percent || 0}%`;
    $('updateFill').style.width = `${s.percent || 0}%`;
  } else if (s.state === 'ready') {
    $('updateTitle').textContent = `v${s.version} is ready`;
    $('updateSub').textContent = 'Click to restart and update';
  } else if (s.state === 'portable') {
    $('updateTitle').textContent = `v${s.version} is out`;
    $('updateSub').textContent = 'Click to download it';
  }
  const text = {
    idle: 'Eclipse Client updates itself from GitHub.',
    dev: 'Updates are off while running from source.',
    checking: 'Checking for updates…',
    none: `You're on the newest version (v${s.current || ''}).`,
    downloading: `Downloading v${s.version || ''}… ${s.percent || 0}%`,
    ready: `v${s.version} downloaded - restart to finish (or it installs when you close the launcher).`,
    portable: `v${s.version} is available. The portable exe can't update itself - download the new one.`,
    error: `Couldn't check for updates: ${s.message || 'unknown error'}`,
  };
  $('updateSetting').textContent = text[s.state] || text.idle;
}

$('updateCard').addEventListener('click', async () => {
  if (updateState.state === 'portable') api.openExternal(updateState.url);
  else if (updateState.state === 'ready') {
    try { await api.installUpdate(); } catch (err) { toast(cleanError(err)); }
  }
});
$('checkAppUpdate').addEventListener('click', () => api.checkForUpdate());
api.onUpdate(renderUpdate);
api.updateStatus().then(renderUpdate);

// ---------- CurseForge key (Settings) ----------
async function renderCfKey() {
  const has = await api.curseforgeHasKey();
  $('cfKey').placeholder = has ? 'Key saved ✓ (paste to replace)' : 'Paste key';
}
$('cfKeyForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('cfKeySave').disabled = true;
  try {
    const saved = await api.curseforgeSetKey($('cfKey').value);
    $('cfKey').value = '';
    toast(saved ? 'CurseForge key saved - CurseForge modpacks now download their mods.' : 'CurseForge key removed.');
    renderCfKey();
  } catch (err) {
    toast(cleanError(err));
  } finally {
    $('cfKeySave').disabled = false;
  }
});
renderCfKey();

// ---------- FPS Boost pack (Settings) ----------
async function renderBoostPack() {
  const { builtins, disabled, extra } = await api.getBoost();
  const list = $('boostPack');
  resetList(list);
  const off = new Set(disabled);
  const row = (icon, title, sub, control) => {
    const r = document.createElement('div');
    r.className = 'boost-row';
    const text = document.createElement('div');
    text.className = 'boost-text';
    const t = document.createElement('strong');
    t.textContent = title;
    const d = document.createElement('span');
    d.textContent = sub;
    text.append(t, d);
    r.append(icon, text, control);
    list.append(r);
  };
  for (const m of builtins) {
    const sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.className = 'switch';
    sw.checked = !off.has(m.slug);
    sw.addEventListener('change', async () => { await api.setBoostBuiltin({ slug: m.slug, enabled: sw.checked }); mods.loadedFor = null; renderBoostPack(); });
    let tag;
    if (m.icon) {
      tag = modIcon(m.icon);
      tag.classList.add('small');
    } else {
      tag = document.createElement('span');
      tag.className = 'boost-tag';
      tag.textContent = m.title.charAt(0);
    }
    row(tag, m.title, m.what, sw);
  }
  for (const m of extra) {
    const x = document.createElement('button');
    x.className = 'remove-btn';
    x.title = 'Take out of the FPS Boost pack';
    x.textContent = '✕';
    x.addEventListener('click', async () => { await api.removeBoostMod({ id: m.id, slug: m.slug }); renderBoostPack(); });
    const img = modIcon(m.icon);
    img.classList.add('small');
    row(img, m.title, 'Added by you', x);
  }
  $('boostCount').textContent = `${builtins.length - off.size + extra.length} mods`;
}
$('boostAddMods').addEventListener('click', () => { setLoader('boost'); showTab('mods'); });

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

function renderClientMod() {
  $('clientModOn').checked = settings.clientMod !== false;
}

$('clientModOn').addEventListener('change', async () => {
  settings.clientMod = $('clientModOn').checked;
  await api.setSettings({ clientMod: settings.clientMod });
  toast(settings.clientMod ? 'Eclipse Client mod on: press Right Shift in game.' : 'Eclipse Client mod off: it is removed next time you play.');
});

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
  renderClientMod();
  renderBoostPack();
  moveIndicator();
  api.appVersion().then(v => { $('appVersion').textContent = `v${v}`; });
  await loadVersions();
  await loadModpacks();
  targetChanged();
  window.hideSplash?.();
})();
