// Update checks for what's installed from Modrinth (mods, texture packs, shader packs): the newest
// build that fits this Minecraft version (and loader, for mods) versus the one we have.
const modrinth = require('./modrinth');

const LIMIT = 6; // requests at once

async function inBatches(items, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += LIMIT) out.push(...await Promise.all(items.slice(i, i + LIMIT).map(fn)));
  return out;
}

/**
 * @param {{ id: string, versionId?: string, versionNumber?: string }[]} items installed Modrinth projects
 * @param {{ mcVersion: string, loader?: string, strictVersion?: boolean }} opts loader only for mods;
 *        texture packs and shaders fall back to the newest build when none is tagged for this version.
 * @returns {Promise<Object<string, { versionNumber: string }>>} project id -> newer version
 */
async function check(items, { mcVersion, loader, strictVersion = true }) {
  const found = {};
  await inBatches(items.filter(i => i.id && !String(i.id).startsWith('file:')), async item => {
    try {
      const params = new URLSearchParams({ game_versions: JSON.stringify([mcVersion]) });
      if (loader) params.set('loaders', JSON.stringify([loader]));
      let versions = await modrinth.api(`/project/${item.id}/version?${params}`);
      if (!versions.length && !strictVersion) versions = await modrinth.api(`/project/${item.id}/version`);
      if (!versions.length) return;
      const latest = modrinth.pickVersion(versions);
      const newer = item.versionId ? latest.id !== item.versionId : latest.version_number !== item.versionNumber;
      // Only offer it when the one we have is older (not a newer beta the player picked).
      const mine = versions.find(v => v.id === item.versionId || v.version_number === item.versionNumber);
      if (newer && (!mine || new Date(latest.date_published) > new Date(mine.date_published))) {
        found[item.id] = { versionNumber: latest.version_number };
      }
    } catch { /* offline or project gone: just no update */ }
  });
  return found;
}

module.exports = { check };
