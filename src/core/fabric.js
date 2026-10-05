// Installs a Fabric loader profile (a version JSON that inheritsFrom the vanilla version).
const fsp = require('fs').promises;
const path = require('path');
const { fetchJson, exists } = require('./download');

const META = 'https://meta.fabricmc.net/v2';

async function installFabric(root, mcVersion) {
  let loaders;
  try {
    loaders = await fetchJson(`${META}/versions/loader/${encodeURIComponent(mcVersion)}`);
  } catch (err) {
    // Fabric's API answers 400 for game versions it has never heard of (e.g. 1.8.9).
    if (/HTTP 400/.test(err.message)) throw new Error(`Fabric doesn't support Minecraft ${mcVersion}.`);
    // Offline: reuse a Fabric profile we installed before.
    const dirs = await fsp.readdir(path.join(root, 'versions')).catch(() => []);
    const local = dirs.filter(d => d.startsWith('fabric-loader-') && d.endsWith(`-${mcVersion}`)).sort().pop();
    if (local) return local;
    throw err;
  }
  if (!loaders.length) throw new Error(`Fabric doesn't support Minecraft ${mcVersion} (yet).`);

  const loader = (loaders.find(l => l.loader.stable) || loaders[0]).loader.version;
  const id = `fabric-loader-${loader}-${mcVersion}`;
  const file = path.join(root, 'versions', id, `${id}.json`);
  if (!(await exists(file))) {
    const profile = await fetchJson(`${META}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loader)}/profile/json`);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(profile, null, 2));
  }
  return id;
}

module.exports = { installFabric };
