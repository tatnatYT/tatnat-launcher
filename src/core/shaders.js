// Shader packs from Modrinth (or your own zips) for an instance's shaderpacks folder.
// Shaders need a shader mod: Iris on Fabric / NeoForge (it pulls in Sodium), Oculus on Forge.
// The active pack is chosen in that mod's config (config/iris.properties or oculus.properties).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { downloadFile } = require('./download');
const modrinth = require('./modrinth');

const shadersDir = dir => path.join(dir, 'shaderpacks');
const indexFile = dir => path.join(dir, 'shaders.json');
// The shader mod per loader, by Modrinth slug.
const SHADER_MOD = { fabric: 'iris', neoforge: 'iris', forge: 'oculus' };

async function readIndex(dir) {
  try { return JSON.parse(await fsp.readFile(indexFile(dir), 'utf8')); } catch { return {}; }
}
async function writeIndex(dir, index) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(indexFile(dir), JSON.stringify(index, null, 2));
}

// ---------- the shader mod's config (key=value lines) ----------
function configFile(dir, loader) {
  return path.join(dir, 'config', loader === 'forge' ? 'oculus.properties' : 'iris.properties');
}
async function readConfig(dir, loader) {
  try { return (await fsp.readFile(configFile(dir, loader), 'utf8')).split(/\r?\n/); } catch { return []; }
}
function getKey(lines, key) {
  const l = lines.find(x => x.startsWith(key + '='));
  return l ? l.slice(key.length + 1).replace(/\\(.)/g, '$1') : null;
}
function setKey(lines, key, value) {
  const line = `${key}=${String(value).replace(/([:=\\])/g, '\\$1')}`;
  const i = lines.findIndex(x => x.startsWith(key + '='));
  if (i >= 0) lines[i] = line; else lines.splice(lines.length && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length, 0, line);
}
async function writeConfig(dir, loader, changes) {
  const lines = await readConfig(dir, loader);
  for (const [k, v] of Object.entries(changes)) setKey(lines, k, v);
  await fsp.mkdir(path.dirname(configFile(dir, loader)), { recursive: true });
  await fsp.writeFile(configFile(dir, loader), lines.filter((l, i) => l !== '' || i === lines.length - 1).join('\n') + '\n');
}

async function active(dir, loader) {
  const lines = await readConfig(dir, loader);
  if (getKey(lines, 'enableShaders') === 'false') return null;
  return getKey(lines, 'shaderPack');
}

// ---------- listing ----------
async function list({ dir, loader }) {
  const index = await readIndex(dir);
  const on = await active(dir, loader);
  let names = [];
  try { names = await fsp.readdir(shadersDir(dir)); } catch { /* none yet */ }
  const out = [];
  for (const name of names) {
    const full = path.join(shadersDir(dir), name);
    if (!fs.statSync(full).isDirectory() && !/\.zip$/i.test(name)) continue;
    const tracked = Object.entries(index).find(([, p]) => p.filename === name);
    const meta = tracked ? tracked[1] : { title: name.replace(/\.zip$/i, '') };
    out.push({ name, id: tracked ? tracked[0] : null, title: meta.title, icon: meta.icon || null,
      versionNumber: meta.versionNumber || '', versionId: meta.versionId || null, enabled: on === name, local: !tracked });
  }
  for (const [id, p] of Object.entries(index)) if (!names.includes(p.filename)) delete index[id];
  await writeIndex(dir, index);
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

// ---------- the shader mod ----------
async function ensureShaderMod({ dir, mcVersion, loader, onStatus }) {
  const slug = SHADER_MOD[loader];
  if (!slug) throw new Error('Shaders need a mod loader. Switch to Fabric (or FPS Boost, NeoForge or Forge) and try again.');
  const project = await modrinth.api(`/project/${slug}`);
  const installed = await modrinth.listInstalled(dir);
  if (installed.some(m => m.id === project.id)) return;
  onStatus(`Installing ${project.title} so shaders work`);
  // Installs required dependencies too (Iris -> Sodium, Oculus -> Embeddium).
  await modrinth.install({ dir, projectId: project.id, mcVersion, loader, onStatus });
}

// ---------- changes ----------
async function install({ dir, projectId, mcVersion, loader, versionId = null, onStatus = () => {} }) {
  await ensureShaderMod({ dir, mcVersion, loader, onStatus });
  const params = new URLSearchParams({ game_versions: JSON.stringify([mcVersion]) });
  const [project, exact] = await Promise.all([modrinth.api(`/project/${projectId}`), modrinth.api(`/project/${projectId}/version?${params}`)]);
  // Shader packs rarely depend on the exact game version; fall back to the newest build.
  let versions = exact.length ? exact : await modrinth.api(`/project/${projectId}/version`);
  const forShaderMod = versions.filter(v => (v.loaders || []).some(l => l === 'iris' || l === 'optifine' || l === 'canvas'));
  if (forShaderMod.length) versions = forShaderMod;
  if (versionId) versions = [await modrinth.api(`/version/${versionId}`)];
  if (!versions.length) throw new Error(`${project.title} has no downloads.`);
  const version = modrinth.pickVersion(versions);
  const file = version.files.find(f => f.primary) || version.files[0];

  onStatus(`Downloading ${project.title}`);
  const index = await readIndex(dir);
  const old = index[projectId];
  if (old && old.filename !== file.filename) await fsp.rm(path.join(shadersDir(dir), old.filename), { recursive: true, force: true });
  await downloadFile(file.url, path.join(shadersDir(dir), file.filename), { sha1: file.hashes.sha1, size: file.size });
  index[projectId] = { title: project.title, icon: project.icon_url || null, filename: file.filename, versionNumber: version.version_number, versionId: version.id };
  await writeIndex(dir, index);
  await setActive({ dir, loader, name: file.filename });
  return project.title;
}

async function addLocal({ dir, files, loader, mcVersion, onStatus = () => {} }) {
  const zips = files.filter(f => /\.zip$/i.test(f) && fs.existsSync(f));
  if (!zips.length) return [];
  await ensureShaderMod({ dir, mcVersion, loader, onStatus });
  await fsp.mkdir(shadersDir(dir), { recursive: true });
  const added = [];
  for (const file of zips) {
    const name = path.basename(file);
    await fsp.copyFile(file, path.join(shadersDir(dir), name));
    added.push(name);
  }
  await setActive({ dir, loader, name: added[added.length - 1] });
  return added;
}

/** Makes {@code name} the active pack, or turns shaders off when name is null. */
async function setActive({ dir, loader, name }) {
  if (name) await writeConfig(dir, loader, { enableShaders: 'true', shaderPack: path.basename(name) });
  else await writeConfig(dir, loader, { enableShaders: 'false' });
}

async function remove({ dir, loader, name }) {
  const safe = path.basename(name);
  await fsp.rm(path.join(shadersDir(dir), safe), { recursive: true, force: true });
  if ((await active(dir, loader)) === safe) await setActive({ dir, loader, name: null });
  const index = await readIndex(dir);
  for (const [id, p] of Object.entries(index)) if (p.filename === safe) delete index[id];
  await writeIndex(dir, index);
}

module.exports = { list, install, addLocal, setActive, remove };
