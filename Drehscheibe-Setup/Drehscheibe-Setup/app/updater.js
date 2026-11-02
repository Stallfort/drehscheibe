'use strict';
// Prüft vor jedem Start auf GitHub, ob es eine neuere Version gibt, und zieht sie.
// Offline oder bei Fehlern startet die installierte Version einfach normal.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// GitHub-Repository, aus dem Updates geladen werden
const REPO = 'Stallfort/drehscheibe';
const BASE = `https://github.com/${REPO}/releases/latest/download`;

const newer = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
};
const run = (cmd, args) => new Promise((ok, fail) => execFile(cmd, args, { windowsHide: true }, (e) => (e ? fail(e) : ok())));

// Gibt true zurück, wenn aktualisiert wurde und die App neu startet.
async function checkAndUpdate() {
  if (!app.isPackaged && !fs.existsSync(path.join(path.dirname(process.execPath), 'resources', 'app'))) return false;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dreh-upd-'));
  try {
    const meta = await fetch(`${BASE}/version.json`, { signal: AbortSignal.timeout(4000) });
    if (!meta.ok) return false;
    const { version } = await meta.json();
    if (!version || !newer(version, app.getVersion())) return false;

    const res = await fetch(`${BASE}/app.zip`, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) return false;
    const zip = path.join(tmp, 'app.zip'), out = path.join(tmp, 'x');
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    fs.mkdirSync(out);
    await run('tar.exe', ['-xf', zip, '-C', out]);
    if (!fs.existsSync(path.join(out, 'main.js'))) return false;   // kaputtes Paket nicht übernehmen

    fs.cpSync(out, __dirname, { recursive: true, force: true });
    app.relaunch();
    app.exit(0);
    return true;
  } catch (e) {
    return false;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* egal */ }
  }
}

module.exports = { checkAndUpdate };
