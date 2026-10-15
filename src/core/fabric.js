// Installs a Fabric loader profile (a version JSON that inheritsFrom the vanilla version).
const fsp = require('fs').promises;
const path = require('path');
const { fetchJson, exists } = require('./download');

const META = 'https://meta.fabricmc.net/v2';

// Compares loader versions like "0.19.2" and "0.19.5"; build suffixes ("+build.1") are ignored.
function compareLoader(a, b) {
  const pa = String(a).split('+')[0].split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('+')[0].split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// Returns the profile id ("fabric-loader-<loader>-<mc>"). The newest stable loader is used;
// loaderVersion (what a modpack asks for) is a minimum, never a cap: mods updated or added later
// often need a newer loader, and newer loaders still run older mods.
async function installFabric(root, mcVersion, loaderVersion = null) {
  let loader = loaderVersion;
  let loaders;
  try {
    loaders = await fetchJson(`${META}/versions/loader/${encodeURIComponent(mcVersion)}`);
  } catch (err) {
    // Fabric's API answers 400 for game versions it has never heard of (e.g. 1.8.9).
    if (/HTTP 400/.test(err.message)) throw new Error(`Fabric doesn't support Minecraft ${mcVersion}.`);
    // Offline: reuse the newest Fabric profile we installed before (at least the one asked for).
    const dirs = await fsp.readdir(path.join(root, 'versions')).catch(() => []);
    const local = dirs.filter(d => d.startsWith('fabric-loader-') && d.endsWith(`-${mcVersion}`))
      .sort((x, y) => compareLoader(loaderVersionOf(x, mcVersion), loaderVersionOf(y, mcVersion))).pop();
    if (local && (!loader || compareLoader(loaderVersionOf(local, mcVersion), loader) >= 0)) return local;
    if (!loader) throw err;
    loaders = null;
  }
  if (loaders) {
    if (!loaders.length) throw new Error(`Fabric doesn't support Minecraft ${mcVersion} (yet).`);
    const newest = (loaders.find(l => l.loader.stable) || loaders[0]).loader.version;
    if (!loader || compareLoader(newest, loader) > 0) loader = newest;
  }

  const id = `fabric-loader-${loader}-${mcVersion}`;
  const file = path.join(root, 'versions', id, `${id}.json`);
  if (!(await exists(file))) {
    const profile = await fetchJson(`${META}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loader)}/profile/json`);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(profile, null, 2));
  }
  return id;
}

// "fabric-loader-0.19.5-26.3" -> "0.19.5"
function loaderVersionOf(profileId, mcVersion) {
  return profileId.slice('fabric-loader-'.length, -(mcVersion.length + 1));
}

module.exports = { installFabric, loaderVersionOf };
