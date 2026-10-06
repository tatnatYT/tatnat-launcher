// Skin changer: reads and changes the player's real Minecraft skin and cape through Mojang's
// API (so the change shows on every server and every version), plus a local library of skins
// and the built-in default skins (Steve, Alex, ...) extracted from a Minecraft client jar.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { downloadFile, fetchJson } = require('./download');

const API = 'https://api.minecraftservices.com/minecraft/profile';
const DEFAULT_NAMES = ['steve', 'alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'sunny', 'zuri'];

class SkinError extends Error {}

function libDir(root) {
  return path.join(root, 'skins', 'library');
}

// ---------- validation ----------

// Minecraft accepts 64x64 skins (and the old 64x32 layout). Reads the PNG header directly.
function checkPng(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new SkinError("That file isn't a PNG image.");
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w !== 64 || (h !== 64 && h !== 32)) throw new SkinError(`A skin must be 64x64 pixels (this one is ${w}x${h}).`);
  if (buf.length > 24 * 1024) throw new SkinError('That skin file is too big (max 24 KB).');
}

const toDataUrl = buf => `data:image/png;base64,${buf.toString('base64')}`;

// ---------- Mojang API ----------

async function api(token, method, url, body, isForm) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body && !isForm ? JSON.stringify(body) : body });
  if (res.status === 429) throw new SkinError('Mojang says slow down: wait a minute and try again.');
  if (res.status === 401) throw new SkinError('Your sign-in expired. Remove the account and sign in again.');
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json()).errorMessage || ''; } catch { /* no body */ }
    throw new SkinError(msg || `Mojang returned an error (${res.status}).`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

const textureCache = new Map();
async function textureDataUrl(url) {
  if (!url) return null;
  if (textureCache.has(url)) return textureCache.get(url);
  const res = await fetch(url.replace(/^http:/, 'https:'));
  if (!res.ok) return null;
  const data = toDataUrl(Buffer.from(await res.arrayBuffer()));
  textureCache.set(url, data);
  return data;
}

// The player's current skin + every cape they own, with textures inlined for the 3D viewer.
async function profile(token) {
  const p = await api(token, 'GET', API);
  const skin = p.skins?.find(s => s.state === 'ACTIVE') || p.skins?.[0] || null;
  const capes = await Promise.all((p.capes || []).map(async c => ({
    id: c.id, alias: c.alias, active: c.state === 'ACTIVE', texture: await textureDataUrl(c.url),
  })));
  return {
    name: p.name,
    skin: skin ? { variant: (skin.variant || 'CLASSIC').toLowerCase(), url: skin.url, texture: await textureDataUrl(skin.url) } : null,
    capes,
  };
}

async function uploadSkin(token, buf, variant) {
  checkPng(buf);
  const form = new FormData();
  form.append('variant', variant === 'slim' ? 'slim' : 'classic');
  form.append('file', new Blob([buf], { type: 'image/png' }), 'skin.png');
  await api(token, 'POST', `${API}/skins`, form, true);
}

const setCape = (token, capeId) => capeId
  ? api(token, 'PUT', `${API}/capes/active`, { capeId })
  : api(token, 'DELETE', `${API}/capes/active`);

// ---------- default skins ----------

// Finds a client jar that has the 1.19.3+ default skins (any installed version will do), or
// downloads the latest release's client jar once and keeps it.
async function defaultsJar(root) {
  const versions = path.join(root, 'versions');
  const has = jar => {
    try { return !!new AdmZip(jar).getEntry('assets/minecraft/textures/entity/player/wide/steve.png'); } catch { return false; }
  };
  if (fs.existsSync(versions)) {
    for (const id of fs.readdirSync(versions).sort().reverse()) {
      const jar = path.join(versions, id, `${id}.jar`);
      if (fs.existsSync(jar) && fs.statSync(jar).size > 5e6 && has(jar)) return jar;
    }
  }
  const cached = path.join(root, 'skins', 'client.jar');
  if (fs.existsSync(cached) && has(cached)) return cached;
  const manifest = await fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  const latest = manifest.versions.find(v => v.id === manifest.latest.release);
  const json = await fetchJson(latest.url);
  await downloadFile(json.downloads.client.url, cached, { sha1: json.downloads.client.sha1, size: json.downloads.client.size });
  return cached;
}

async function defaults(root) {
  const dir = path.join(root, 'skins', 'defaults');
  const want = [];
  for (const name of DEFAULT_NAMES) for (const variant of ['classic', 'slim']) want.push({ name, variant });
  const file = s => path.join(dir, `${s.name}-${s.variant}.png`);
  if (!want.every(s => fs.existsSync(file(s)))) {
    const zip = new AdmZip(await defaultsJar(root));
    fs.mkdirSync(dir, { recursive: true });
    for (const s of want) {
      const e = zip.getEntry(`assets/minecraft/textures/entity/player/${s.variant === 'slim' ? 'slim' : 'wide'}/${s.name}.png`);
      if (e) fs.writeFileSync(file(s), e.getData());
    }
  }
  return want.filter(s => fs.existsSync(file(s))).map(s => ({
    id: `default:${s.name}:${s.variant}`,
    name: s.name[0].toUpperCase() + s.name.slice(1),
    variant: s.variant,
    texture: toDataUrl(fs.readFileSync(file(s))),
  }));
}

function defaultBuffer(root, id) {
  const [, name, variant] = id.split(':');
  if (!DEFAULT_NAMES.includes(name) || !['classic', 'slim'].includes(variant)) throw new SkinError('Unknown default skin.');
  return fs.readFileSync(path.join(root, 'skins', 'defaults', `${name}-${variant}.png`));
}

// ---------- library ----------

function readIndex(root) {
  try { return JSON.parse(fs.readFileSync(path.join(libDir(root), 'index.json'), 'utf8')); } catch { return []; }
}

function writeIndex(root, list) {
  fs.mkdirSync(libDir(root), { recursive: true });
  fs.writeFileSync(path.join(libDir(root), 'index.json'), JSON.stringify(list, null, 2));
}

function library(root) {
  return readIndex(root)
    .filter(s => fs.existsSync(path.join(libDir(root), s.file)))
    .map(s => ({ ...s, texture: toDataUrl(fs.readFileSync(path.join(libDir(root), s.file))) }));
}

// Adds a skin file to the library (same image twice is stored once). Returns the entry.
function addToLibrary(root, buf, name, variant) {
  checkPng(buf);
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  const list = readIndex(root);
  let entry = list.find(s => s.hash === hash);
  if (!entry) {
    entry = { id: `lib:${hash}`, hash, file: `${hash}.png`, name: (name || 'Skin').slice(0, 32), variant: variant === 'slim' ? 'slim' : 'classic', added: Date.now() };
    fs.mkdirSync(libDir(root), { recursive: true });
    fs.writeFileSync(path.join(libDir(root), entry.file), buf);
    list.unshift(entry);
    writeIndex(root, list);
  }
  return { ...entry, texture: toDataUrl(buf) };
}

function updateLibrary(root, id, changes) {
  const list = readIndex(root);
  const e = list.find(s => s.id === id);
  if (!e) return;
  if (changes.name) e.name = String(changes.name).slice(0, 32);
  if (changes.variant) e.variant = changes.variant === 'slim' ? 'slim' : 'classic';
  writeIndex(root, list);
}

function removeFromLibrary(root, id) {
  const list = readIndex(root);
  const e = list.find(s => s.id === id);
  if (!e) return;
  fs.rmSync(path.join(libDir(root), e.file), { force: true });
  writeIndex(root, list.filter(s => s.id !== id));
}

function libraryBuffer(root, id) {
  const e = readIndex(root).find(s => s.id === id);
  if (!e) throw new SkinError('That skin is no longer in your library.');
  return fs.readFileSync(path.join(libDir(root), e.file));
}

module.exports = {
  SkinError, checkPng, profile, uploadSkin, setCape, defaults, defaultBuffer,
  library, addToLibrary, updateLibrary, removeFromLibrary, libraryBuffer, textureDataUrl,
};
