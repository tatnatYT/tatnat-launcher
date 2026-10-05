// Minimal Discord Rich Presence client over Discord's local IPC pipe (no dependencies).
// Frames are: int32 LE opcode, int32 LE length, JSON payload.
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const RETRY_MS = 15000;

function pipePath(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const dir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp';
  return path.join(dir, `discord-ipc-${i}`);
}

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const header = Buffer.alloc(8);
  header.writeInt32LE(op, 0);
  header.writeInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

function tryConnect(i = 0) {
  return new Promise((resolve, reject) => {
    if (i > 9) return reject(new Error('Discord is not running'));
    const sock = net.createConnection(pipePath(i));
    sock.once('connect', () => resolve(sock));
    sock.once('error', () => tryConnect(i + 1).then(resolve, reject));
  });
}

class DiscordPresence {
  constructor() {
    this.clientId = null;
    this.sock = null;
    this.ready = false;
    this.activity = null; // last requested activity, re-sent after reconnects
    this.retryTimer = null;
    this.invalidId = false; // Discord rejected the application ID
  }

  // Start (or restart with a new id). An empty id turns presence off.
  configure(clientId) {
    if (clientId === this.clientId) return;
    this.stop();
    this.invalidId = false;
    this.clientId = clientId || null;
    if (this.clientId) this.connect();
  }

  stop() {
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.sock) { this.sock.removeAllListeners(); this.sock.destroy(); }
    this.sock = null;
    this.ready = false;
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    if (this.clientId) this.retryTimer = setTimeout(() => this.connect(), RETRY_MS);
  }

  async connect() {
    const id = this.clientId;
    let sock;
    try { sock = await tryConnect(); } catch { this.scheduleRetry(); return; }
    if (id !== this.clientId) { sock.destroy(); return; } // reconfigured meanwhile
    this.sock = sock;

    let buf = Buffer.alloc(0);
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 8) {
        const op = buf.readInt32LE(0);
        const len = buf.readInt32LE(4);
        if (buf.length < 8 + len) break;
        let msg = {};
        try { msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')); } catch { /* ignore */ }
        buf = buf.subarray(8 + len);
        this.onMessage(op, msg);
      }
    });
    const lost = () => {
      if (this.sock !== sock) return;
      this.sock = null;
      this.ready = false;
      this.scheduleRetry();
    };
    sock.on('close', lost);
    sock.on('error', lost);
    sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: id }));
  }

  onMessage(op, msg) {
    if (op === OP.PING) { this.sock?.write(encode(OP.PONG, msg)); return; }
    if (op === OP.CLOSE) {
      // 4000 = Discord doesn't know this application ID; retrying won't help.
      if (msg.code === 4000) { this.invalidId = true; this.stop(); return; }
      this.sock?.destroy();
      return;
    }
    if (op === OP.FRAME && msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
      this.ready = true;
      this.send();
    }
  }

  setActivity(activity) {
    this.activity = activity;
    this.send();
  }

  send() {
    if (!this.ready || !this.sock) return;
    this.sock.write(encode(OP.FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity: this.activity || undefined },
      nonce: crypto.randomUUID(),
    }));
  }
}

module.exports = { DiscordPresence };
