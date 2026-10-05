// Small download helpers: streamed fetch with sha1 check, retries and a worker pool.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');

const USER_AGENT = 'tatnatlauncher/0.3';

async function exists(file) {
  try { await fsp.access(file); return true; } catch { return false; }
}

async function sha1File(file) {
  const hash = crypto.createHash('sha1');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// A file counts as present when it exists and (if known) has the right size.
// Hashes are checked right after downloading, so a full rehash on every launch isn't needed.
async function isPresent(file, size) {
  try {
    const st = await fsp.stat(file);
    return size == null || st.size === size;
  } catch { return false; }
}

async function downloadFile(url, dest, { sha1, size, retries = 3 } = {}) {
  if (await isPresent(dest, size) && (size != null || sha1 == null || (await sha1File(dest)) === sha1)) return false;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.part`;
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const hash = crypto.createHash('sha1');
      const out = fs.createWriteStream(tmp);
      for await (const chunk of Readable.fromWeb(res.body)) {
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
      }
      await new Promise((resolve, reject) => out.end(err => (err ? reject(err) : resolve())));
      const got = hash.digest('hex');
      if (sha1 && got !== sha1) throw new Error(`sha1 mismatch for ${url} (expected ${sha1}, got ${got})`);
      await fsp.rename(tmp, dest);
      return true;
    } catch (err) {
      lastErr = err;
      await fsp.rm(tmp, { force: true });
      if (attempt < retries) await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Downloads a JSON file to disk (verified) and returns its parsed contents.
async function cachedJson(url, dest, sha1) {
  await downloadFile(url, dest, { sha1 });
  return JSON.parse(await fsp.readFile(dest, 'utf8'));
}

// Runs async jobs with bounded concurrency, reporting progress after each one.
async function runPool(jobs, concurrency, onProgress) {
  let next = 0, done = 0;
  const total = jobs.length;
  onProgress?.(0, total);
  async function worker() {
    while (next < total) {
      const job = jobs[next++];
      await job();
      onProgress?.(++done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
}

module.exports = { exists, sha1File, downloadFile, fetchJson, cachedJson, runPool };
