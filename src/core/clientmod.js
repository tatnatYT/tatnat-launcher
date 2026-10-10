// The Eclipse Client mod (in-game menu, HUD editor, keystrokes, zoom...). It ships inside the
// launcher and is copied into a modded instance's mods folder right before launch when the
// setting is on, or removed when it's off. assets/mods/builds.json lists which jar covers which
// Minecraft versions on which loader (written by the mod project's bundle script).
const fs = require('fs');
const path = require('path');

const JAR_NAME = 'tatnat-client.jar';
const MODS_DIR = path.join(__dirname, '..', '..', 'assets', 'mods');

let builds = null;
function loadBuilds() {
  if (!builds) {
    try {
      builds = JSON.parse(fs.readFileSync(path.join(MODS_DIR, 'builds.json'), 'utf8')).builds || [];
    } catch {
      builds = [];
    }
  }
  return builds;
}

// "1.21.1" vs "1.21.10" compared number by number; missing parts count as 0.
function cmp(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Fabric, FPS Boost and Fabric modpacks all run the Fabric build.
function loaderKind(loader) {
  return loader === 'forge' || loader === 'neoforge' ? loader : 'fabric';
}

function bundledJar(mcVersion, loader = 'fabric') {
  const kind = loaderKind(loader);
  const b = loadBuilds().find(x => x.loader === kind && cmp(mcVersion, x.from) >= 0 && cmp(mcVersion, x.until) < 0);
  return b ? path.join(MODS_DIR, b.file) : null;
}

function isSupported(mcVersion, loader = 'fabric') {
  return Boolean(bundledJar(mcVersion, loader));
}

/**
 * Makes `<gameDir>/mods/tatnat-client.jar` match the setting. Returns 'added', 'updated',
 * 'removed', 'unchanged' or 'unsupported'.
 */
function sync({ gameDir, mcVersion, loader = 'fabric', enabled }) {
  const target = path.join(gameDir, 'mods', JAR_NAME);
  const src = bundledJar(mcVersion, loader);
  if (!enabled || !src) {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
      return 'removed';
    }
    return src ? 'unchanged' : 'unsupported';
  }
  // Read through fs so it also works from inside the packaged app.asar.
  const data = fs.readFileSync(src);
  if (fs.existsSync(target)) {
    const current = fs.readFileSync(target);
    if (current.equals(data)) return 'unchanged';
    fs.writeFileSync(target, data);
    return 'updated';
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return 'added';
}

module.exports = { sync, isSupported, bundledJar, JAR_NAME };
