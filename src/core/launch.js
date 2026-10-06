// Builds the Java command line and starts the game.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { getManifest, resolveVersion, rulesAllow } = require('./versions');
const { installVersion } = require('./install');

const LAUNCHER_NAME = 'tatnatlauncher';
const LAUNCHER_VERSION = '0.4.0';

// Tuned for a smooth client: short G1 pauses, a young generation sized for Minecraft's
// short-lived allocations, no System.gc() stalls. IgnoreUnrecognizedVMOptions keeps the
// same list safe on every Java Mojang ships (8 for old versions up to 25 for new ones).
const PERFORMANCE_JVM_ARGS = [
  '-XX:+IgnoreUnrecognizedVMOptions',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+UseG1GC',
  '-XX:MaxGCPauseMillis=37',
  '-XX:+ParallelRefProcEnabled',
  '-XX:+DisableExplicitGC',
  '-XX:G1NewSizePercent=23',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1ReservePercent=20',
  '-XX:G1HeapRegionSize=16M',
  '-XX:G1MixedGCCountTarget=3',
  '-XX:InitiatingHeapOccupancyPercent=20',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:SurvivorRatio=32',
  '-XX:MaxTenuringThreshold=1',
  '-XX:+PerfDisableSharedMem',
  '-XX:+UseStringDeduplication',
];

// Same UUID the vanilla server assigns offline players: UUID.nameUUIDFromBytes("OfflinePlayer:<name>").
function offlineUuid(name) {
  const md5 = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5.toString('hex');
}

function expandArgs(list, vars, features) {
  const out = [];
  for (const arg of list) {
    if (typeof arg === 'string') { out.push(arg); continue; }
    if (!rulesAllow(arg.rules, features)) continue;
    out.push(...(Array.isArray(arg.value) ? arg.value : [arg.value]));
  }
  return out.map(a => a.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)));
}

async function launch({ root, gameDir = root, versionId, account, memoryMb = 4096, onProgress = () => {}, onLog = () => {} }) {
  fs.mkdirSync(gameDir, { recursive: true });

  onProgress('Loading version info', 0, 1);
  const manifest = await getManifest(root);
  const version = await resolveVersion(root, versionId, manifest);
  const inst = await installVersion({ root, gameDir, version, progress: onProgress });

  const online = account.type === 'microsoft';
  const sep = path.delimiter;
  const vars = {
    auth_player_name: account.name,
    version_name: version.id,
    game_directory: gameDir,
    assets_root: inst.assetsRoot,
    game_assets: inst.gameAssets,
    assets_index_name: version.assetIndex?.id || version.assets || 'legacy',
    auth_uuid: online ? account.uuid : offlineUuid(account.name),
    auth_access_token: online ? account.accessToken : '0',
    auth_session: online ? `token:${account.accessToken}:${account.uuid}` : '0',
    auth_xuid: online ? account.xuid : '0',
    clientid: '0',
    user_type: online ? 'msa' : 'legacy',
    user_properties: '{}',
    version_type: version.type || 'release',
    natives_directory: inst.nativesDir,
    library_directory: path.join(root, 'libraries'),
    classpath_separator: sep,
    classpath: inst.classpath.join(sep),
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
  };
  const features = {}; // no demo mode, custom resolution or quick play

  const jvmTemplate = version.arguments?.jvm?.length
    ? version.arguments.jvm
    : ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'];
  const gameTemplate = version.arguments?.game?.length
    ? version.arguments.game
    : (version.minecraftArguments || '').split(' ').filter(Boolean);

  const args = [
    `-Xmx${memoryMb}M`,
    `-Xms${Math.max(1024, Math.floor(memoryMb / 2))}M`, // less heap resizing mid-game
    ...PERFORMANCE_JVM_ARGS,
    ...expandArgs(jvmTemplate, vars, features),
    ...(inst.loggingArg ? [inst.loggingArg] : []),
    version.mainClass,
    ...expandArgs(gameTemplate, vars, features),
  ];

  onProgress('Starting Minecraft', 1, 1);
  // Never echo the access token into the console.
  const shown = args.map(a => (online && a.includes(account.accessToken) ? '<token>' : a.length > 200 ? '<classpath>' : a));
  onLog(`> ${inst.javaBin} ${shown.join(' ')}\n`);
  const child = spawn(inst.javaBin, args, { cwd: gameDir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  child.stdout.setEncoding('utf8').on('data', onLog);
  child.stderr.setEncoding('utf8').on('data', onLog);
  // A notch above normal so background apps don't steal frames from the game.
  try { os.setPriority(child.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL); } catch { /* not allowed - fine */ }
  return child;
}

module.exports = { launch, getManifest, offlineUuid };
