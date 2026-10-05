// PacksMC (packsmc.com) texture packs through their official API (https://packsmc.com/docs).
// Every request needs the player's own API key. Downloads always go through the API's
// download_url (their rule for third-party apps); Packs+ exclusives are personal-use only,
// so they're never downloaded here.
const BASE = 'https://packsmc.com/api/v1';
const USER_AGENT = 'tatnatlauncher/0.3 (+https://github.com/koens-bit/ttt-client)';

class PacksMcError extends Error {}

async function call(key, pathAndQuery) {
  if (!key) throw new PacksMcError('Add your PacksMC API key first.');
  const res = await fetch(BASE + pathAndQuery, { headers: { Authorization: `Bearer ${key}`, 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  let body = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  if (res.ok) return body;
  const code = body.error?.code;
  if (res.status === 401 || code === 'unauthenticated') throw new PacksMcError('PacksMC did not accept that API key.');
  if (res.status === 429) {
    const wait = res.headers.get('retry-after');
    throw new PacksMcError(code === 'daily_quota'
      ? 'Your PacksMC key used up its daily requests - try again tomorrow.'
      : `PacksMC rate limit reached${wait ? `, try again in ${wait}s` : ''}.`);
  }
  if (code === 'packs_plus_required') throw new PacksMcError('That pack is a PacksMC Packs+ exclusive.');
  throw new PacksMcError(body.error?.message || `PacksMC returned ${res.status}`);
}

// The API docs list the fields loosely, so accept the common spellings.
const first = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');

function normalize(p) {
  const author = p.author || p.creator || p.user || {};
  const versions = first(p.versions, p.mc_versions, p.minecraft_versions, p.game_versions) || [];
  return {
    id: String(first(p.id, p.uuid, p.slug)),
    slug: first(p.slug, p.id),
    title: first(p.name, p.title, p.slug, 'Untitled pack'),
    description: first(p.description, p.summary, p.short_description, ''),
    author: typeof author === 'string' ? author : first(author.display_name, author.username, author.name, ''),
    icon: first(p.thumbnail_url, p.icon_url, p.cover_url, p.image_url, p.preview_url, p.thumbnail, p.icon, p.image) || null,
    downloads: Number(first(p.downloads, p.download_count, p.stats?.downloads, 0)) || 0,
    resolution: first(p.resolution, ''),
    versions: Array.isArray(versions) ? versions.map(v => (typeof v === 'string' ? v : first(v.version, v.name, ''))).filter(Boolean) : [],
    packsPlus: !!first(p.packs_plus, p.requires_packs_plus, p.exclusive, p.is_exclusive),
    webUrl: first(p.web_url, p.url) || (p.slug ? `https://www.packsmc.com/pack/${p.slug}` : null),
  };
}

function listFrom(body) {
  if (Array.isArray(body)) return body;
  return first(body.data, body.packs, body.items, body.results) || [];
}

async function checkKey(key) {
  const me = await call(key, '/me');
  return { username: first(me.display_name, me.username, ''), tier: first(me.tier, me.packs_plus ? 'Packs+' : 'Free') };
}

async function search({ key, query = '', cursor = null, limit = 30 }) {
  const params = new URLSearchParams({ limit });
  if (query.length >= 2) params.set('q', query);
  else params.set('sort', 'downloads');
  if (cursor) params.set('cursor', cursor);
  const body = await call(key, `/packs?${params}`);
  const hits = listFrom(body).map(normalize).filter(p => !p.packsPlus);
  return { hits, nextCursor: body.next_cursor || body.nextCursor || null };
}

// Fetches the pack file via the API's canonical download_url. Returns { filename, data, pack }.
async function download({ key, id }) {
  const [info, detail] = await Promise.all([
    call(key, `/packs/${encodeURIComponent(id)}/download`),
    call(key, `/packs/${encodeURIComponent(id)}`).catch(() => null),
  ]);
  const pack = normalize(detail?.data || detail?.pack || detail || { id });
  if (info.requires_packs_plus) throw new PacksMcError(`${pack.title} is a Packs+ exclusive on PacksMC.`);
  if (!info.download_url) throw new PacksMcError('PacksMC did not give a download link for that pack.');

  const url = new URL(info.download_url);
  const sameSite = /(^|\.)packsmc\.com$/.test(url.hostname);
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': USER_AGENT, ...(sameSite ? { Authorization: `Bearer ${key}` } : {}) } });
  if (!res.ok) throw new PacksMcError(`PacksMC download failed (${res.status}).`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.subarray(0, 2).toString() !== 'PK') {
    // Not a zip (e.g. a page you have to click through) - let the player finish it in the browser.
    const err = new PacksMcError(`${pack.title} can only be downloaded on the PacksMC website.`);
    err.webUrl = info.web_url || pack.webUrl;
    throw err;
  }
  const disposition = res.headers.get('content-disposition') || '';
  const named = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  let filename = named ? decodeURIComponent(named[1]) : `${pack.slug || id}.zip`;
  filename = filename.replace(/[\\/:*?"<>|]+/g, '_');
  if (!/\.zip$/i.test(filename)) filename += '.zip';
  return { filename, data, pack: { ...pack, webUrl: info.web_url || pack.webUrl } };
}

module.exports = { PacksMcError, checkKey, search, download };
