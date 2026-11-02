'use strict';
const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, globalShortcut, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile, execFileSync } = require('child_process');
const { pathToFileURL } = require('url');
const conv = require('./converters');
const Wheel = require('./wheel');
const updater = require('./updater');

const isWin = process.platform === 'win32';
if (!app.requestSingleInstanceLock()) { app.quit(); }

let stageWin = null, wheelWin = null, toastWin = null, tray = null, poller = null, quitting = false;
let wheelReady = null;
let wheel = null;                      // offenes Rad: {files, opts, mode, origin, hover, timer}
const tools = { ffmpeg: null, soffice: null };
const settings = { ctrlClick: true, contextMenu: false, autostart: false };

/* ---------- Einstellungen ---------- */
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() { try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch (e) { /* erster Start */ } }
function saveSettings() { try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings)); } catch (e) { /* egal */ } }

/* ---------- Werkzeuge finden ---------- */
function canRun(cmd, args) { try { execFileSync(cmd, args, { stdio: 'ignore', windowsHide: true, timeout: 8000 }); return true; } catch (e) { return false; } }
function findTools() {
  const dir = path.dirname(process.execPath);
  const ff = [process.env.DREH_FFMPEG, path.join(dir, 'bin', 'ffmpeg.exe'), path.join(dir, 'bin', 'ffmpeg')].filter(Boolean).find((p) => fs.existsSync(p));
  tools.ffmpeg = ff || (canRun('ffmpeg', ['-version']) ? 'ffmpeg' : null);
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)'].filter(Boolean);
  const so = [process.env.DREH_SOFFICE, ...pf.map((p) => path.join(p, 'LibreOffice', 'program', 'soffice.exe'))].filter(Boolean).find((p) => fs.existsSync(p));
  tools.soffice = so || null;
}

/* ---------- Fenster ---------- */
const ICON = path.join(__dirname, 'icon.png');
const webPrefs = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false };

function showStage() {
  if (!stageWin) {
    stageWin = new BrowserWindow({
      width: 820, height: 640, minWidth: 560, minHeight: 480, backgroundColor: '#0d1321', title: 'Drehscheibe',
      icon: ICON, autoHideMenuBar: true, webPreferences: webPrefs,
    });
    stageWin.setMenuBarVisibility(false);
    stageWin.loadFile(path.join(__dirname, 'stage.html'));
    stageWin.on('close', (e) => { if (!quitting && tray) { e.preventDefault(); stageWin.hide(); } });
    stageWin.on('closed', () => { stageWin = null; });
  }
  stageWin.show(); stageWin.focus();
}

function createWheelWin() {
  wheelWin = new BrowserWindow({
    width: Wheel.S, height: Wheel.S, show: false, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true, webPreferences: webPrefs,
  });
  wheelWin.setIgnoreMouseEvents(true);
  wheelReady = new Promise((ok) => wheelWin.webContents.once('did-finish-load', ok));
  wheelWin.loadFile(path.join(__dirname, 'wheel.html'));
  wheelWin.on('closed', () => { wheelWin = null; });
}

function createToastWin() {
  toastWin = new BrowserWindow({
    width: 340, height: 80, show: false, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, focusable: false, hasShadow: false, alwaysOnTop: true, webPreferences: webPrefs,
  });
  toastWin.loadFile(path.join(__dirname, 'toast.html'));
  toastWin.on('closed', () => { toastWin = null; });
}

/* ---------- Rad am Mauszeiger ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

async function openWheelFor(files, mode) {
  files = files.filter((f) => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } });
  if (!files.length || wheel) return;
  const kind = conv.kindOf(files[0]);
  if (!kind) { toast('Dieses Dateiformat kann die Drehscheibe nicht umwandeln.'); return; }
  files = files.filter((f) => conv.kindOf(f) === kind);
  const opts = conv.optionsFor(files[0], { soffice: !!tools.soffice });
  if (!opts.length) { toast(kind === 'office' ? 'Für Office-Dateien braucht die Drehscheibe LibreOffice.' : 'Dafür gibt es keine Zielformate.'); return; }
  if (!wheelWin) createWheelWin();
  await wheelReady;
  if (wheel) return;
  const pt = screen.getCursorScreenPoint(), wa = screen.getDisplayNearestPoint(pt).workArea;
  const x = clamp(pt.x - Wheel.C, wa.x, wa.x + wa.width - Wheel.S), y = clamp(pt.y - Wheel.C, wa.y, wa.y + wa.height - Wheel.S);
  wheel = { files, opts, mode, origin: { x: x + Wheel.C, y: y + Wheel.C }, start: pt, hover: -2, timer: null };
  wheelWin.setBounds({ x, y, width: Wheel.S, height: Wheel.S });
  wheelWin.webContents.send('wheel:show', { opts, title: `${files.length} × ${conv.extOf(files[0]).toUpperCase()}`, mode });
  wheelWin.showInactive();
  wheelWin.setAlwaysOnTop(true, 'screen-saver');
  wheel.timer = setInterval(tickWheel, 16);
  try { globalShortcut.register('Escape', closeWheel); } catch (e) { /* egal */ }
  tickWheel();
}
function currentHover() {
  const c = screen.getCursorScreenPoint();
  return Wheel.hoverAt(c.x - wheel.origin.x, c.y - wheel.origin.y, wheel.opts.length);
}
function tickWheel() {
  if (!wheel || !wheelWin) return;
  const h = currentHover();
  if (h !== wheel.hover) { wheel.hover = h; wheelWin.webContents.send('wheel:hover', h); }
}
function closeWheel() {
  if (!wheel) return null;
  const w = wheel; wheel = null;
  clearInterval(w.timer);
  try { globalShortcut.unregister('Escape'); } catch (e) { /* egal */ }
  if (wheelWin) wheelWin.hide();
  return w;
}
function commitWheel() {
  if (!wheel) return;
  const h = currentHover();
  const w = closeWheel();
  if (w && h >= 0) runJobs(w.files, w.opts[h].id);
}

/* ---------- Maus-Beobachter (Windows) ---------- */
function startPoller() {
  stopPoller();
  let cmd, args;
  if (process.env.DREH_FAKE_POLLER) { cmd = 'node'; args = [process.env.DREH_FAKE_POLLER]; }
  else if (isWin) { cmd = 'powershell.exe'; args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'poll.ps1')]; }
  else return;
  let skipS = false, buf = '';
  poller = spawn(cmd, args, { windowsHide: true });
  poller.on('error', () => { poller = null; });
  poller.stdout.setEncoding('utf8');
  poller.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onPoll(line); }
  });
  function onPoll(line) {
    if (line === 'D1') { if (wheel && wheel.mode === 'sticky') { commitWheel(); skipS = true; } return; }
    if (line === 'D0') { if (wheel && wheel.mode === 'sticky') commitWheel(); return; }
    if (line[0] === 'S') {
      if (skipS) { skipS = false; return; }
      let files = []; try { files = JSON.parse(line.slice(1)); } catch (e) { return; }
      if (Array.isArray(files) && files.length) openWheelFor(files.filter((f) => conv.kindOf(f)), 'hold');
      return;
    }
    if (line === 'U' && wheel && wheel.mode === 'hold') {
      const c = screen.getCursorScreenPoint();
      if (Math.hypot(c.x - wheel.start.x, c.y - wheel.start.y) < 25) { wheel.mode = 'sticky'; wheelWin.webContents.send('wheel:mode', 'sticky'); }
      else commitWheel();
    }
  }
}
function stopPoller() { if (poller) { try { poller.kill(); } catch (e) { /* egal */ } poller = null; } }

/* ---------- Aufträge und Fortschritt ---------- */
let jobs = [], jobSeq = 0, queue = Promise.resolve(), toastTimer = null, lastPush = 0;

function pushToast(force) {
  const now = Date.now();
  if (!force && now - lastPush < 120) return;
  lastPush = now;
  if (!toastWin) createToastWin();
  const rows = jobs.slice(-5);
  const h = rows.length * 62 + 16;
  const wa = screen.getPrimaryDisplay().workArea;
  toastWin.setBounds({ x: wa.x + wa.width - 340 - 16, y: wa.y + wa.height - h - 16, width: 340, height: h });
  toastWin.webContents.send('toast:jobs', rows.map(({ id, name, label, pct, state, msg, out }) => ({ id, name, label, pct, state, msg, out })));
  toastWin.showInactive();
  clearTimeout(toastTimer);
  if (!jobs.some((j) => j.state === 'work')) toastTimer = setTimeout(() => { if (toastWin) toastWin.hide(); }, 8000);
}
function toast(msg) {
  jobs = jobs.filter((j) => j.state === 'work');
  jobs.push({ id: ++jobSeq, name: msg, label: '', pct: null, state: 'err', msg: '' });
  pushToast(true);
}

function imageSize(p) { const s = nativeImage.createFromPath(p).getSize(); return { width: s.width || 1024, height: s.height || 768 }; }
async function printToPDF(htmlPath, opts) {
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
  try {
    await w.loadURL(pathToFileURL(htmlPath).href);
    return await w.webContents.printToPDF(opts);
  } finally { w.destroy(); }
}

function runJobs(paths, optId) {
  jobs = jobs.filter((j) => j.state === 'work');
  for (const p of paths) {
    const opt = conv.optionsFor(p, { soffice: !!tools.soffice }).find((o) => o.id === optId);
    const job = { id: ++jobSeq, name: path.basename(p), label: opt ? (opt.id === 'half' ? '½ Größe' : opt.l + (opt.s ? ' ' + opt.s : '')) : optId, pct: null, state: 'work', out: null, msg: '' };
    jobs.push(job);
    queue = queue.then(async () => {
      try {
        job.out = await conv.convert(p, optId, {
          ffmpeg: tools.ffmpeg, soffice: tools.soffice, tar: 'tar', printToPDF, imageSize,
          onPct: (v) => { job.pct = v; pushToast(); },
        });
        job.state = 'ok'; job.pct = 100;
      } catch (e) { job.state = 'err'; job.msg = String((e && e.message) || e).slice(0, 140); }
      pushToast(true);
    });
  }
  pushToast(true);
}

/* ---------- Windows-Integration ---------- */
function setContextMenu(on) {
  if (!isWin) return;
  const key = 'HKCU\\Software\\Classes\\*\\shell\\Drehscheibe', exe = process.execPath, quiet = () => {};
  if (on) {
    execFile('reg', ['add', key, '/ve', '/d', 'Mit Drehscheibe umwandeln', '/f'], { windowsHide: true }, quiet);
    execFile('reg', ['add', key, '/v', 'Icon', '/d', exe, '/f'], { windowsHide: true }, quiet);
    execFile('reg', ['add', key, '/v', 'MultiSelectModel', '/d', 'Player', '/f'], { windowsHide: true }, quiet);
    execFile('reg', ['add', key + '\\command', '/ve', '/d', `"${exe}" "%1"`, '/f'], { windowsHide: true }, quiet);
  } else execFile('reg', ['delete', key, '/f'], { windowsHide: true }, quiet);
}
function applySetting(k, v) {
  settings[k] = !!v; saveSettings();
  if (k === 'ctrlClick') { v ? startPoller() : stopPoller(); }
  if (k === 'contextMenu') setContextMenu(!!v);
  if (k === 'autostart') { try { app.setLoginItemSettings({ openAtLogin: !!v, args: ['--hidden'] }); } catch (e) { /* egal */ } }
  buildTray();
}

function buildTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Bühne öffnen', click: showStage },
    { label: 'Strg + Klick auf Dateien', type: 'checkbox', checked: settings.ctrlClick, click: (m) => { applySetting('ctrlClick', m.checked); stageWin && stageWin.webContents.send('settings:changed'); } },
    { type: 'separator' },
    { label: 'Beenden', click: () => { quitting = true; app.quit(); } },
  ]));
}

/* ---------- Start mit Dateien (Rechtsklick-Menü) ---------- */
let argvFiles = [], argvTimer = null;
function takeArgs(argv) {
  const files = argv.slice(1).filter((a) => a && !a.startsWith('-') && (() => { try { return fs.statSync(a).isFile(); } catch (e) { return false; } })());
  if (!files.length) return false;
  argvFiles.push(...files);
  clearTimeout(argvTimer);
  argvTimer = setTimeout(() => { const f = argvFiles; argvFiles = []; openWheelFor(f, 'sticky'); }, 300);
  return true;
}

/* ---------- IPC ---------- */
ipcMain.handle('options', (_e, paths) => {
  const first = (paths || [])[0];
  if (!first) return null;
  const kind = conv.kindOf(first);
  if (!kind) return { kind: null, ext: conv.extOf(first), opts: [] };
  return { kind, ext: conv.extOf(first), opts: conv.optionsFor(first, { soffice: !!tools.soffice }) };
});
ipcMain.handle('run', (_e, paths, optId) => { runJobs(paths, optId); });
ipcMain.handle('env', () => ({ ffmpeg: !!tools.ffmpeg, soffice: !!tools.soffice, win: isWin }));
ipcMain.handle('settings:get', () => ({ ...settings }));
ipcMain.handle('settings:set', (_e, k, v) => { if (k in settings) applySetting(k, v); return { ...settings }; });
ipcMain.handle('open-folder', (_e, p) => { if (p) shell.showItemInFolder(p); });
ipcMain.handle('pick', async () => {
  const r = await dialog.showOpenDialog(stageWin, { properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});

/* ---------- Start ---------- */
app.on('second-instance', (_e, argv) => { if (!takeArgs(argv)) showStage(); });
app.on('window-all-closed', () => { /* läuft im Hintergrund weiter */ });
app.on('before-quit', () => { quitting = true; stopPoller(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });

app.whenReady().then(async () => {
  if (!process.env.DREH_TEST && await updater.checkAndUpdate()) return;   // neue Version gezogen: Neustart läuft
  loadSettings(); findTools();
  try { tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 })); tray.setToolTip('Drehscheibe'); tray.on('click', showStage); buildTray(); } catch (e) { tray = null; }
  createWheelWin();
  if (settings.ctrlClick) startPoller();
  const hidden = process.argv.includes('--hidden');
  if (!takeArgs(process.argv) && !hidden) showStage();
  if (process.env.DREH_TEST) global.__dreh = { openWheelFor, runJobs, commitWheel, closeWheel, jobs: () => jobs, wheel: () => wheel, tools };
});
