// CurseForge modpack import (the .zip "Export profile" format: manifest.json + overrides/).
// Mod jars aren't inside those zips - only project/file IDs - and CurseForge's API needs a key.
// Mods whose authors block third-party downloads (downloadUrl = null) are never fetched; the
// player gets a link to download them by hand instead.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const { downloadFile } = require('./download');

const API = 'https://api.curseforge.com/v1';
const MINECRAFT = 432;
const CLASS_MODPACK = 4471;
const ALLOWED_HOSTS = ['edge.forgecdn.net', 'mediafilez.forgecdn.net', 'media.forgecdn.net'];

async function call(key, pathAndQuery, body) {
  const res = await fetch(API + pathAndQuery, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-api-key': key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 403) throw new Error('CurseForge did not accept the API key.');
  if (!res.ok) throw new Error(`CurseForge returned ${res.status}`);
  return res.json();
}

async function checkKey(key) {
  await call(key, `/games/${MINECRAFT}`);
  return true;
}

function readManifest(file) {
  try {
    const entry = new AdmZip(file).getEntry('manifest.json');
    if (!entry) return null;
    const m = JSON.parse(entry.getData().toString('utf8').replace(/^﻿/, ''));
    return m.manifestType === 'minecraftModpack' ? m : null;
  } catch {
    return null;
  }
}

// Downloads/places everything for a CurseForge manifest into `dir`.
// Returns the mods that need a manual download: [{ name, url }].
async function installManifestFiles({ dir, zip, manifest, key, onStatus = () => {}, safeJoin }) {
  const files = (manifest.files || []).filter(f => f.required !== false);
  const manual = [];

  if (key && files.length) {
    const fileInfo = (await call(key, '/mods/files', { fileIds: files.map(f => f.fileID) })).data || [];
    const mods = (await call(key, '/mods', { modIds: [...new Set(files.map(f => f.projectID))] })).data || [];
    const modById = new Map(mods.map(m => [m.id, m]));
    let done = 0;
    for (const f of files) {
      const info = fileInfo.find(i => i.id === f.fileID);
      const mod = modById.get(f.projectID);
      const name = mod?.name || info?.displayName || `Project ${f.projectID}`;
      const page = mod?.links?.websiteUrl ? `${mod.links.websiteUrl}/files/${f.fileID}` : `https://www.curseforge.com/projects/${f.projectID}`;
      const url = info?.downloadUrl;
      const host = url ? new URL(url).hostname : '';
      if (!info || !url || !ALLOWED_HOSTS.includes(host) || mod?.allowModDistribution === false) {
        manual.push({ name, url: page, fileName: info?.fileName || null });
        continue;
      }
      onStatus(`Downloading ${name}`, ++done, files.length);
      const sha1 = (info.hashes || []).find(h => h.algo === 1)?.value;
      // resource packs / shaders in a CF pack carry their own folder via classId; default is mods/
      const folder = mod?.classId === 12 ? 'resourcepacks' : mod?.classId === 6552 ? 'shaderpacks' : 'mods';
      await downloadFile(url, safeJoin(dir, `${folder}/${info.fileName}`), { sha1, size: info.fileLength });
    }
  } else {
    for (const f of files) manual.push({ name: `CurseForge project ${f.projectID}`, url: `https://www.curseforge.com/projects/${f.projectID}` });
  }

  const prefix = `${(manifest.overrides || 'overrides').replace(/\/$/, '')}/`;
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
    const dest = safeJoin(dir, entry.entryName.slice(prefix.length));
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, entry.getData());
  }
  return manual;
}

// Finds a CurseForge modpack by its website slug and downloads its newest file to a temp zip.
async function downloadModpackBySlug(key, slug) {
  const found = (await call(key, `/mods/search?gameId=${MINECRAFT}&classId=${CLASS_MODPACK}&slug=${encodeURIComponent(slug)}`)).data || [];
  const pack = found[0];
  if (!pack) throw new Error(`No CurseForge modpack called "${slug}".`);
  if (pack.allowModDistribution === false) throw new Error(`${pack.name}'s author doesn't allow downloads outside CurseForge.`);
  const fileId = pack.mainFileId || pack.latestFiles?.[0]?.id;
  const file = pack.latestFiles?.find(f => f.id === fileId) || (await call(key, `/mods/${pack.id}/files/${fileId}`)).data;
  if (!file?.downloadUrl) throw new Error(`${pack.name} can only be downloaded on CurseForge.`);
  const tmp = path.join(os.tmpdir(), `ttt-cf-${Date.now()}.zip`);
  await downloadFile(file.downloadUrl, tmp, { size: file.fileLength });
  return { tmp, name: pack.name, icon: pack.logo?.thumbnailUrl || null, projectId: pack.id };
}

module.exports = { checkKey, readManifest, installManifestFiles, downloadModpackBySlug };
