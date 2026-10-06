// Everything needed on disk before launch: client jar, libraries, natives, assets, Java runtime.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const AdmZip = require('adm-zip');
const { downloadFile, cachedJson, fetchJson, runPool, exists } = require('./download');
const { osName, rulesAllow } = require('./versions');

const LIBRARIES_URL = 'https://libraries.minecraft.net/';
const RESOURCES_URL = 'https://resources.download.minecraft.net/';
const JAVA_ALL_URL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const CONCURRENCY = 16;

// "group:artifact:version[:classifier][@ext]" -> maven path
function mavenPath(name) {
  let [coords, ext = 'jar'] = name.split('@');
  const [group, artifact, version, classifier] = coords.split(':');
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
  return [...group.split('.'), artifact, version, file].join('/');
}

// Dedupe key ignores the version, so a mod loader's newer lib wins over the base game's.
function libraryKey(name) {
  const [group, artifact, , classifier] = name.split('@')[0].split(':');
  return [group, artifact, classifier || ''].join(':');
}

function planLibraries(root, version) {
  const libDir = path.join(root, 'libraries');
  const seen = new Set();
  const downloads = []; // {url, dest, sha1, size}
  const classpath = [];
  const natives = []; // jar paths to extract into the natives folder
  const nativeKey = osName();
  const arch = process.arch === 'ia32' ? '32' : '64';

  for (const lib of version.libraries || []) {
    if (!rulesAllow(lib.rules)) continue;
    const key = libraryKey(lib.name);
    if (seen.has(key)) continue;
    seen.add(key);

    const artifact = lib.downloads?.artifact;
    if (artifact || !lib.downloads) {
      const rel = artifact?.path || mavenPath(lib.name);
      const url = artifact?.url || (lib.url || LIBRARIES_URL).replace(/\/?$/, '/') + rel;
      const dest = path.join(libDir, rel);
      if (url) downloads.push({ url, dest, sha1: artifact?.sha1 || lib.sha1, size: artifact?.size || lib.size });
      classpath.push(dest);
      // 1.19+ ship natives as ordinary artifacts named "...:natives-<os>".
      if (/:natives-/.test(lib.name)) natives.push(dest);
    }

    // Pre-1.19 style: natives live in a per-OS classifier jar.
    const classifierName = lib.natives?.[nativeKey]?.replace('${arch}', arch);
    const classifier = classifierName && lib.downloads?.classifiers?.[classifierName];
    if (classifier) {
      const dest = path.join(libDir, classifier.path);
      downloads.push({ url: classifier.url, dest, sha1: classifier.sha1, size: classifier.size });
      natives.push(dest);
    }
  }
  return { downloads, classpath, natives };
}

function extractNatives(jars, nativesDir) {
  fs.mkdirSync(nativesDir, { recursive: true });
  for (const jar of jars) {
    const zip = new AdmZip(jar);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || entry.entryName.startsWith('META-INF/')) continue;
      if (!/\.(dll|so|dylib|jnilib)$/i.test(entry.entryName)) continue;
      const dest = path.join(nativesDir, path.basename(entry.entryName));
      if (fs.existsSync(dest)) continue; // may be locked by an already-running game
      fs.writeFileSync(dest, entry.getData());
    }
  }
}

async function installAssets(root, gameDir, version, progress) {
  const idx = version.assetIndex;
  if (!idx) return { assetsRoot: path.join(root, 'assets'), gameAssets: path.join(root, 'assets') };
  const assetsRoot = path.join(root, 'assets');
  const index = await cachedJson(idx.url, path.join(assetsRoot, 'indexes', `${idx.id}.json`), idx.sha1);
  const objects = Object.entries(index.objects);

  const jobs = objects.map(([, { hash, size }]) => () =>
    downloadFile(`${RESOURCES_URL}${hash.slice(0, 2)}/${hash}`,
      path.join(assetsRoot, 'objects', hash.slice(0, 2), hash), { sha1: hash, size }));
  await runPool(jobs, CONCURRENCY, (d, t) => progress('Downloading assets', d, t));

  // Very old versions read assets from a flat folder instead of the hashed object store.
  let gameAssets = assetsRoot;
  if (index.virtual || index.map_to_resources) {
    gameAssets = index.map_to_resources ? path.join(gameDir, 'resources') : path.join(assetsRoot, 'virtual', idx.id);
    for (const [name, { hash, size }] of objects) {
      const dest = path.join(gameAssets, name);
      if (fs.existsSync(dest) && fs.statSync(dest).size === size) continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(path.join(assetsRoot, 'objects', hash.slice(0, 2), hash), dest);
    }
  }
  return { assetsRoot, gameAssets };
}

function javaPlatform() {
  const a = process.arch;
  if (process.platform === 'win32') return a === 'arm64' ? 'windows-arm64' : a === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (process.platform === 'darwin') return a === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return a === 'ia32' ? 'linux-i386' : 'linux';
}

// Installs Mojang's own Java build for this version, so no system Java is needed.
async function installJava(root, version, progress) {
  const component = version.javaVersion?.component || 'jre-legacy';
  const dir = path.join(root, 'runtime', component);
  const javaBin = process.platform === 'darwin'
    ? path.join(dir, 'jre.bundle', 'Contents', 'Home', 'bin', 'java')
    : path.join(dir, 'bin', process.platform === 'win32' ? 'javaw.exe' : 'java');
  const marker = path.join(dir, '.installed');
  if (await exists(marker) && await exists(javaBin)) return javaBin;

  progress('Fetching Java runtime info', 0, 1);
  const all = await fetchJson(JAVA_ALL_URL);
  const entry = all[javaPlatform()]?.[component]?.[0];
  if (!entry) throw new Error(`Mojang has no ${component} Java runtime for ${javaPlatform()}`);
  const manifest = await fetchJson(entry.manifest.url);

  const files = Object.entries(manifest.files);
  for (const [rel, f] of files) {
    if (f.type === 'directory') await fsp.mkdir(path.join(dir, rel), { recursive: true });
  }
  const jobs = files.filter(([, f]) => f.type === 'file').map(([rel, f]) => async () => {
    const dest = path.join(dir, rel);
    await downloadFile(f.downloads.raw.url, dest, { sha1: f.downloads.raw.sha1, size: f.downloads.raw.size });
    if (f.executable && process.platform !== 'win32') await fsp.chmod(dest, 0o755);
  });
  await runPool(jobs, CONCURRENCY, (d, t) => progress(`Downloading Java (${component})`, d, t));
  if (process.platform !== 'win32') {
    for (const [rel, f] of files) {
      if (f.type !== 'link') continue;
      const dest = path.join(dir, rel);
      await fsp.rm(dest, { force: true });
      await fsp.symlink(f.target, dest);
    }
  }
  await fsp.writeFile(marker, entry.version?.name || component);
  return javaBin;
}

async function installVersion({ root, gameDir, version, progress = () => {} }) {
  // Client jar
  const jarId = version.jar;
  const clientJar = path.join(root, 'versions', jarId, `${jarId}.jar`);
  const client = version.downloads?.client;
  if (client) {
    progress('Downloading client', 0, 1);
    await downloadFile(client.url, clientJar, { sha1: client.sha1, size: client.size });
    progress('Downloading client', 1, 1);
  } else if (!(await exists(clientJar))) {
    throw new Error(`No client jar available for ${version.id}`);
  }

  // Modern Forge/NeoForge load the game themselves and skip "${version_name}.jar" on the classpath
  // (their -DignoreList). Like the official launcher, keep a copy under the profile's own id.
  let classpathJar = clientJar;
  const jvmArgs = JSON.stringify(version.arguments?.jvm || []);
  if (jarId !== version.id && jvmArgs.includes('${version_name}.jar')) {
    classpathJar = path.join(root, 'versions', version.id, `${version.id}.jar`);
    const src = await fsp.stat(clientJar);
    const dst = await fsp.stat(classpathJar).catch(() => null);
    if (!dst || dst.size !== src.size) {
      await fsp.mkdir(path.dirname(classpathJar), { recursive: true });
      await fsp.copyFile(clientJar, classpathJar);
    }
  }

  // Libraries + natives
  const libs = planLibraries(root, version);
  await runPool(libs.downloads.map(d => () => downloadFile(d.url, d.dest, d)), CONCURRENCY,
    (d, t) => progress('Downloading libraries', d, t));
  const nativesDir = path.join(root, 'versions', version.id, 'natives');
  progress('Extracting natives', 0, 1);
  extractNatives(libs.natives, nativesDir);

  // Log4j config (also carries Mojang's Log4Shell mitigation)
  let loggingArg = null;
  const logging = version.logging?.client;
  if (logging?.file) {
    const dest = path.join(root, 'assets', 'log_configs', logging.file.id);
    await downloadFile(logging.file.url, dest, { sha1: logging.file.sha1, size: logging.file.size });
    loggingArg = logging.argument.replace('${path}', dest);
  }

  const assets = await installAssets(root, gameDir, version, progress);
  const javaBin = await installJava(root, version, progress);

  return {
    javaBin,
    nativesDir,
    loggingArg,
    classpath: [...libs.classpath, classpathJar],
    ...assets,
  };
}

module.exports = { installVersion, installJava, mavenPath };
