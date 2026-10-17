// Eclipse Plus: signing in to the Plus server, licence keys, capes, and the owner tools.
//
// Sign-in uses the player certificate Minecraft gives every account for chat signing: the launcher asks
// Microsoft for it (with the account's own token, sent only to Microsoft), signs the Plus server's one-time
// challenge with the certificate's private key and sends the certificate (Mojang-signed public key) and the
// signature. The Plus server checks both against Mojang's public keys and answers with a session token (24 h)
// that the launcher and the game use for everything else. Tokens and private keys never leave this PC.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

/** The Plus server (a Cloudflare Worker; see the eclipse-plus-server repo). */
const SERVER = (process.env.ECLIPSE_PLUS_SERVER || 'https://eclipse-plus.eclipse-plus-server.workers.dev').replace(/\/+$/, '');
/** Where "Buy Eclipse Plus" goes (the Lemon Squeezy checkout). */
const CHECKOUT = process.env.ECLIPSE_PLUS_CHECKOUT || '';

/** Every cape, in gallery order: animated scenes first, then single colours. */
const CAPES = [
  { id: 'eclipse', name: 'Eclipse', desc: 'A black moon, a breathing corona and sparkles in orbit' },
  { id: 'corona', name: 'Corona', desc: 'A dark sun in roaring fire, embers rising' },
  { id: 'nebula', name: 'Nebula', desc: 'Swirling purple, pink and cyan clouds' },
  { id: 'aurora', name: 'Aurora', desc: 'Northern lights over snowy mountains' },
  { id: 'galaxy', name: 'Galaxy', desc: 'A turning spiral galaxy' },
  { id: 'void', name: 'Void', desc: 'A black hole bending light around it' },
  { id: 'storm', name: 'Storm', desc: 'Thunderclouds, rain and branching lightning' },
  { id: 'ender', name: 'Ender', desc: 'The End portal and an Eye of Ender that looks around' },
  { id: 'synthwave', name: 'Synthwave', desc: 'A striped sun over a neon grid' },
  { id: 'black', name: 'Black', solid: '#17161c' },
  { id: 'purple', name: 'Purple', solid: '#7b3fe4' },
  { id: 'blue', name: 'Blue', solid: '#2f6fe0' },
  { id: 'green', name: 'Green', solid: '#2fb35a' },
  { id: 'yellow', name: 'Yellow', solid: '#f2c230' },
  { id: 'white', name: 'White', solid: '#ececec' },
  { id: 'pink', name: 'Pink', solid: '#f06ab8' },
];

class PlusError extends Error {}

async function call(pathname, body) {
  if (!SERVER) throw new PlusError('Eclipse Plus is not available yet.');
  let r;
  try {
    r = await fetch(SERVER + pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  } catch {
    throw new PlusError("Can't reach the Eclipse Plus server. Check your internet connection.");
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new PlusError(data.message || `Eclipse Plus server error (${r.status}).`);
    err.code = data.error;
    throw err;
  }
  return data;
}

/** Sessions per account, kept on disk so the game gets a token without signing in every launch. */
function sessionFile(root) {
  return path.join(root, 'plus_sessions.json');
}
function readSessions(root) {
  try { return JSON.parse(fs.readFileSync(sessionFile(root), 'utf8')); } catch { return {}; }
}
function writeSessions(root, all) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(sessionFile(root), JSON.stringify(all, null, 2));
}
function expiry(token) {
  try {
    const payload = Buffer.from(token.split('.')[0], 'base64url').toString('utf8');
    return Number(payload.split('.')[1]) || 0;
  } catch { return 0; }
}

/**
 * A fresh session for a Microsoft account ({ name, uuid, accessToken }), signing in again when the saved
 * one is close to expiring. {force} always signs in again (to refresh Plus/owner status).
 */
const pemBody = pem => String(pem).replace(/-----[^-]+-----|\s/g, '');

/** This account's player certificate from Microsoft (cached until it's due for a refresh). */
let certCache = {};
async function certificate(account) {
  const cached = certCache[account.uuid];
  if (cached && Date.parse(cached.refreshedAfter || cached.expiresAt) > Date.now()) return cached;
  const r = await fetch('https://api.minecraftservices.com/player/certificates', {
    method: 'POST',
    headers: { authorization: `Bearer ${account.accessToken}`, 'content-type': 'application/json' },
  }).catch(() => null);
  if (!r || !r.ok) throw new PlusError(`Microsoft didn't give this account's certificate${r ? ` (${r.status})` : ''}. Sign in to it again in Accounts and retry.`);
  const cert = await r.json();
  if (!cert?.keyPair?.privateKey || !cert.publicKeySignatureV2) throw new PlusError('This account has no Minecraft certificate. Sign in to it again in Accounts and retry.');
  certCache[account.uuid] = cert;
  return cert;
}

/**
 * A fresh session for a Microsoft account ({ name, uuid, accessToken }), signing in again when the saved
 * one is close to expiring. {force} always signs in again (to refresh Plus/owner status).
 */
async function session(root, account, { force = false } = {}) {
  if (!account || !account.uuid) throw new PlusError('Eclipse Plus needs a Microsoft account. Add one in Accounts.');
  const key = account.uuid.replace(/-/g, '');
  const all = readSessions(root);
  const saved = all[key];
  if (!force && saved && expiry(saved.token) - Date.now() > 3600 * 1000) return saved;
  const cert = await certificate(account);
  const { serverId } = await call('/challenge');
  const privateKey = crypto.createPrivateKey({ key: Buffer.from(pemBody(cert.keyPair.privateKey), 'base64'), format: 'der', type: 'pkcs8' });
  const signature = crypto.sign('sha256', Buffer.from(`eclipse-plus:${serverId}:${key}`), privateKey).toString('base64');
  const s = await call('/session', {
    name: account.name, serverId, uuid: key,
    publicKey: pemBody(cert.keyPair.publicKey), expiresAt: cert.expiresAt,
    keySignature: cert.publicKeySignatureV2, signature,
  });
  all[key] = s;
  writeSessions(root, all);
  return s;
}

function remember(root, account, changes) {
  const key = account.uuid.replace(/-/g, '');
  const all = readSessions(root);
  if (all[key]) {
    Object.assign(all[key], changes);
    writeSessions(root, all);
  }
}

async function activate(root, account, key) {
  const s = await session(root, account);
  const r = await call('/activate', { token: s.token, key });
  remember(root, account, { plus: true, cape: r.cape });
  return r;
}

async function equip(root, account, cape) {
  const s = await session(root, account);
  const r = await call('/equip', { token: s.token, cape });
  remember(root, account, { cape: r.cape });
  return r;
}

/** A Minecraft name or UUID -> { uuid, name } (looked up here: the Plus server can't reach Mojang). */
async function lookupPlayer(input) {
  const text = String(input || '').trim();
  const id = text.toLowerCase().replace(/-/g, '');
  if (/^[0-9a-f]{32}$/.test(id)) return { uuid: id, name: null };
  if (!/^\w{1,16}$/.test(text)) throw new PlusError('Enter a Minecraft name or UUID.');
  const r = await fetch(`https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(text)}`).catch(() => null);
  if (!r) throw new PlusError("Can't reach Minecraft to look that name up. Check your internet connection.");
  if (r.status === 404 || r.status === 204) throw new PlusError(`There is no Minecraft account called ${text}.`);
  if (!r.ok) throw new PlusError(`Minecraft didn't answer (${r.status}). Try again in a moment.`);
  const p = await r.json();
  return { uuid: String(p.id).toLowerCase(), name: String(p.name) };
}

async function admin(root, account, action, args) {
  const s = await session(root, account);
  if (args && args.player) {
    const p = await lookupPlayer(args.player);
    args = { ...args, player: p.uuid, name: p.name || undefined };
  }
  const r = await call(`/admin/${action}`, { token: s.token, ...args });
  return { ...r, name: r.name || args?.name || null };
}

/** JVM arguments that let the Eclipse Client mod show capes and badges, or [] without Plus server/session. */
async function jvmArgs(root, account) {
  if (!SERVER || !account || account.type !== 'microsoft') return [];
  const s = await session(root, account);
  return [`-Dtatnat.plusServer=${SERVER}`, `-Dtatnat.plusToken=${s.token}`];
}

module.exports = { SERVER, CHECKOUT, CAPES, PlusError, session, activate, equip, admin, jvmArgs, readSessions };
