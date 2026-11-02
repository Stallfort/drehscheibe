'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (ch, cb) => { const h = (_e, ...a) => cb(...a); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); };

contextBridge.exposeInMainWorld('dreh', {
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } },
  options: (paths) => ipcRenderer.invoke('options', paths),
  run: (paths, optId) => ipcRenderer.invoke('run', paths, optId),
  env: () => ipcRenderer.invoke('env'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (k, v) => ipcRenderer.invoke('settings:set', k, v),
  openFolder: (p) => ipcRenderer.invoke('open-folder', p),
  pick: () => ipcRenderer.invoke('pick'),
  onWheelShow: (cb) => on('wheel:show', cb),
  onWheelHover: (cb) => on('wheel:hover', cb),
  onWheelMode: (cb) => on('wheel:mode', cb),
  onSettingsChanged: (cb) => on('settings:changed', cb),
  onJobs: (cb) => on('toast:jobs', cb),
});
