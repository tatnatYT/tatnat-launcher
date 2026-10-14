// Recognises files the launcher didn't install itself (dropped in by hand, from a modpack, or from
// an older launcher) by asking Modrinth which version has the same SHA-1. Those files then get
// the same update arrow and version switcher as anything installed from Modrinth.
const fs = require('fs');
const crypto = require('crypto');

const API = 'https://api.modrinth.com/v2';
const HEADERS = { 'User-Agent': 'tatnatYT/tatnat-launcher (github.com/tatnatYT/tatnat-launcher)', 'Content-Type': 'application/json' };

// path|size|mtime -> { project, version } or null (not on Modrinth). Failed lookups aren't kept.
const cache = new Map();

function sha1(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('error', reject).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex')));
  });
}

async function post(pathAndQuery, body) {
  const res = await fetch(API + pathAndQuery, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Modrinth returned ${res.status}`);
  return res.json();
}

async function get(pathAndQuery) {
  const res = await fetch(API + pathAndQuery, { headers: HEADERS });
  if (!res.ok) throw new Error(`Modrinth returned ${res.status}`);
  return res.json();
}

/**
 * @param {string[]} files full paths of single files (folders are skipped)
 * @returns {Promise<Map<string, { projectId, versionId, versionNumber, title, slug, icon }>>} path -> match
 */
async function identify(files) {
  const out = new Map();
  const todo = [];
  for (const file of files) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (!st.isFile()) continue;
    const key = `${file}|${st.size}|${st.mtimeMs}`;
    if (cache.has(key)) { if (cache.get(key)) out.set(file, cache.get(key)); continue; }
    todo.push({ file, key });
  }
  if (!todo.length) return out;
  try {
    for (const t of todo) t.hash = await sha1(t.file);
    const versions = await post('/version_files', { hashes: todo.map(t => t.hash), algorithm: 'sha1' });
    const projectIds = [...new Set(Object.values(versions).map(v => v.project_id))];
    const projects = projectIds.length ? await get(`/projects?ids=${encodeURIComponent(JSON.stringify(projectIds))}`) : [];
    const byId = new Map(projects.map(p => [p.id, p]));
    for (const t of todo) {
      const v = versions[t.hash];
      const p = v && byId.get(v.project_id);
      const match = p ? { projectId: p.id, versionId: v.id, versionNumber: v.version_number, title: p.title, slug: p.slug, icon: p.icon_url || null } : null;
      cache.set(t.key, match);
      if (match) out.set(t.file, match);
    }
  } catch { /* offline: they stay "added by you" for now and are tried again next time */ }
  return out;
}

module.exports = { identify };
