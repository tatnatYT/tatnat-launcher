// In-game account switcher: a tiny HTTP server on 127.0.0.1 that the tatnat client mod asks for
// the launcher's accounts and for a fresh session when you switch. Each launch gets the address
// and a random secret through -Dtatnat.accounts, so nothing else on the machine can use it and
// tokens are never written to disk.
//   GET /<secret>/accounts        -> one line per account: id \t name \t uuid \t type \t active(1|0)
//   GET /<secret>/session?id=<id> -> name \t uuid \t accessToken \t userType \t xuid
//   GET /<secret>/presence?server=<ip> -> "ok"; Discord shows the server you're on (empty = none)
const http = require('http');
const crypto = require('crypto');

let server = null;
let port = 0;
const secrets = new Set();

/**
 * @param {{ list: () => object[], activeId: () => string|null, session: (id: string) => Promise<object> }} source
 * @returns {Promise<string>} the JVM argument for one launch
 */
async function jvmArg(source) {
  if (!server) {
    server = http.createServer((req, res) => handle(source, req, res).catch(err => reply(res, 500, String(err.message || err))));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
    });
    server.unref();
  }
  const secret = crypto.randomBytes(24).toString('hex');
  secrets.add(secret);
  return `-Dtatnat.accounts=http://127.0.0.1:${port}/${secret}`;
}

function reply(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const clean = s => String(s ?? '').replace(/[\t\r\n]/g, ' ');

async function handle(source, req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const [, secret, action] = url.pathname.split('/');
  if (req.method !== 'GET' || !secrets.has(secret)) return reply(res, 404, 'not found');
  if (action === 'accounts') {
    const active = source.activeId();
    return reply(res, 200, source.list().map(a => [a.id, a.name, a.uuid, a.type, a.id === active ? 1 : 0].map(clean).join('\t')).join('\n'));
  }
  if (action === 'session') {
    const s = await source.session(url.searchParams.get('id') || '');
    return reply(res, 200, [s.name, s.uuid, s.accessToken, s.userType, s.xuid || ''].map(clean).join('\t'));
  }
  if (action === 'presence') {
    if (source.presence) source.presence({ server: (url.searchParams.get('server') || '').slice(0, 80) });
    return reply(res, 200, 'ok');
  }
  return reply(res, 404, 'not found');
}

module.exports = { jvmArg };
