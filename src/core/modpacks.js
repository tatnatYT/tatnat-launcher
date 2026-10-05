// Player-made modpacks: each one is a folder with its own mods, texture packs, config, options and saves.
// Packs import/export as Modrinth .mrpack files (the format Modrinth, Prism, ATLauncher etc. use).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { api, pickVersion } = require('./modrinth');
const { downloadFile } = require('./download');
const curseforge = require('./curseforge');

const packsRoot = root => path.join(root, 'modpacks');
const packDir = (root, id) => path.join(packsRoot(root), path.basename(id));
const metaFile = (root, id) => path.join(packDir(root, id), 'pack.json');

function slugify(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'modpack';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
}

async function readMeta(root, id) {
  return JSON.parse(await fsp.readFile(metaFile(root, id), 'utf8'));
}

async function writeMeta(root, meta) {
  await fsp.mkdir(packDir(root, meta.id), { recursive: true });
  await fsp.writeFile(metaFile(root, meta.id), JSON.stringify(meta, null, 2));
}

async function countFiles(dir, pattern) {
  try { return (await fsp.readdir(dir)).filter(f => pattern.test(f)).length; } catch { return 0; }
}

async function list(root) {
  let ids = [];
  try { ids = await fsp.readdir(packsRoot(root)); } catch { return []; }
  const out = [];
  for (const id of ids) {
    try {
      const meta = await readMeta(root, id);
      out.push({ ...meta, modCount: await countFiles(path.join(packDir(root, id), 'mods'), /\.jar$/i) });
    } catch { /* not a pack folder */ }
  }
  return out.sort((a, b) => (b.lastPlayed || b.created) - (a.lastPlayed || a.created));
}

async function create(root, { name, mcVersion, icon = null, loaderVersion = null, source = null }) {
  const meta = {
    id: slugify(name), name: name.trim().slice(0, 48) || 'My modpack', mcVersion, loader: 'fabric',
    loaderVersion, icon, source, created: Date.now(), lastPlayed: null,
  };
  await writeMeta(root, meta);
  return meta;
}

async function update(root, id, changes) {
  const meta = { ...(await readMeta(root, id)), ...changes, id };
  await writeMeta(root, meta);
  return meta;
}

async function remove(root, id) {
  await fsp.rm(packDir(root, id), { recursive: true, force: true });
}

// ---------- export (.mrpack) ----------
function hashFile(file) {
  const data = fs.readFileSync(file);
  return {
    sha1: crypto.createHash('sha1').update(data).digest('hex'),
    sha512: crypto.createHash('sha512').update(data).digest('hex'),
    size: data.length,
  };
}

// Folders copied into the pack as "overrides" (settings travel with the pack; worlds don't).
const OVERRIDE_DIRS = ['config', 'resourcepacks', 'shaderpacks'];
const OVERRIDE_FILES = ['options.txt'];

function addFolderToZip(zip, folder, zipPath) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    const rel = `${zipPath}/${entry.name}`;
    if (entry.isDirectory()) addFolderToZip(zip, full, rel);
    else zip.addFile(rel, fs.readFileSync(full));
  }
}

async function exportPack(root, id, outFile, { loaderVersion }) {
  const meta = await readMeta(root, id);
  const dir = packDir(root, id);
  const zip = new AdmZip();
  const files = [];

  // Enabled mods: reference Modrinth downloads when Modrinth knows the exact file, else bundle the jar.
  const modsFolder = path.join(dir, 'mods');
  const jars = fs.existsSync(modsFolder) ? fs.readdirSync(modsFolder).filter(f => /\.jar$/i.test(f)) : [];
  const hashes = Object.fromEntries(jars.map(f => [f, hashFile(path.join(modsFolder, f))]));
  let known = {};
  if (jars.length) {
    try {
      known = await api('/version_files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hashes: Object.values(hashes).map(h => h.sha1), algorithm: 'sha1' }),
      });
    } catch { known = {}; } // offline: bundle everything
  }
  let bundled = 0;
  for (const jar of jars) {
    const h = hashes[jar];
    const version = known[h.sha1];
    const file = version?.files.find(f => f.hashes.sha1 === h.sha1);
    if (file) {
      files.push({
        path: `mods/${jar}`,
        hashes: { sha1: h.sha1, sha512: h.sha512 },
        env: { client: 'required', server: 'optional' },
        downloads: [file.url],
        fileSize: h.size,
      });
    } else {
      zip.addFile(`overrides/mods/${jar}`, fs.readFileSync(path.join(modsFolder, jar)));
      bundled++;
    }
  }

  for (const d of OVERRIDE_DIRS) {
    const full = path.join(dir, d);
    if (fs.existsSync(full)) addFolderToZip(zip, full, `overrides/${d}`);
  }
  for (const f of OVERRIDE_FILES) {
    const full = path.join(dir, f);
    if (fs.existsSync(full)) zip.addFile(`overrides/${f}`, fs.readFileSync(full));
  }

  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0.0',
    name: meta.name,
    summary: 'Made with tatnat launcher',
    files,
    dependencies: { minecraft: meta.mcVersion, 'fabric-loader': loaderVersion },
  }, null, 2)));
  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  zip.writeZip(outFile);
  return { linked: files.length, bundled };
}

// ---------- import (.mrpack) ----------
// Refuses any path that would land outside the pack folder.
function safeJoin(base, rel) {
  const target = path.resolve(base, rel);
  if (target !== base && !target.startsWith(base + path.sep)) throw new Error(`Unsafe path in modpack: ${rel}`);
  return target;
}

const ALLOWED_HOSTS = ['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com'];

async function importMrpack(root, file, { name, icon = null, source = null, onStatus = () => {} } = {}) {
  const zip = new AdmZip(file);
  const indexEntry = zip.getEntry('modrinth.index.json');
  if (!indexEntry) throw new Error("That file isn't a Modrinth modpack (.mrpack).");
  const index = JSON.parse(indexEntry.getData().toString('utf8'));
  const deps = index.dependencies || {};
  if (!deps.minecraft) throw new Error("This modpack doesn't say which Minecraft version it's for.");
  if (!deps['fabric-loader']) {
    const loader = Object.keys(deps).find(k => k !== 'minecraft') || 'unknown';
    throw new Error(`tatnat launcher runs Fabric modpacks; this one needs ${loader}.`);
  }

  const meta = await create(root, {
    name: name || index.name || path.basename(file, '.mrpack'),
    mcVersion: deps.minecraft,
    loaderVersion: deps['fabric-loader'],
    icon, source,
  });
  const dir = packDir(root, meta.id);
  try {
    const wanted = (index.files || []).filter(f => f.env?.client !== 'unsupported');
    let done = 0;
    for (const f of wanted) {
      const dest = safeJoin(dir, f.path);
      const url = (f.downloads || []).find(u => ALLOWED_HOSTS.includes(new URL(u).hostname));
      if (!url) throw new Error(`No trusted download for ${f.path}`);
      onStatus(`Downloading ${path.basename(f.path)}`, ++done, wanted.length);
      await downloadFile(url, dest, { sha1: f.hashes?.sha1, size: f.fileSize });
    }
    // overrides first, then client-overrides on top
    for (const prefix of ['overrides/', 'client-overrides/']) {
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
        const dest = safeJoin(dir, entry.entryName.slice(prefix.length));
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, entry.getData());
      }
    }
  } catch (err) {
    await remove(root, meta.id); // don't leave half a pack behind
    throw err;
  }
  return meta;
}

// ---------- import (CurseForge .zip) ----------
async function importCurseForge(root, file, { key = '', name, icon = null, source = null, onStatus = () => {} } = {}) {
  const manifest = curseforge.readManifest(file);
  if (!manifest) throw new Error("That .zip isn't a CurseForge modpack (no manifest.json).");
  const mc = manifest.minecraft?.version;
  if (!mc) throw new Error("This modpack doesn't say which Minecraft version it's for.");
  const loaders = manifest.minecraft.modLoaders || [];
  const loader = (loaders.find(l => l.primary) || loaders[0])?.id || '';
  if (!loader.startsWith('fabric-')) {
    throw new Error(`tatnat launcher runs Fabric modpacks; this one needs ${loader.split('-')[0] || 'another loader'}.`);
  }
  const meta = await create(root, {
    name: name || manifest.name || path.basename(file, '.zip'),
    mcVersion: mc, loaderVersion: loader.slice('fabric-'.length), icon,
    source: source || { curseforge: true },
  });
  const dir = packDir(root, meta.id);
  try {
    const manual = await curseforge.installManifestFiles({ dir, zip: new AdmZip(file), manifest, key, onStatus, safeJoin });
    return manual.length ? update(root, meta.id, { manual }) : meta;
  } catch (err) {
    await remove(root, meta.id);
    throw err;
  }
}

// ---------- import from a link ----------
async function importLink(root, url, { curseforgeKey = '', onStatus } = {}) {
  let u;
  try { u = new URL(url.trim()); } catch { throw new Error("That doesn't look like a link."); }
  const parts = u.pathname.split('/').filter(Boolean);
  if (/(^|\.)modrinth\.com$/.test(u.hostname)) {
    const i = parts.findIndex(p => p === 'modpack');
    if (i < 0 || !parts[i + 1]) throw new Error('Paste a Modrinth modpack link, like modrinth.com/modpack/fabulously-optimized');
    return installFromModrinth(root, parts[i + 1], { onStatus });
  }
  if (/(^|\.)curseforge\.com$/.test(u.hostname)) {
    const i = parts.findIndex(p => p === 'modpacks');
    if (i < 0 || !parts[i + 1]) throw new Error('Paste a CurseForge modpack link, like curseforge.com/minecraft/modpacks/<name>');
    if (!curseforgeKey) throw new Error('CurseForge links need a CurseForge API key (Settings). You can also import the modpack .zip instead.');
    const dl = await curseforge.downloadModpackBySlug(curseforgeKey, parts[i + 1]);
    try {
      return await importCurseForge(root, dl.tmp, { key: curseforgeKey, name: dl.name, icon: dl.icon, source: { curseforge: true, projectId: dl.projectId }, onStatus });
    } finally {
      await fsp.rm(dl.tmp, { force: true });
    }
  }
  throw new Error('Only Modrinth and CurseForge modpack links work here.');
}

// Installs a modpack straight from Modrinth (newest Fabric release, matching mcVersion when given).
async function installFromModrinth(root, projectId, { mcVersion, onStatus } = {}) {
  const params = new URLSearchParams({ loaders: JSON.stringify(['fabric']) });
  if (mcVersion) params.set('game_versions', JSON.stringify([mcVersion]));
  const [project, versions] = await Promise.all([api(`/project/${projectId}`), api(`/project/${projectId}/version?${params}`)]);
  if (!versions.length) throw new Error(`${project.title} has no Fabric version${mcVersion ? ` for Minecraft ${mcVersion}` : ''}.`);
  const version = pickVersion(versions);
  const file = version.files.find(f => f.primary) || version.files[0];
  const tmp = path.join(os.tmpdir(), `ttt-${Date.now()}.mrpack`);
  onStatus?.(`Downloading ${project.title}`, 0, 1);
  await downloadFile(file.url, tmp, { sha1: file.hashes.sha1, size: file.size });
  try {
    return await importMrpack(root, tmp, {
      name: project.title, icon: project.icon_url || null,
      source: { projectId, versionId: version.id, versionNumber: version.version_number }, onStatus,
    });
  } finally {
    await fsp.rm(tmp, { force: true });
  }
}

module.exports = { list, create, update, remove, packDir, readMeta, exportPack, importMrpack, importCurseForge, importLink, installFromModrinth };
