// Texture (resource) packs for a game folder: Modrinth installs, files added by hand,
// and switching packs on/off by editing the game's options.txt.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { api, pickVersion } = require('./modrinth');
const { downloadFile } = require('./download');
const { readPackMeta } = require('./filemeta');

const packsDir = dir => path.join(dir, 'resourcepacks');
const indexFile = dir => path.join(dir, 'resourcepacks.json');

async function readIndex(dir) {
  try { return JSON.parse(await fsp.readFile(indexFile(dir), 'utf8')); } catch { return {}; }
}
async function writeIndex(dir, index) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(indexFile(dir), JSON.stringify(index, null, 2));
}

// ---------- options.txt (resourcePacks / incompatibleResourcePacks lists) ----------
async function readOptions(dir) {
  try { return (await fsp.readFile(path.join(dir, 'options.txt'), 'utf8')).split(/\r?\n/); } catch { return []; }
}

function getList(lines, key) {
  const line = lines.find(l => l.startsWith(`${key}:`));
  if (!line) return null;
  try { return JSON.parse(line.slice(key.length + 1)); } catch { return null; }
}

function setList(lines, key, list) {
  const value = `${key}:${JSON.stringify(list)}`;
  const i = lines.findIndex(l => l.startsWith(`${key}:`));
  if (i >= 0) lines[i] = value; else lines.splice(lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length, 0, value);
}

async function enabledPacks(dir) {
  return getList(await readOptions(dir), 'resourcePacks') || [];
}

// The game applies the LAST pack in the list on top, so newly enabled packs go to the end.
// They're also marked as "incompatible but wanted", so a pack made for a slightly different
// version isn't silently dropped by the game.
async function setPackEnabled(dir, name, enabled) {
  const lines = await readOptions(dir);
  const id = `file/${name}`;
  const packs = (getList(lines, 'resourcePacks') || ['vanilla']).filter(p => p !== id);
  const incompatible = (getList(lines, 'incompatibleResourcePacks') || []).filter(p => p !== id);
  if (enabled) { packs.push(id); incompatible.push(id); }
  setList(lines, 'resourcePacks', packs);
  setList(lines, 'incompatibleResourcePacks', incompatible);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'options.txt'), lines.join('\n') + (lines[lines.length - 1] === '' ? '' : '\n'));
}

// ---------- listing ----------
async function list(dir) {
  const index = await readIndex(dir);
  const enabled = new Set(await enabledPacks(dir));
  let names = [];
  try { names = await fsp.readdir(packsDir(dir)); } catch { /* none yet */ }
  const out = [];
  for (const name of names) {
    const full = path.join(packsDir(dir), name);
    const isDir = fs.statSync(full).isDirectory();
    if (!isDir && !/\.zip$/i.test(name)) continue;
    const tracked = Object.entries(index).find(([, p]) => p.filename === name);
    const meta = tracked ? tracked[1] : readPackMeta(full);
    out.push({
      name,
      id: tracked ? tracked[0] : null,
      title: meta.title,
      icon: meta.icon || null,
      versionNumber: meta.versionNumber || '',
      enabled: enabled.has(`file/${name}`),
      local: !tracked,
    });
  }
  // Forget index entries whose file was deleted by hand.
  for (const [id, p] of Object.entries(index)) if (!names.includes(p.filename)) delete index[id];
  await writeIndex(dir, index);
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

// ---------- changes ----------
async function install({ dir, projectId, mcVersion }) {
  const params = new URLSearchParams({ game_versions: JSON.stringify([mcVersion]) });
  const [project, exact] = await Promise.all([api(`/project/${projectId}`), api(`/project/${projectId}/version?${params}`)]);
  // Texture packs often work across versions, so fall back to the newest build if none is tagged for this one.
  const versions = exact.length ? exact : await api(`/project/${projectId}/version`);
  if (!versions.length) throw new Error(`${project.title} has no downloads.`);
  const version = pickVersion(versions);
  const file = version.files.find(f => f.primary) || version.files[0];

  const index = await readIndex(dir);
  const old = index[projectId];
  if (old && old.filename !== file.filename) {
    await fsp.rm(path.join(packsDir(dir), old.filename), { recursive: true, force: true });
    await setPackEnabled(dir, old.filename, false);
  }
  await downloadFile(file.url, path.join(packsDir(dir), file.filename), { sha1: file.hashes.sha1, size: file.size });
  index[projectId] = {
    title: project.title, icon: project.icon_url || null, filename: file.filename,
    versionNumber: version.version_number, versionId: version.id,
  };
  await writeIndex(dir, index);
  await setPackEnabled(dir, file.filename, true);
  return project.title;
}

async function addLocal({ dir, files }) {
  await fsp.mkdir(packsDir(dir), { recursive: true });
  const added = [];
  for (const file of files) {
    if (!/\.zip$/i.test(file) || !fs.existsSync(file)) continue;
    const name = path.basename(file);
    await fsp.copyFile(file, path.join(packsDir(dir), name));
    await setPackEnabled(dir, name, true);
    added.push(name);
  }
  return added;
}

async function remove({ dir, name }) {
  const safe = path.basename(name);
  await fsp.rm(path.join(packsDir(dir), safe), { recursive: true, force: true });
  await setPackEnabled(dir, safe, false);
  const index = await readIndex(dir);
  for (const [id, p] of Object.entries(index)) if (p.filename === safe) delete index[id];
  await writeIndex(dir, index);
}

async function setEnabled({ dir, name, enabled }) {
  await setPackEnabled(dir, path.basename(name), enabled);
}

module.exports = { list, install, addLocal, remove, setEnabled };
