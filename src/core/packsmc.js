// PacksMC (packsmc.com) texture packs through their official API (https://packsmc.com/docs).
// Every request needs the player's own API key. Downloads always go through the API's
// download_url (their rule for third-party apps); Packs+ exclusives are personal-use only,
// so they're never downloaded here.
const BASE = 'https://packsmc.com/api/v1';
const USER_AGENT = 'tatnatlauncher/0.3 (+https://github.com/tatnatYT/tatnat-launcher)';

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

// PacksMC's rule: "Downloads must flow through the PacksMC site - the API does not issue file URLs."
// So the launcher only fetches what it needs to recognise the file once the player downloads it.
async function packInfo({ key, id }) {
  const [info, detail] = await Promise.all([
    call(key, `/packs/${encodeURIComponent(id)}/download`),
    call(key, `/packs/${encodeURIComponent(id)}`),
  ]);
  const d = detail?.data || detail?.pack || detail || {};
  const pack = normalize({ ...d, id: d.id || id });
  if (info.requires_packs_plus || d.is_exclusive) throw new PacksMcError(`${pack.title} is a Packs+ exclusive on PacksMC.`);
  return {
    ...pack,
    pageUrl: info.download_url || info.web_url || pack.webUrl,
    sizeBytes: Number(d.file_size_bytes) || 0,
  };
}

module.exports = { PacksMcError, checkKey, search, packInfo };
