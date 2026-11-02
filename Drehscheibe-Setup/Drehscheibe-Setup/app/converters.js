'use strict';
// Umwandlungs-Logik der Drehscheibe (läuft im Hauptprozess, nutzt ffmpeg, tar und optional LibreOffice).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const NORM = { jpeg: 'jpg', tiff: 'tif', htm: 'html', tgz: 'tar.gz', oga: 'ogg' };
function extOf(p) {
  const n = path.basename(p).toLowerCase();
  if (n.endsWith('.tar.gz')) return 'tar.gz';
  const e = path.extname(n).slice(1);
  return NORM[e] || e;
}
const KINDS = {
  image: ['png', 'jpg', 'webp', 'bmp', 'tif', 'gif', 'ico', 'heic', 'avif'],
  video: ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv', 'flv'],
  audio: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac', 'opus', 'wma'],
  text: ['txt', 'md', 'html', 'csv', 'json'],
  office: ['docx', 'doc', 'odt', 'rtf', 'xlsx', 'pptx', 'ods', 'odp'],
  archive: ['zip', 'tar', 'tar.gz', '7z', 'rar'],
};
function kindOf(p) {
  const e = extOf(p);
  for (const k in KINDS) if (KINDS[k].includes(e)) return k;
  return null;
}

const L = (id, l, s, ext) => ({ id, l, s: s || '', ext: ext || id });

function optionsFor(p, env = {}) {
  const e = extOf(p), k = kindOf(p);
  let o = [];
  if (k === 'image') {
    o = [L('jpg', 'JPG'), L('jpg70', 'JPG', '70 %', 'jpg'), L('png', 'PNG'), L('webp', 'WEBP'), L('bmp', 'BMP'),
      L('tif', 'TIFF'), L('ico', 'ICO'), L('pdf', 'PDF'), L('half', 'Halbe Größe', 'selbes Format', e)];
  } else if (k === 'video') {
    o = [L('mp4', 'MP4'), L('mp4_720', 'MP4', '720p', 'mp4'), L('hevc', 'MP4', 'HEVC', 'mp4'), L('webm', 'WEBM'), L('mov', 'MOV'),
      L('avi', 'AVI'), L('mkv', 'MKV'), L('gif', 'GIF'), L('mp3', 'MP3'), L('srt', 'Untertitel', 'SRT')];
  } else if (k === 'audio') {
    o = [L('mp3', 'MP3'), L('m4a', 'M4A'), L('wav', 'WAV'), L('ogg', 'OGG'), L('flac', 'FLAC')];
  } else if (k === 'text') {
    const M = { txt: ['pdf', 'html', 'md'], md: ['pdf', 'html', 'txt'], html: ['pdf', 'txt', 'md'], csv: ['json', 'html', 'txt'], json: ['csv', 'html', 'txt'] };
    o = (M[e] || []).map((x) => L(x, x.toUpperCase(), e === 'csv' && x === 'txt' ? 'TSV' : ''));
  } else if (k === 'office') {
    if (!env.soffice) return [];
    const word = ['pdf', 'docx', 'odt', 'txt', 'html', 'epub'], sheet = ['pdf', 'xlsx', 'ods', 'csv', 'html'], slides = ['pdf', 'pptx', 'odp'];
    const list = ['xlsx', 'ods'].includes(e) ? sheet : ['pptx', 'odp'].includes(e) ? slides : word;
    o = list.map((x) => L(x, x.toUpperCase()));
  } else if (k === 'archive') {
    o = [L('zip', 'ZIP'), L('tar', 'TAR'), L('tar.gz', 'TAR.GZ')];
  }
  return o.filter((x) => x.id === 'half' || x.id === 'jpg70' || x.id !== e);
}

function uniqueOut(src, suffix, ext) {
  const dir = path.dirname(src);
  const name = path.basename(src);
  const base = name.toLowerCase().endsWith('.tar.gz') ? name.slice(0, -7) : name.replace(/\.[^.]*$/, '');
  let out = path.join(dir, base + suffix + '.' + ext), n = 0;
  while (fs.existsSync(out)) out = path.join(dir, `${base}${suffix}-${++n}.${ext}`);
  return out;
}

function runProc(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawn(cmd, args, { windowsHide: true, ...opts.spawn }); } catch (e) { return reject(e); }
    let err = '', out = '';
    p.on('error', (e) => reject(new Error(e.code === 'ENOENT' ? `Programm nicht gefunden: ${path.basename(cmd)}` : e.message)));
    p.stderr.on('data', (d) => { err = (err + d).slice(-6000); opts.onErr && opts.onErr(err); });
    p.stdout.on('data', (d) => { out = (out + d).slice(-6000); opts.onOut && opts.onOut(String(d)); });
    p.on('close', (code) => {
      if (code === 0) resolve({ out, err });
      else {
        const lines = err.trim().split(/\r?\n/).filter(Boolean);
        reject(new Error(lines[lines.length - 1] || `Fehlercode ${code}`));
      }
    });
  });
}

function runFfmpeg(ctx, args) {
  if (!ctx.ffmpeg) throw new Error('ffmpeg fehlt. Bitte Installieren.bat erneut ausführen.');
  let dur = 0;
  return runProc(ctx.ffmpeg, ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args], {
    onErr: (err) => {
      if (!dur) {
        const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
        if (m) dur = +m[1] * 3600 + +m[2] * 60 + +m[3];
      }
    },
    onOut: (s) => {
      const m = [...s.matchAll(/out_time_(?:us|ms)=(\d+)/g)].pop();
      if (m && dur) ctx.onPct(Math.min(99, Math.round((+m[1] / 1e6 / dur) * 100)));
    },
  });
}

/* ---------- Bilder (ffmpeg, PDF über Chromium) ---------- */
const FLAT = 'split[a][b];[a]drawbox=c=white:t=fill[bg];[bg][b]overlay=format=auto,format=rgb24';
async function convImage(src, id, ext, out, ctx) {
  if (id === 'pdf') return imageToPdf(src, out, ctx);
  const pre = [];
  if (id === 'half') pre.push('scale=trunc(iw/4)*2:trunc(ih/4)*2');
  if (id === 'ico') pre.push('scale=min(256\\,iw):min(256\\,ih):force_original_aspect_ratio=decrease');
  const flat = ext === 'jpg' || ext === 'bmp';
  let vf = pre.join(',');
  if (flat) vf = (vf ? vf + ',' : '') + FLAT;
  const a = ['-i', src, '-frames:v', '1'];
  if (vf) a.push('-vf', vf);
  if (ext === 'jpg') a.push('-q:v', id === 'jpg70' ? '6' : '2');
  else if (ext === 'webp') a.push('-c:v', 'libwebp', '-quality', '85');
  else if (ext === 'tif') a.push('-c:v', 'tiff');
  a.push(out);
  await runFfmpeg(ctx, a);
}
async function imageToPdf(src, out, ctx) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dreh-'));
  try {
    let img = src;
    const e = extOf(src);
    if (!['png', 'jpg'].includes(e)) { img = path.join(tmp, 'bild.png'); await runFfmpeg(ctx, ['-i', src, '-frames:v', '1', img]); }
    const size = ctx.imageSize(img);
    const html = path.join(tmp, 'seite.html');
    const url = require('url').pathToFileURL(img).href;
    fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>@page{size:${size.width}px ${size.height}px;margin:0}html,body{margin:0}img{display:block;width:${size.width}px;height:${size.height}px}</style><img src="${url}">`);
    fs.writeFileSync(out, await ctx.printToPDF(html, { preferCSSPageSize: true, printBackground: true }));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

/* ---------- Audio / Video ---------- */
async function convAV(src, id, ext, out, ctx, kind) {
  const a = ['-i', src];
  switch (id) {
    case 'mp3': a.push('-vn', '-c:a', 'libmp3lame', '-b:a', '192k'); break;
    case 'm4a': a.push('-vn', '-c:a', 'aac', '-b:a', '192k'); break;
    case 'wav': a.push('-vn', '-c:a', 'pcm_s16le'); break;
    case 'ogg': a.push('-vn', '-c:a', 'libvorbis', '-q:a', '5'); break;
    case 'flac': a.push('-vn', '-c:a', 'flac'); break;
    case 'srt': a.push('-map', '0:s:0'); break;
    case 'mp4': case 'mov':
      a.push('-c:v', 'libx264', '-crf', '23', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k'); if (id === 'mp4') a.push('-movflags', '+faststart'); break;
    case 'mp4_720':
      a.push('-vf', 'scale=-2:min(720\\,ih)', '-c:v', 'libx264', '-crf', '23', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart'); break;
    case 'hevc':
      a.push('-c:v', 'libx265', '-crf', '28', '-preset', 'fast', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'); break;
    case 'webm':
      a.push('-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-row-mt', '1', '-c:a', 'libopus'); break;
    case 'avi':
      a.push('-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'libmp3lame', '-q:a', '4'); break;
    case 'mkv':
      try { await runFfmpeg(ctx, [...a, '-c', 'copy', out]); return; } catch (e) { a.push('-c:v', 'libx264', '-crf', '23', '-preset', 'fast', '-c:a', 'aac'); } break;
    case 'gif':
      a.push('-vf', 'fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse', '-loop', '0'); break;
  }
  a.push(out);
  try { await runFfmpeg(ctx, a); }
  catch (e) {
    if (id === 'srt') throw new Error('In diesem Video sind keine Untertitel enthalten.');
    throw e;
  }
}

/* ---------- Text ---------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function mdToHtml(t) {
  const inl = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  let out = '', list = false, para = [];
  const flush = () => { if (para.length) { out += '<p>' + inl(para.join(' ')) + '</p>'; para = []; } };
  const close = () => { if (list) { out += '</ul>'; list = false; } };
  for (const ln of t.split(/\r?\n/)) {
    let m;
    if ((m = /^(#{1,6})\s+(.*)/.exec(ln))) { flush(); close(); out += `<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`; }
    else if ((m = /^\s*[-*]\s+(.*)/.exec(ln))) { flush(); if (!list) { out += '<ul>'; list = true; } out += '<li>' + inl(m[1]) + '</li>'; }
    else if (!ln.trim()) { flush(); close(); }
    else { close(); para.push(ln.trim()); }
  }
  flush(); close(); return out;
}
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function htmlToText(h) {
  h = h.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');
  h = h.replace(/<br\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '\n- ').replace(/<\/(p|div|h[1-6]|li|tr|ul|ol|table|pre|blockquote)>/gi, '\n').replace(/<\/t[dh]>/gi, '\t');
  return decode(h.replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function htmlToMd(h) {
  h = h.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '');
  h = h.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => '\n\n' + '#'.repeat(+n) + ' ' + t.replace(/<[^>]+>/g, '').trim() + '\n\n')
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)').replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<li[^>]*>/gi, '\n- ').replace(/<\/p>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n');
  return decode(h.replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function parseCSV(t) {
  const first = t.split('\n')[0], delim = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}
const toCSV = (rows) => rows.map((r) => r.map((x) => { x = x == null ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x); return /[",\n;]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(',')).join('\n');
const wrapHtml = (title, body) => `<!doctype html><html lang="de"><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:16px/1.6 "Segoe UI",system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:.3rem .6rem;text-align:left}pre{white-space:pre-wrap}</style><body>${body}</body></html>`;

async function convText(src, id, ext, out, ctx) {
  const e = extOf(src);
  const t = fs.readFileSync(src, 'utf8').replace(/^﻿/, '');
  let text = '', html = '', md = '', rows = null, data;
  if (e === 'txt') { text = t; md = t; html = '<p>' + esc(t).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>') + '</p>'; }
  else if (e === 'md') { md = t; html = mdToHtml(t); text = htmlToText(html); }
  else if (e === 'html') { html = t; text = htmlToText(t); md = htmlToMd(t); }
  else if (e === 'csv') rows = parseCSV(t);
  else if (e === 'json') { try { data = JSON.parse(t); } catch (x) { throw new Error('Das ist kein gültiges JSON.'); } }
  const name = path.basename(src).replace(/\.[^.]*$/, '');
  const body = rows ? '<table>' + rows.map((r, i) => '<tr>' + r.map((c) => `<${i ? 'td' : 'th'}>${esc(c)}</${i ? 'td' : 'th'}>`).join('') + '</tr>').join('') + '</table>'
    : data !== undefined ? '<pre>' + esc(JSON.stringify(data, null, 2)) + '</pre>' : html;
  if (id === 'txt') fs.writeFileSync(out, rows ? rows.map((r) => r.join('\t')).join('\n') : data !== undefined ? JSON.stringify(data, null, 2) : text);
  else if (id === 'md') fs.writeFileSync(out, md);
  else if (id === 'html') fs.writeFileSync(out, wrapHtml(name, body));
  else if (id === 'json') { const h = rows[0] || []; fs.writeFileSync(out, JSON.stringify(rows.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? '']))), null, 2)); }
  else if (id === 'csv') {
    const arr = Array.isArray(data) ? data : [data];
    if (!arr.every((x) => x && typeof x === 'object' && !Array.isArray(x))) throw new Error('Das JSON ist keine Liste von Objekten.');
    const keys = [...new Set(arr.flatMap(Object.keys))];
    fs.writeFileSync(out, toCSV([keys, ...arr.map((x) => keys.map((k) => x[k]))]));
  } else if (id === 'pdf') {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dreh-'));
    try {
      const f = path.join(tmp, 'doc.html');
      fs.writeFileSync(f, e === 'html' ? html : wrapHtml(name, e === 'txt' ? '<div style="white-space:pre-wrap">' + esc(t) + '</div>' : body));
      fs.writeFileSync(out, await ctx.printToPDF(f, { pageSize: 'A4', printBackground: true, margins: { top: 0.7, bottom: 0.7, left: 0.8, right: 0.8 } }));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
}

/* ---------- Office (LibreOffice) und Archive (tar) ---------- */
async function convOffice(src, id, ext, out, ctx) {
  if (!ctx.soffice) throw new Error('Für Office-Dateien braucht die Drehscheibe LibreOffice.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dreh-'));
  try {
    const profile = 'file:///' + path.join(tmp, 'profil').replace(/\\/g, '/');
    const filter = { txt: 'txt:Text', csv: 'csv' }[id] || id;
    await runProc(ctx.soffice, ['--headless', '--norestore', `-env:UserInstallation=${profile}`, '--convert-to', filter, '--outdir', tmp, src]);
    const res = path.join(tmp, path.basename(src).replace(/\.[^.]*$/, '') + '.' + ext);
    if (!fs.existsSync(res)) throw new Error('LibreOffice hat keine Datei erzeugt.');
    fs.copyFileSync(res, out);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
async function convArchive(src, id, ext, out, ctx) {
  const tar = ctx.tar || 'tar';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dreh-'));
  try {
    await runProc(tar, ['-xf', src, '-C', tmp]);
    const flags = id === 'zip' ? ['-a', '-c', '-f', out] : id === 'tar' ? ['-c', '-f', out] : ['-c', '-z', '-f', out];
    await runProc(tar, [...flags, '-C', tmp, '.']);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function convert(src, id, ctx) {
  const k = kindOf(src), e = extOf(src);
  const opt = optionsFor(src, { soffice: !!ctx.soffice }).find((o) => o.id === id);
  if (!opt) throw new Error('Dieses Format ist für die Datei nicht verfügbar.');
  let ext = opt.ext, suffix = '';
  if (id === 'half') { ext = ['png', 'jpg', 'webp', 'bmp', 'tif'].includes(e) ? e : 'png'; suffix = '-klein'; }
  if (id === 'jpg70') suffix = '-70';
  if (id === 'mp4_720') suffix = '-720p';
  if (id === 'hevc') suffix = '-hevc';
  const out = uniqueOut(src, suffix, ext);
  ctx.onPct(null);
  try {
    if (k === 'image') await convImage(src, id, ext, out, ctx);
    else if (k === 'video' || k === 'audio') await convAV(src, id, ext, out, ctx, k);
    else if (k === 'text') await convText(src, id, ext, out, ctx);
    else if (k === 'office') await convOffice(src, id, ext, out, ctx);
    else if (k === 'archive') await convArchive(src, id, ext, out, ctx);
    else throw new Error('Unbekannter Dateityp.');
  } catch (err) {
    try { fs.rmSync(out, { force: true }); } catch (_) { /* egal */ }
    throw err;
  }
  return out;
}

module.exports = { extOf, kindOf, optionsFor, convert, KINDS };
