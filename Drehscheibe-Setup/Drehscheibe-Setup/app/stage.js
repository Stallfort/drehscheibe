'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const baseName = (p) => p.split(/[\\/]/).pop();
const extOf = (p) => { const n = baseName(p).toLowerCase(); if (n.endsWith('.tar.gz')) return 'tar.gz'; const m = /\.([^.]+)$/.exec(n); return m ? m[1] : ''; };

let files = [];          // {id,path,name,ext,kind,selected}
let uid = 0, wheel = null, press = null;

/* ---------- Dateien ---------- */
async function addPaths(paths) {
  for (const p of paths) {
    if (!p || files.some((f) => f.path === p)) continue;
    const info = await dreh.options([p]);
    files.push({ id: ++uid, path: p, name: baseName(p), ext: extOf(p), kind: info && info.kind, selected: false });
  }
  dreh.onSettingsChanged(loadSettings);
render();
}
function render() {
  const g = $('#grid');
  if (!files.length) {
    g.innerHTML = `<div class="empty"><b>Ziehe eine Datei auf die Bühne</b><span>Zum Beispiel ein Bild, ein Video, eine MP3 oder ein Textdokument.</span><button class="btn" id="pick2" type="button">Dateien wählen</button></div>`;
    $('#pick2').onclick = pick;
    return;
  }
  g.innerHTML = files.map((f) => `<div class="tile${f.kind ? '' : ' off'}${f.selected ? ' sel' : ''}" data-id="${f.id}">
    <button class="chk" data-chk type="button" aria-pressed="${f.selected}" aria-label="Für Stapel markieren"></button>
    <button class="rm" data-rm type="button" aria-label="Entfernen">×</button>
    <div class="thumb" style="--tc:var(--c-${f.kind || 'x'})"><span class="ext">${esc(f.ext || '?')}</span></div>
    <div class="meta"><b title="${esc(f.path)}">${esc(f.name)}</b><span>${f.kind ? 'bereit' : 'nicht unterstützt'}</span></div></div>`).join('');
}
const byId = (id) => files.find((f) => f.id == id);
async function pick() { addPaths(await dreh.pick()); }
$('#pick').onclick = pick;
$('#clear').onclick = () => { files = []; render(); };

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragenter', () => document.body.classList.add('dragging'));
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
window.addEventListener('drop', (e) => {
  e.preventDefault(); document.body.classList.remove('dragging');
  addPaths([...e.dataTransfer.files].map((f) => dreh.pathFor(f)));
});

/* ---------- Rad ---------- */
async function openWheel(f, x, y, mode) {
  if (wheel) return;
  const group = f.selected ? files.filter((g) => g.selected && g.kind === f.kind) : [f];
  const info = await dreh.options([f.path]);
  if (!info || !info.kind) { flash('Dieses Format kann die Drehscheibe nicht umwandeln.'); return; }
  if (!info.opts.length) { flash(info.kind === 'office' ? 'Für Office-Dateien braucht die Drehscheibe LibreOffice.' : 'Dafür gibt es keine Zielformate.'); return; }
  const cx = Math.min(Math.max(x, Wheel.S / 2 + 8), Math.max(Wheel.S / 2 + 8, innerWidth - Wheel.S / 2 - 8));
  const cy = Math.min(Math.max(y, Wheel.S / 2 + 8), Math.max(Wheel.S / 2 + 8, innerHeight - Wheel.S / 2 - 8));
  const layer = $('#layer');
  layer.style.setProperty('--wx', cx + 'px'); layer.style.setProperty('--wy', cy + 'px');
  layer.innerHTML = `<div class="wheel-box pop" style="left:${cx - Wheel.S / 2}px;top:${cy - Wheel.S / 2}px"></div>`;
  const ctl = Wheel.mount(layer.firstChild, { opts: info.opts, title: `${group.length} × ${info.ext.toUpperCase()}`, mode });
  wheel = { f, group, opts: info.opts, mode, cx, cy, ctl };
  document.body.classList.add('wheel-open');
  setHover(hoverFrom(x, y));
}
const hoverFrom = (x, y) => Wheel.hoverAt(x - wheel.cx, y - wheel.cy, wheel.opts.length);
const setHover = (i) => { wheel.hover = i; wheel.ctl.setHover(i); };
function closeWheel() { wheel = null; $('#layer').innerHTML = ''; document.body.classList.remove('wheel-open'); }
function finish(i) {
  const w = wheel; closeWheel();
  if (i >= 0) { dreh.run(w.group.map((g) => g.path), w.opts[i].id); }
}
function flash(msg) {
  const e = $('#env'); e.textContent = msg; e.classList.add('bad');
  clearTimeout(flash.t); flash.t = setTimeout(showEnv, 3500);
}

const grid = $('#grid');
grid.addEventListener('click', (e) => {
  const c = e.target.closest('[data-chk]'), r = e.target.closest('[data-rm]');
  if (c) { const f = byId(c.closest('.tile').dataset.id); if (f.kind) { f.selected = !f.selected; render(); } }
  if (r) { files = files.filter((g) => g !== byId(r.closest('.tile').dataset.id)); render(); }
});
grid.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.tile');
  if (!t || e.target.closest('[data-chk],[data-rm]') || wheel) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const f = byId(t.dataset.id);
  if (e.shiftKey) { e.preventDefault(); if (f.kind) { f.selected = !f.selected; render(); } return; }
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); openWheel(f, e.clientX, e.clientY, 'hold'); return; }
  press = { f, x: e.clientX, y: e.clientY, timer: setTimeout(() => { const p = press; press = null; if (p) openWheel(p.f, p.x, p.y, 'hold'); }, 380) };
});
window.addEventListener('pointermove', (e) => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; }
  if (wheel) setHover(hoverFrom(e.clientX, e.clientY));
});
window.addEventListener('pointerup', (e) => {
  if (press) { clearTimeout(press.timer); const p = press; press = null; openWheel(p.f, p.x, p.y, 'sticky'); return; }
  if (wheel && wheel.mode === 'hold') finish(hoverFrom(e.clientX, e.clientY));
});
window.addEventListener('pointerdown', (e) => {
  if (wheel && wheel.mode === 'sticky') { e.preventDefault(); e.stopPropagation(); finish(hoverFrom(e.clientX, e.clientY)); }
}, true);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && wheel) closeWheel(); });
window.addEventListener('contextmenu', (e) => e.preventDefault());

/* ---------- Einstellungen und Status ---------- */
let env = {};
function showEnv() {
  const e = $('#env'); e.classList.remove('bad');
  e.textContent = env.ffmpeg ? 'ffmpeg bereit' + (env.soffice ? ' · LibreOffice gefunden' : ' · ohne LibreOffice') : 'ffmpeg fehlt: Installieren.bat erneut ausführen';
  if (!env.ffmpeg) e.classList.add('bad');
}
async function loadSettings() {
  const s = await dreh.getSettings();
  for (const k of ['ctrlClick', 'contextMenu', 'autostart']) $('#s-' + k).checked = !!s[k];
}
for (const k of ['ctrlClick', 'contextMenu', 'autostart']) $('#s-' + k).addEventListener('change', (e) => dreh.setSetting(k, e.target.checked));
(async () => { env = await dreh.env(); showEnv(); loadSettings(); if (!env.win) { $('#s-ctrlClick').disabled = $('#s-contextMenu').disabled = $('#s-autostart').disabled = true; } })();
dreh.onSettingsChanged(loadSettings);
render();
