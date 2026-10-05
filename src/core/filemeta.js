// Reads display info (name, version, icon) straight out of mod jars and resource pack zips,
// so files the player adds by hand look as good as ones installed from Modrinth.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const MAX_ICON_BYTES = 256 * 1024;

function dataUrl(buf, name) {
  if (!buf || buf.length > MAX_ICON_BYTES) return null;
  const type = /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/png';
  return `data:${type};base64,${buf.toString('base64')}`;
}

function openZip(file) {
  try { return new AdmZip(file); } catch { return null; }
}

// Fabric (fabric.mod.json) with a Quilt fallback; anything else just shows its filename.
function readModMeta(file) {
  const fallback = { title: path.basename(file).replace(/\.jar(\.disabled)?$/i, ''), versionNumber: '', icon: null };
  const zip = openZip(file);
  if (!zip) return fallback;
  try {
    const entry = zip.getEntry('fabric.mod.json') || zip.getEntry('quilt.mod.json');
    if (!entry) return fallback;
    const json = JSON.parse(entry.getData().toString('utf8').replace(/^﻿/, ''));
    const meta = json.quilt_loader ? { ...json.quilt_loader, ...json.quilt_loader.metadata } : json;
    let iconPath = meta.icon;
    if (iconPath && typeof iconPath === 'object') iconPath = Object.values(iconPath).pop(); // size map
    const iconEntry = typeof iconPath === 'string' ? zip.getEntry(iconPath.replace(/^\//, '')) : null;
    return {
      title: meta.name || meta.id || fallback.title,
      versionNumber: String(meta.version || ''),
      icon: iconEntry ? dataUrl(iconEntry.getData(), iconPath) : null,
    };
  } catch {
    return fallback;
  }
}

// Resource packs are either .zip files or plain folders, both with an optional pack.png.
function readPackMeta(file) {
  const title = path.basename(file).replace(/\.zip$/i, '');
  try {
    if (fs.statSync(file).isDirectory()) {
      const png = path.join(file, 'pack.png');
      return { title, icon: fs.existsSync(png) ? dataUrl(fs.readFileSync(png), png) : null };
    }
    const zip = openZip(file);
    const entry = zip?.getEntry('pack.png');
    return { title, icon: entry ? dataUrl(entry.getData(), 'pack.png') : null };
  } catch {
    return { title, icon: null };
  }
}

module.exports = { readModMeta, readPackMeta };
