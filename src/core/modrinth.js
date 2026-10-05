// Modrinth search + install into a game folder's mods folder (Fabric only), with required dependencies.
// Also tracks mods the player drops in by hand ("local" mods, id = "file:<filename>").
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { downloadFile } = require('./download');
const { readModMeta } = require('./filemeta');

const API = 'https://api.modrinth.com/v2';
const HEADERS = { 'User-Agent': 'tatnatYT/tatnat-launcher/0.3.0 (github.com/tatnatYT/tatnat-launcher)' };

async function api(pathAndQuery, init = {}) {
  const res = await fetch(API + pathAndQuery, { ...init, headers: { ...HEADERS, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`Modrinth returned ${res.status}`);
  return res.json();
}

// type: 'mod' (Fabric only), 'resourcepack' or 'modpack' (Fabric only).
async function search({ query = '', mcVersion, offset = 0, limit = 20, type = 'mod' }) {
  const facets = [[`project_type:${type}`]];
  if (type !== 'resourcepack') facets.push(['categories:fabric']);
  if (mcVersion) facets.push([`versions:${mcVersion}`]);
  const params = new URLSearchParams({
    query, offset, limit,
    index: query ? 'relevance' : 'downloads',
    facets: JSON.stringify(facets),
  });
  const data = await api(`/search?${params}`);
  return {
    total: data.total_hits,
    hits: data.hits.map(h => ({
      id: h.project_id, slug: h.slug, title: h.title, description: h.description,
      author: h.author, icon: h.icon_url || null, downloads: h.downloads,
    })),
  };
}

// ---------- installed-mod bookkeeping (mods.json next to the mods folder) ----------
const indexFile = dir => path.join(dir, 'mods.json');
const modsDir = dir => path.join(dir, 'mods');
const LOCAL = 'file:';

async function readIndex(dir) {
  try { return JSON.parse(await fsp.readFile(indexFile(dir), 'utf8')); } catch { return {}; }
}
async function writeIndex(dir, index) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(indexFile(dir), JSON.stringify(index, null, 2));
}

async function listInstalled(dir) {
  const index = await readIndex(dir);
  const out = [];
  const tracked = new Set();
  for (const [id, mod] of Object.entries(index)) {
    const jar = path.join(modsDir(dir), mod.filename);
    const enabled = fs.existsSync(jar);
    if (!enabled && !fs.existsSync(`${jar}.disabled`)) { delete index[id]; continue; } // removed by hand
    tracked.add(mod.filename);
    out.push({ id, ...mod, enabled });
  }
  await writeIndex(dir, index);

  // Jars that didn't come from Modrinth through us.
  let files = [];
  try { files = await fsp.readdir(modsDir(dir)); } catch { /* no mods folder yet */ }
  for (const f of files) {
    if (!/\.jar(\.disabled)?$/i.test(f)) continue;
    const filename = f.replace(/\.disabled$/i, '');
    if (tracked.has(filename)) continue;
    const meta = readModMeta(path.join(modsDir(dir), f));
    out.push({ id: LOCAL + filename, ...meta, filename, enabled: !/\.disabled$/i.test(f), local: true });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

function pickVersion(versions) {
  return versions.find(v => v.version_type === 'release') || versions[0];
}

async function install({ dir, projectId, mcVersion, onStatus = () => {} }) {
  const index = await readIndex(dir);
  const seen = new Set();
  const installed = [];

  async function installOne(id, isDependency) {
    if (seen.has(id)) return;
    seen.add(id);
    if (isDependency && index[id]) return; // already have some version of it

    const params = new URLSearchParams({ loaders: JSON.stringify(['fabric']), game_versions: JSON.stringify([mcVersion]) });
    const [project, versions] = await Promise.all([api(`/project/${id}`), api(`/project/${id}/version?${params}`)]);
    if (!versions.length) throw new Error(`${project.title} has no Fabric build for Minecraft ${mcVersion}.`);
    const version = pickVersion(versions);
    const file = version.files.find(f => f.primary) || version.files[0];

    onStatus(`Downloading ${project.title}`);
    const old = index[id];
    if (old && old.filename !== file.filename) {
      await fsp.rm(path.join(modsDir(dir), old.filename), { force: true });
      await fsp.rm(path.join(modsDir(dir), `${old.filename}.disabled`), { force: true });
    }
    await downloadFile(file.url, path.join(modsDir(dir), file.filename), { sha1: file.hashes.sha1, size: file.size });
    index[id] = {
      title: project.title, slug: project.slug, icon: project.icon_url || null, versionId: version.id,
      versionNumber: version.version_number, filename: file.filename, dependency: isDependency && !old,
    };
    installed.push(project.title);

    for (const dep of version.dependencies || []) {
      if (dep.dependency_type !== 'required') continue;
      let depId = dep.project_id;
      if (!depId && dep.version_id) depId = (await api(`/version/${dep.version_id}`)).project_id;
      if (depId) await installOne(depId, true);
    }
  }

  try {
    await installOne(projectId, false);
    if (index[projectId]) index[projectId].dependency = false; // explicitly asked for
  } finally {
    await writeIndex(dir, index);
  }
  return installed;
}

// Copies jars the player picked or dropped into the mods folder. Returns the names added.
async function addLocalMods({ dir, files }) {
  await fsp.mkdir(modsDir(dir), { recursive: true });
  const added = [];
  for (const file of files) {
    if (!/\.jar$/i.test(file) || !fs.existsSync(file)) continue;
    await fsp.copyFile(file, path.join(modsDir(dir), path.basename(file)));
    added.push(path.basename(file));
  }
  return added;
}

// Returns { id, slug } when the project has a Fabric build for this version, else null.
async function projectFor(slugOrId, mcVersion) {
  const params = new URLSearchParams({ loaders: JSON.stringify(['fabric']), game_versions: JSON.stringify([mcVersion]) });
  const [project, versions] = await Promise.all([api(`/project/${slugOrId}`), api(`/project/${slugOrId}/version?${params}`)]);
  return versions.length ? { id: project.id, slug: project.slug } : null;
}

// Resolves an installed mod id to its jar filename (works for Modrinth and local mods).
async function filenameFor(dir, projectId) {
  if (projectId.startsWith(LOCAL)) return path.basename(projectId.slice(LOCAL.length));
  return (await readIndex(dir))[projectId]?.filename || null;
}

async function remove({ dir, projectId }) {
  const filename = await filenameFor(dir, projectId);
  if (!filename) return;
  await fsp.rm(path.join(modsDir(dir), filename), { force: true });
  await fsp.rm(path.join(modsDir(dir), `${filename}.disabled`), { force: true });
  const index = await readIndex(dir);
  if (index[projectId]) { delete index[projectId]; await writeIndex(dir, index); }
}

async function setEnabled({ dir, projectId, enabled }) {
  const filename = await filenameFor(dir, projectId);
  if (!filename) return;
  const jar = path.join(modsDir(dir), filename);
  const [from, to] = enabled ? [`${jar}.disabled`, jar] : [jar, `${jar}.disabled`];
  if (fs.existsSync(from)) await fsp.rename(from, to);
}

module.exports = { api, search, pickVersion, listInstalled, install, addLocalMods, remove, setEnabled, projectFor };
