// "FPS Boost": a curated Fabric performance pack plus FPS-friendly first-run game settings.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const modrinth = require('./modrinth');

// Modrinth slugs. Each one is skipped quietly when it has no build for the chosen version.
const BOOST_MODS = [
  'sodium',           // rendering engine rewrite - the big one
  'lithium',          // game logic / tick optimisations
  'ferrite-core',     // memory usage
  'immediatelyfast',  // immediate-mode rendering (HUD, text, entities)
  'entityculling',    // skip rendering hidden entities / block entities
  'moreculling',      // extra block face culling
  'dynamic-fps',      // throttle when the window is unfocused / hidden
  'badoptimizations', // micro-optimisations for lightmap, sky etc.
  'modernfix',        // startup + memory fixes
];

async function installBoostPack({ dir, mcVersion, onStatus = () => {} }) {
  const installed = await modrinth.listInstalled(dir);
  const have = new Set(installed.map(m => m.slug).filter(Boolean));
  const result = { added: [], unavailable: [] };
  for (const slug of BOOST_MODS) {
    if (have.has(slug)) continue;
    onStatus(`FPS Boost: checking ${slug}`);
    try {
      const project = await modrinth.projectFor(slug, mcVersion);
      if (!project) { result.unavailable.push(slug); continue; }
      if (installed.some(m => m.id === project.id)) continue; // installed by hand earlier
      const names = await modrinth.install({ dir, projectId: project.id, mcVersion, onStatus });
      result.added.push(...names);
    } catch (err) {
      // One missing or broken mod shouldn't block the game from starting.
      onStatus(`FPS Boost: skipped ${slug} (${err.message})`);
      result.unavailable.push(slug);
    }
  }
  return result;
}

// Only written when the instance has no options.txt yet, so a player's own settings always win.
const BOOST_OPTIONS = {
  renderDistance: 10,
  simulationDistance: 8,
  maxFps: 260,            // 260 = unlimited
  enableVsync: false,
  entityShadows: false,
  biomeBlendRadius: 0,
  renderClouds: '"fast"',
  particles: 1,           // decreased
  prioritizeChunkUpdates: 0,
};

async function writeBoostOptions(gameDir) {
  const file = path.join(gameDir, 'options.txt');
  if (fs.existsSync(file)) return false;
  await fsp.mkdir(gameDir, { recursive: true });
  await fsp.writeFile(file, Object.entries(BOOST_OPTIONS).map(([k, v]) => `${k}:${v}`).join('\n') + '\n');
  return true;
}

module.exports = { BOOST_MODS, installBoostPack, writeBoostOptions };
