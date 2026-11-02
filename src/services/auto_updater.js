const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temp, file);
}
function updateSettings(config = {}) {
  const cfg = config.updates || {};
  const repository = cfg.repository || 'romanich237/NewsDigestBot';
  const branch = cfg.branch || 'main';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w./-]+$/.test(branch) || branch.startsWith('-') || branch.includes('..')) throw new Error('Некорректные updates.repository или updates.branch');
  return { enabled: cfg.enabled !== false, autoInstall: cfg.autoInstall !== false, repository, branch,
    intervalSeconds: Math.max(60, Number(cfg.intervalSeconds) || 60) };
}

function recoverUpdate(root) {
  const dir = path.join(root, '.updates');
  const journalFile = path.join(dir, 'transaction.json');
  const journal = readJson(journalFile);
  if (!journal) return;
  if (journal.pid !== process.pid) {
    let alive = false;
    try { process.kill(journal.pid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
    if (alive) throw new Error('Другой процесс ещё устанавливает обновление');
  }
  const backup = path.join(dir, 'backup');
  for (const file of journal.affected) {
    const target = path.resolve(root, file);
    if (!target.startsWith(root + path.sep) || file.split('/').includes('..')) throw new Error('Некорректный журнал восстановления');
    if (journal.existed.includes(file)) {
      const source = path.join(backup, file);
      fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); fs.chmodSync(target, fs.statSync(source).mode);
    } else if (fs.existsSync(target)) fs.unlinkSync(target);
  }
  const modules = path.join(root, 'node_modules'), previous = path.join(dir, 'previous_modules');
  if (fs.existsSync(previous)) { fs.rmSync(modules, { recursive: true, force: true }); fs.renameSync(previous, modules); }
  else if (!journal.hadModules) fs.rmSync(modules, { recursive: true, force: true });
  if (journal.oldHead) {
    const result = spawnSync('git', ['reset', '--mixed', journal.oldHead], { cwd: root, stdio: 'ignore' });
    if (result.status !== 0) throw new Error('Не удалось восстановить Git после обновления');
  }
  const stateFile = path.join(dir, 'installed.json');
  if (journal.previousState) writeJson(stateFile, journal.previousState);
  else if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  for (const file of [journalFile, path.join(dir, 'control.json')]) if (fs.existsSync(file)) fs.unlinkSync(file);
  console.log('[UPDATE] Незавершённая установка отменена, предыдущие файлы восстановлены.');
}

class AutoUpdater {
  constructor(root, config, handlers = {}) {
    this.root = root; this.settings = updateSettings(config); this.handlers = handlers;
    this.dir = path.join(root, '.updates'); this.stopped = false; this.child = null;
  }
  start() {
    if (!this.settings.enabled) return;
    fs.mkdirSync(this.dir, { recursive: true });
    const control = path.join(this.dir, 'control.json');
    if (fs.existsSync(control)) fs.unlinkSync(control);
    const stateFile = path.join(this.dir, 'installed.json');
    const state = readJson(stateFile);
    if (state?.needsRestart) writeJson(stateFile, { ...state, needsRestart: false });
    this.timer = setInterval(() => this.poll(), 500);
    this.launch();
  }
  launch() {
    if (this.stopped) return;
    this.child = spawn(process.execPath, [path.join(this.root, 'src/updater.js')], {
      cwd: this.root, stdio: 'inherit', env: { ...process.env,
        NEWS_UPDATER_CAN_RESTART: process.env.pm_id !== undefined || process.env.INVOCATION_ID ? '1' : '0' }
    });
    this.child.on('error', error => console.error('[UPDATE]', error.message));
    this.child.on('exit', () => {
      this.child = null;
      if (!this.stopped) this.retry = setTimeout(() => this.launch(), 10000);
    });
  }
  poll() {
    const state = readJson(path.join(this.dir, 'control.json'));
    this.handlers.pause?.(!!state);
    if (!state) return;
    if (state.phase === 'drain' && !this.handlers.busy?.()) writeJson(path.join(this.dir, 'drained.json'), { id: state.id });
    if (state.phase === 'restart' && !this.handlers.busy?.()) {
      this.stop(); this.handlers.restart?.();
    }
  }
  stop() {
    this.stopped = true; clearInterval(this.timer); clearTimeout(this.retry);
    if (this.child) this.child.kill('SIGTERM');
  }
}
module.exports = { AutoUpdater, readJson, writeJson, updateSettings, recoverUpdate };
