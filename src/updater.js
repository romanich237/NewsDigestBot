const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execute = promisify(execFile);
const { readJson, writeJson, updateSettings, recoverUpdate } = require('./services/auto_updater');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ROOT = path.resolve(__dirname, '..');

async function run(cmd, args, cwd, timeout = 120000) {
  try { return (await execute(cmd, args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout; }
  catch (error) { throw new Error(`${cmd}: ${error.killed ? 'таймаут' : 'команда завершилась с ошибкой'}${error.code ? ` (${error.code})` : ''}`); }
}
function managed(file) {
  if (!file || /[\x00-\x1f]/.test(file) || file.includes('\\') || file.startsWith('/') || file.split('/').some(p => !p || p === '..' || p === '.')) return false;
  return !file.split('/').some(p => ['.git', '.updates', '.npm', 'node_modules', 'logs'].includes(p) || /^config\.json(?:\.|$)/.test(p) || /\.db(?:-shm|-wal)?$/.test(p));
}
function safePath(root, file) {
  if (!managed(file)) throw new Error(`Защищённый путь: ${file}`);
  let at = root;
  for (const part of file.split('/')) {
    at = path.join(at, part);
    if (fs.existsSync(at) && fs.lstatSync(at).isSymbolicLink()) throw new Error('Символьные ссылки в путях обновления не поддерживаются');
  }
  return at;
}
function copyFile(from, to) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
function removeFile(file) { if (fs.existsSync(file)) fs.unlinkSync(file); }
async function gitFiles(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return null;
  const dirty = await run('git', ['status', '--porcelain', '--untracked-files=no'], root);
  if (dirty.trim()) throw new Error('Есть локальные изменения отслеживаемых файлов. Обновление пропущено.');
  return (await run('git', ['ls-files', '-z'], root)).split('\0').filter(managed);
}
async function stageRevision(root, dir, settings, revision) {
  const mirror = path.join(dir, 'repository.git');
  if (!fs.existsSync(mirror)) await run('git', ['init', '--bare', mirror], root);
  const url = `https://github.com/${settings.repository}.git`;
  await run('git', ['--git-dir', mirror, 'fetch', '--depth=1', url, revision], root);
  const tree = await run('git', ['--git-dir', mirror, 'ls-tree', '-rz', revision], root);
  const entries = tree.split('\0').filter(Boolean).map(row => {
    const [meta, file] = row.split('\t');
    if (!/^(100644|100755) blob /.test(meta)) throw new Error('В обновлении есть неподдерживаемые типы файлов');
    return { file, executable: meta.startsWith('100755') };
  }).filter(e => managed(e.file));
  const stage = path.join(dir, 'stage'); fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage);
  // Extract only managed regular files, never repository-supplied symlinks or runtime data.
  for (const entry of entries) {
    const target = safePath(stage, entry.file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const blob = await execute('git', ['--git-dir', mirror, 'show', `${revision}:${entry.file}`], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
    fs.writeFileSync(target, blob.stdout, { mode: entry.executable ? 0o755 : 0o644 });
  }
  for (const { file } of entries.filter(e => /\.(?:js|cjs|mjs)$/.test(e.file))) await run(process.execPath, ['--check', path.join(stage, file)], root);
  const pkg = readJson(path.join(stage, 'package.json'));
  if (!pkg || !entries.some(e => e.file === 'src/main.js') || !entries.some(e => e.file === 'src/updater.js')) throw new Error('Неполное обновление NewsDigestBot');
  await run('npm', fs.existsSync(path.join(stage, 'package-lock.json')) ? ['ci', '--omit=dev', '--no-audit', '--no-fund'] : ['install', '--omit=dev', '--no-audit', '--no-fund'], stage, 600000);
  return { stage, entries, mirror };
}
async function installFiles(root, dir, prepared, revision, previousFiles, oldHead) {
  const { stage, entries, mirror } = prepared;
  const files = entries.map(e => e.file);
  const affected = [...new Set([...previousFiles, ...files])];
  const backup = path.join(dir, 'backup'); fs.rmSync(backup, { recursive: true, force: true }); fs.mkdirSync(backup);
  const existed = [];
  for (const file of affected) {
    const src = safePath(root, file);
    if (fs.existsSync(src)) { if (!fs.lstatSync(src).isFile()) throw new Error(`Ожидался файл: ${file}`); copyFile(src, safePath(backup, file)); existed.push(file); }
  }
  const modules = path.join(root, 'node_modules'), oldModules = path.join(dir, 'previous_modules');
  fs.rmSync(oldModules, { recursive: true, force: true });
  writeJson(path.join(dir, 'transaction.json'), { pid: process.pid, affected, existed, oldHead, hadModules: fs.existsSync(modules), previousState: readJson(path.join(dir, 'installed.json')) });
  try {
    if (fs.existsSync(modules)) fs.renameSync(modules, oldModules);
    if (fs.existsSync(path.join(stage, 'node_modules'))) fs.renameSync(path.join(stage, 'node_modules'), modules);
    for (const file of previousFiles.filter(f => !files.includes(f))) removeFile(safePath(root, file));
    for (const entry of entries) {
      const target = safePath(root, entry.file);
      copyFile(path.join(stage, entry.file), target); fs.chmodSync(target, entry.executable ? 0o755 : 0o644);
    }
    if (oldHead) {
      await run('git', ['fetch', mirror, revision], root);
      // Keep working tree and Git index aligned; config/database are ignored and untouched.
      await run('git', ['reset', '--mixed', revision], root);
    }
    writeJson(path.join(dir, 'installed.json'), { revision, version: readJson(path.join(root, 'package.json'))?.version, installedAt: new Date().toISOString(), needsRestart: true, files, hashes: Object.fromEntries(files.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(safePath(root, file))).digest('hex')])) });
    removeFile(path.join(dir, 'transaction.json'));
  } catch (error) {
    recoverUpdate(root);
    throw error;
  }
}

async function waitForDrain(dir, id) {
  writeJson(path.join(dir, 'control.json'), { phase: 'drain', id });
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    if (readJson(path.join(dir, 'drained.json'))?.id === id) return;
    await delay(500);
  }
  throw new Error('Бот не освободил очередь за 10 минут; установка отменена');
}
async function check(root, settings, checkOnly = false) {
  const dir = path.join(root, '.updates'); fs.mkdirSync(dir, { recursive: true });
  const url = `https://github.com/${settings.repository}.git`;
  const remote = (await run('git', ['ls-remote', url, `refs/heads/${settings.branch}`], root)).trim().split(/\s/)[0];
  if (!/^[a-f0-9]{40}$/.test(remote)) throw new Error('Ветка GitHub не найдена');
  const git = fs.existsSync(path.join(root, '.git'));
  const oldHead = git ? (await run('git', ['rev-parse', 'HEAD'], root)).trim() : null;
  const installed = readJson(path.join(dir, 'installed.json'));
  const current = oldHead || installed?.revision;
  const status = { checkedAt: new Date().toISOString(), installed: current || null, available: remote, updateAvailable: current !== remote };
  writeJson(path.join(dir, 'status.json'), status);
  if (current === remote) {
    if (installed?.needsRestart && !checkOnly && process.env.NEWS_UPDATER_CAN_RESTART === '1') {
      const id = `${Date.now()}-${remote}`;
      await waitForDrain(dir, id);
      writeJson(path.join(dir, 'control.json'), { phase: 'restart', id, revision: remote });
      return true;
    }
    return false;
  }
  console.log(`[UPDATE] Доступен коммит ${remote.slice(0, 8)}`);
  if (checkOnly || !settings.autoInstall || process.env.NEWS_UPDATER_CAN_RESTART !== '1') return false;
  if (git) {
    const branch = (await run('git', ['branch', '--show-current'], root)).trim();
    if (branch !== settings.branch) throw new Error('Текущая Git-ветка не совпадает с updates.branch');
    await run('git', ['fetch', url, `refs/heads/${settings.branch}`], root);
    await run('git', ['merge-base', '--is-ancestor', oldHead, remote], root);
  } else if (installed?.hashes) {
    for (const [file, hash] of Object.entries(installed.hashes)) {
      if (!managed(file)) continue;
      const target = safePath(root, file);
      if (!fs.existsSync(target) || crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== hash) throw new Error('Есть локальные изменения файлов. Обновление пропущено.');
    }
  }
  const previousFiles = (await gitFiles(root)) || installed?.files?.filter(managed) || [];
  const prepared = await stageRevision(root, dir, settings, remote);
  // Recheck local files after downloads/dependency preparation.
  await gitFiles(root);
  const id = `${Date.now()}-${remote}`;
  try {
    await waitForDrain(dir, id);
    await installFiles(root, dir, prepared, remote, previousFiles, oldHead);
    writeJson(path.join(dir, 'status.json'), { ...status, installed: remote, updateAvailable: false, installedAt: new Date().toISOString() });
    writeJson(path.join(dir, 'control.json'), { phase: 'restart', id, revision: remote });
    console.log(`[UPDATE] Установлен ${remote.slice(0, 8)}. Перезапуск бота.`);
    return true;
  } catch (error) { removeFile(path.join(dir, 'control.json')); throw error; }
}
async function main() {
  if (process.argv.includes('--check')) {
    const settings = updateSettings(readJson(path.join(ROOT, 'config.json'), {}));
    await check(ROOT, settings, true);
    const status = readJson(path.join(ROOT, '.updates/status.json'));
    console.log(`[UPDATE] Установлено: ${status.installed || 'не определено'}, GitHub: ${status.available}. ${status.updateAvailable ? 'Есть обновление' : 'Актуальная версия'}`);
    return;
  }
  const dir = path.join(ROOT, '.updates'); fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'worker.lock');
  // Atomic mkdir locks separate workers; PID allows recovery after service termination.
  try { fs.mkdirSync(lock); } catch (error) {
    const owner = readJson(path.join(lock, 'owner.json'));
    if (!owner) {
      if (Date.now() - fs.statSync(lock).mtimeMs < 30000) return;
    } else {
    try { process.kill(owner.pid, 0); return; } catch (e) { if (e.code !== 'ESRCH') return; }
    }
    fs.rmSync(lock, { recursive: true, force: true }); fs.mkdirSync(lock);
  }
  writeJson(path.join(lock, 'owner.json'), { pid: process.pid });
  const cleanup = () => { fs.rmSync(lock, { recursive: true, force: true }); };
  process.once('SIGTERM', () => { cleanup(); process.exit(0); });
  process.once('SIGINT', () => { cleanup(); process.exit(0); });
  try {
    recoverUpdate(ROOT);
    do {
      const settings = updateSettings(readJson(path.join(ROOT, 'config.json'), {}));
      if (!settings.enabled) return;
      try { if (await check(ROOT, settings, process.argv.includes('--check'))) return; }
      catch (error) {
        console.error('[UPDATE]', error.message);
        const status = readJson(path.join(dir, 'status.json'), {});
        writeJson(path.join(dir, 'status.json'), { ...status, error: error.message, errorAt: new Date().toISOString() });
        if (process.argv.includes('--check')) process.exitCode = 1;
      }
      if (process.argv.includes('--check')) return;
      await delay(settings.intervalSeconds * 1000);
    } while (true);
  } finally { cleanup(); }
}
if (require.main === module) main().catch(error => { console.error('[UPDATE]', error.message); process.exitCode = 1; });
module.exports = { managed, safePath, installFiles, check, stageRevision, gitFiles };
