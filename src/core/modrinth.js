// Modrinth search + install into an instance's mods folder (Fabric only), with required dependencies.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { downloadFile } = require('./download');

const API = 'https://api.modrinth.com/v2';
const HEADERS = { 'User-Agent': 'tatnat/tatnat-client/0.1.0' };

async function api(pathAndQuery) {
  const res = await fetch(API + pathAndQuery, { headers: HEADERS });
  if (!res.ok) throw new Error(`Modrinth returned ${res.status}`);
  return res.json();
}

async function search({ query = '', mcVersion, offset = 0, limit = 20 }) {
  const facets = [['project_type:mod'], ['categories:fabric'], [`versions:${mcVersion}`]];
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
  for (const [id, mod] of Object.entries(index)) {
    const jar = path.join(modsDir(dir), mod.filename);
    const enabled = fs.existsSync(jar);
    if (!enabled && !fs.existsSync(`${jar}.disabled`)) { delete index[id]; continue; } // removed by hand
    out.push({ id, ...mod, enabled });
  }
  await writeIndex(dir, index);
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
      title: project.title, icon: project.icon_url || null, versionId: version.id,
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

async function remove({ dir, projectId }) {
  const index = await readIndex(dir);
  const mod = index[projectId];
  if (mod) {
    await fsp.rm(path.join(modsDir(dir), mod.filename), { force: true });
    await fsp.rm(path.join(modsDir(dir), `${mod.filename}.disabled`), { force: true });
    delete index[projectId];
    await writeIndex(dir, index);
  }
}

async function setEnabled({ dir, projectId, enabled }) {
  const mod = (await readIndex(dir))[projectId];
  if (!mod) return;
  const jar = path.join(modsDir(dir), mod.filename);
  const [from, to] = enabled ? [`${jar}.disabled`, jar] : [jar, `${jar}.disabled`];
  if (fs.existsSync(from)) await fsp.rename(from, to);
}

module.exports = { search, listInstalled, install, remove, setEnabled };
