// "FPS Boost": a curated Fabric performance pack plus FPS-friendly first-run game settings.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const modrinth = require('./modrinth');

// The built-in pack (Modrinth slugs). Each one is skipped quietly when it has no build for the chosen version.
const BOOST_MODS = [
  { slug: 'sodium', title: 'Sodium', what: 'Rendering engine rewrite - the big one' },
  { slug: 'lithium', title: 'Lithium', what: 'Game logic and ticking' },
  { slug: 'ferrite-core', title: 'FerriteCore', what: 'Lower memory use' },
  { slug: 'immediatelyfast', title: 'ImmediatelyFast', what: 'HUD, text and entity rendering' },
  { slug: 'entityculling', title: 'Entity Culling', what: 'Skips entities you can’t see' },
  { slug: 'moreculling', title: 'More Culling', what: 'Skips hidden block faces' },
  { slug: 'dynamic-fps', title: 'Dynamic FPS', what: 'Idles when the game is in the background' },
  { slug: 'badoptimizations', title: 'BadOptimizations', what: 'Sky and lighting micro-optimisations' },
  { slug: 'modernfix', title: 'ModernFix', what: 'Faster startup, less memory' },
];

// The player's own pack = built-ins they haven't switched off + mods they added
// (extra: [{ id, slug, title, icon }]).
function boostList({ disabled = [], extra = [] } = {}) {
  const off = new Set(disabled);
  return [
    ...BOOST_MODS.filter(m => !off.has(m.slug)).map(m => m.slug),
    ...extra.map(m => m.id),
  ];
}

async function installBoostPack({ dir, mcVersion, disabled, extra, onStatus = () => {} }) {
  const installed = await modrinth.listInstalled(dir);
  const have = new Set(installed.map(m => m.slug).filter(Boolean));
  const result = { added: [], unavailable: [] };
  // Built-ins the player switched off get disabled (not deleted) here; switching back on re-enables them.
  const off = new Set(disabled || []);
  for (const m of installed) {
    if (!m.slug || !BOOST_MODS.some(b => b.slug === m.slug)) continue;
    if (off.has(m.slug) === m.enabled) await modrinth.setEnabled({ dir, projectId: m.id, enabled: !off.has(m.slug) });
  }
  for (const slug of boostList({ disabled, extra })) {
    if (have.has(slug) || installed.some(m => m.id === slug)) continue;
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

// Only applied before the game has saved its own options.txt, so a player's settings always win.
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
  const lines = fs.existsSync(file) ? (await fsp.readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean) : [];
  // The game always writes a "version:" line; until then the file only holds what the
  // launcher put there (e.g. enabled texture packs), so the boost defaults still belong.
  if (lines.some(l => l.startsWith('version:'))) return false;
  const have = new Set(lines.map(l => l.split(':')[0]));
  const missing = Object.entries(BOOST_OPTIONS).filter(([k]) => !have.has(k)).map(([k, v]) => `${k}:${v}`);
  if (!missing.length) return false;
  await fsp.mkdir(gameDir, { recursive: true });
  await fsp.writeFile(file, [...lines, ...missing].join('\n') + '\n');
  return true;
}

module.exports = { BOOST_MODS, boostList, installBoostPack, writeBoostOptions };
