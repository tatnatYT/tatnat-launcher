// Version manifest, version JSON resolution (incl. inheritsFrom) and Mojang rule evaluation.
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { fetchJson, cachedJson, exists } = require('./download');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

function osName() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'osx';
  return 'linux';
}

function ruleMatches(rule, features) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== osName()) return false;
    if (rule.os.arch === 'x86' && process.arch !== 'ia32') return false;
    if (rule.os.arch === 'arm64' && process.arch !== 'arm64') return false;
    if (rule.os.version && !new RegExp(rule.os.version).test(os.release())) return false;
  }
  if (rule.features) {
    for (const [key, want] of Object.entries(rule.features)) {
      if (!!features[key] !== want) return false;
    }
  }
  return true;
}

// Mojang semantics: no rules = allowed; otherwise the last matching rule decides.
function rulesAllow(rules, features = {}) {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    if (ruleMatches(rule, features)) allowed = rule.action === 'allow';
  }
  return allowed;
}

async function getManifest(root) {
  const file = path.join(root, 'versions', 'version_manifest_v2.json');
  try {
    const manifest = await fetchJson(MANIFEST_URL);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(manifest));
    return manifest;
  } catch (err) {
    // Offline: fall back to the last manifest we saw.
    if (await exists(file)) return JSON.parse(await fsp.readFile(file, 'utf8'));
    throw err;
  }
}

// Versions installed locally that aren't in Mojang's manifest (e.g. Fabric/Forge profiles).
async function getLocalVersions(root, manifest) {
  const known = new Set(manifest.versions.map(v => v.id));
  const dir = path.join(root, 'versions');
  const out = [];
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory() || known.has(e.name)) continue;
    const json = path.join(dir, e.name, `${e.name}.json`);
    if (await exists(json)) out.push({ id: e.name, type: 'custom' });
  }
  return out;
}

async function loadVersionJson(root, id, manifest) {
  const file = path.join(root, 'versions', id, `${id}.json`);
  const entry = manifest.versions.find(v => v.id === id);
  if (entry) return cachedJson(entry.url, file, entry.sha1);
  if (await exists(file)) return JSON.parse(await fsp.readFile(file, 'utf8'));
  throw new Error(`Unknown version "${id}"`);
}

function mergeVersions(child, parent) {
  const merged = { ...parent, ...child };
  merged.libraries = [...(child.libraries || []), ...(parent.libraries || [])];
  if (child.arguments || parent.arguments) {
    merged.arguments = {
      game: [...(parent.arguments?.game || []), ...(child.arguments?.game || [])],
      jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])],
    };
  }
  // The jar and downloads come from the base game unless the child provides its own.
  merged.jar = child.jar || parent.jar || parent.id;
  delete merged.inheritsFrom;
  return merged;
}

async function resolveVersion(root, id, manifest) {
  const json = await loadVersionJson(root, id, manifest);
  if (!json.inheritsFrom) return { ...json, jar: json.jar || json.id };
  const parent = await resolveVersion(root, json.inheritsFrom, manifest);
  return mergeVersions(json, parent);
}

module.exports = { osName, rulesAllow, getManifest, getLocalVersions, resolveVersion };
