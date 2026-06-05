const { contextBridge, ipcRenderer, webUtils } = require('electron');

// ── Listener tracking (stays in preload scope, not exposed) ──
const ALLOWED_CHANNELS = ['files:selected', 'nav:about', 'extract:chunk', 'translate:chunk', 'usage:stats'];
const listenerRegistry = new Map(); // channel → [{callback, wrapped}]

function addListener(channel, callback) {
  if (!ALLOWED_CHANNELS.includes(channel)) return;
  const wrapped = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, wrapped);
  if (!listenerRegistry.has(channel)) listenerRegistry.set(channel, []);
  listenerRegistry.get(channel).push({ callback, wrapped });
}

function removeListener(channel, callback) {
  const list = listenerRegistry.get(channel);
  if (!list) return;
  const idx = list.findIndex(l => l.callback === callback);
  if (idx !== -1) {
    ipcRenderer.removeListener(channel, list[idx].wrapped);
    list.splice(idx, 1);
  }
}

function removeAllListeners(channel) {
  if (channel) {
    ipcRenderer.removeAllListeners(channel);
    listenerRegistry.delete(channel);
  } else {
    // Cleanup IPC data/chunk events (keep nav/menu listeners)
    ['extract:chunk', 'translate:chunk', 'usage:stats'].forEach(ch => {
      ipcRenderer.removeAllListeners(ch);
      listenerRegistry.delete(ch);
    });
  }
}

// Expose a safe, limited API to the renderer process
contextBridge.exposeInMainWorld('api', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
  },

  // File dialogs
  dialog: {
    openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
    saveFile: (defaultName) => ipcRenderer.invoke('dialog:saveFile', defaultName),
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  },

  // Shell operations
  shell: {
    openPath: (path) => ipcRenderer.invoke('shell:openPath', path),
    showInFolder: (path) => ipcRenderer.invoke('shell:showItemInFolder', path),
  },

  // File system
  fs: {
    readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
    writeFile: (path, buffer) => ipcRenderer.invoke('fs:writeFile', path, buffer),
    stat: (path) => ipcRenderer.invoke('fs:stat', path),
  },

  // Settings
  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (settings) => ipcRenderer.invoke('settings:save', settings),
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  },

  // AI
  ai: {
    testConnection: (opts) => ipcRenderer.invoke('ai:testConnection', opts),
    listModels: (opts) => ipcRenderer.invoke('ai:listModels', opts),
    abort: (requestId) => ipcRenderer.send('ai:abort', { requestId }),
    abortAll: () => ipcRenderer.send('ai:abortAll'),
  },

  // Single page text extraction
  extractPageText: (opts) => ipcRenderer.invoke('ai:extractPageText', opts),
  extractTextFromFile: (opts) => ipcRenderer.invoke('ai:extractTextFromFile', opts),
  
  // Single page translation
  translateText: (opts) => ipcRenderer.invoke('ai:translateText', opts),

  // DOCX generation (in main process)
  docx: {
    generate: (opts) => ipcRenderer.invoke('docx:generate', opts),
  },

  // History
  history: {
    getAll: () => ipcRenderer.invoke('history:getAll'),
    add: (entryData) => ipcRenderer.invoke('history:add', entryData),
    getMarkdown: (id) => ipcRenderer.invoke('history:getMarkdown', id),
    delete: (id) => ipcRenderer.invoke('history:delete', id),
    clear: () => ipcRenderer.invoke('history:clear')
  },

  // Event listeners (tracked for proper cleanup)
  on: addListener,
  off: removeListener,
  removeAllListeners: removeAllListeners,

  // Utility: get native file path from a dropped File object (Electron webUtils)
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
