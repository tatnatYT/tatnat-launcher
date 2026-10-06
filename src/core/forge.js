// Installs Forge and NeoForge profiles (version JSONs that inheritsFrom the vanilla version).
//
// Modern installers (Forge 1.13+, every NeoForge) are run headless with --installClient: they
// download their libraries and run the binary patchers themselves. Old Forge (1.12.2 and earlier)
// has no processors: its version JSON sits inside the installer, so we copy it out directly.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { downloadFile, fetchJson, exists } = require('./download');

const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const NEO_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'tatnat-launcher' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ---------------------------------------------------------------- versions

// Newest recommended (else latest) Forge build for a Minecraft version, e.g. "47.4.10".
async function forgeVersionFor(mcVersion) {
  const promos = (await fetchJson(FORGE_PROMOS)).promos || {};
  const v = promos[`${mcVersion}-recommended`] || promos[`${mcVersion}-latest`];
  if (!v) throw new Error(`Forge doesn't support Minecraft ${mcVersion}.`);
  return v;
}

// NeoForge numbers its builds after the game version: 1.21.1 -> 21.1.x, 26.1.2 -> 26.1.2.x.
function neoPrefix(mcVersion) {
  const p = mcVersion.split('.').map(Number);
  if (p[0] === 1) return p[1] >= 20 && !(p[1] === 20 && (p[2] || 0) < 2) ? `${p[1]}.${p[2] || 0}.` : null;
  return `${p[0]}.${p[1]}.${p[2] || 0}.`;
}

async function neoForgeVersionFor(mcVersion) {
  const prefix = neoPrefix(mcVersion);
  if (!prefix) throw new Error(`NeoForge doesn't support Minecraft ${mcVersion} (it starts at 1.20.2; use Forge).`);
  const xml = await fetchText(`${NEO_MAVEN}/maven-metadata.xml`);
  const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]).filter(v => v.startsWith(prefix));
  if (!all.length) throw new Error(`NeoForge doesn't support Minecraft ${mcVersion} (yet).`);
  const stable = all.filter(v => !/beta|alpha/.test(v));
  return (stable.length ? stable : all).pop();
}

// ---------------------------------------------------------------- install

function readInstallProfile(installerJar) {
  const zip = new AdmZip(installerJar);
  const profile = JSON.parse(zip.readAsText('install_profile.json'));
  return { zip, profile };
}

// The vanilla launcher's profile file; modern installers refuse to run without one.
async function ensureLauncherProfiles(root) {
  const file = path.join(root, 'launcher_profiles.json');
  if (!(await exists(file))) await fsp.writeFile(file, JSON.stringify({ profiles: {}, selectedProfile: null }, null, 2));
}

function runInstaller(javaBin, installerJar, root, onLog) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaBin, ['-jar', installerJar, '--installClient', root], { cwd: root, windowsHide: true });
    let tail = '';
    const take = d => {
      const s = d.toString();
      tail = (tail + s).slice(-4000);
      onLog(s);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`The installer failed (exit ${code}): ${tail.trim().split('\n').pop()}`))));
  });
}

// Returns the profile id to launch ("1.20.1-forge-47.4.10", "neoforge-21.1.256", ...).
async function installLoader({ root, kind, mcVersion, loaderVersion = null, javaBin, onStatus = () => {}, onLog = () => {} }) {
  const neo = kind === 'neoforge';
  const version = loaderVersion || (neo ? await neoForgeVersionFor(mcVersion) : await forgeVersionFor(mcVersion));
  // Old Forge builds (1.7 - 1.9 era) repeat the game version at the end: 1.8.9-11.15.1.2318-1.8.9.
  const names = neo ? [version] : [`${mcVersion}-${version}`, `${mcVersion}-${version}-${mcVersion}`];
  const cache = path.join(root, 'cache', 'installers');
  await fsp.mkdir(cache, { recursive: true });
  onStatus(`Downloading ${neo ? 'NeoForge' : 'Forge'} ${version}`);
  let installer = null;
  let lastErr = null;
  for (const full of names) {
    const url = neo ? `${NEO_MAVEN}/${full}/neoforge-${full}-installer.jar` : `${FORGE_MAVEN}/${full}/forge-${full}-installer.jar`;
    const dest = path.join(cache, path.basename(url));
    try {
      await downloadFile(url, dest, { retries: 1 });
      installer = dest;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!installer) throw lastErr;

  const { zip, profile } = readInstallProfile(installer);
  // Old installers keep the whole version JSON in "versionInfo"; new ones name it in "version".
  const id = profile.versionInfo ? profile.versionInfo.id : profile.version;
  const file = path.join(root, 'versions', id, `${id}.json`);
  if (await exists(file)) return id;

  if (profile.versionInfo) {
    // Forge 1.12.2 and older: write the JSON, and put the universal jar where the JSON expects it.
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(profile.versionInfo, null, 2));
    const lib = profile.install.path; // group:artifact:version
    const [group, artifact, ver] = lib.split(':');
    const dest = path.join(root, 'libraries', ...group.split('.'), artifact, ver, `${artifact}-${ver}.jar`);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, zip.readFile(profile.install.filePath));
    return id;
  }

  onStatus(`Installing ${neo ? 'NeoForge' : 'Forge'} ${version} (first time takes a minute)`);
  await ensureLauncherProfiles(root);
  await runInstaller(javaBin, installer, root, onLog);
  if (!(await exists(file))) throw new Error(`The ${neo ? 'NeoForge' : 'Forge'} installer finished but ${id} was not created.`);
  return id;
}

module.exports = { installLoader, forgeVersionFor, neoForgeVersionFor };
