const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Dark theme for system
nativeTheme.themeSource = 'dark';

app.setName('AI Translate');

// Register 'localfile:' as a privileged custom scheme BEFORE app is ready.
// Required so that dynamic import() calls from renderer can load local ESM modules
// (pdfjs-dist) without needing webSecurity:false.
// 'supportFetchAPI: true' is needed for net.fetch() in the protocol handler.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'localfile',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    frame: false,          // Custom titlebar
    transparent: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,       // Required for pdfjs worker (pdf.worker.min.mjs as SharedArrayBuffer)
      webSecurity: true,   // Restored — pdfjs served via custom 'localfile:' protocol
    },
    icon: path.join(__dirname, 'renderer', 'assets', 'icon.png'),
    show: false,
    titleBarStyle: 'hidden',
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Show window when ready (prevents flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // DevTools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

let settingsManager;
let historyManager;
let statsManager;
let checkpointManager;

// App Lifecycle
// ────────────────────────────────────────
app.whenReady().then(() => {
  // Settings and History (initialized after app is ready so safeStorage is available)
  const SettingsManager = require('./lib/settings-manager');
  settingsManager = new SettingsManager();

  const HistoryManager = require('./lib/history-manager');
  historyManager = new HistoryManager(app.getPath('userData'));

  const StatsManager = require('./lib/stats-manager');
  statsManager = new StatsManager(app.getPath('userData'));
  statsManager.ensureStatsInitialized(historyManager);

  const RunCheckpointManager = require('./lib/run-checkpoint-manager');
  checkpointManager = new RunCheckpointManager(app.getPath('userData'));
  // Runs abandoned long ago are never resumed — do not let them accumulate.
  checkpointManager.pruneOlderThan(7);

  // ── Register 'localfile:' custom protocol to serve local ESM modules (pdfjs) ──
  // This replaces webSecurity:false which was needed for file:// dynamic imports.
  // With this protocol, we can keep webSecurity:true for security.
  protocol.handle('localfile', (request) => {
    try {
      // request.url = 'localfile:///E:/Claude/Code/dich-thuat-ai/node_modules/pdfjs-dist/...'
      // Convert to file:// URL to get proper parsed pathname
      const fileUrl = request.url.replace(/^localfile:/, 'file:');
      const parsed = new URL(fileUrl);

      // pathname on Windows: '/E:/Claude/Code/...'
      // Remove leading slash on Windows to get 'E:/Claude/Code/...'
      let decodedPath = decodeURIComponent(parsed.pathname);
      if (process.platform === 'win32' && decodedPath.startsWith('/')) {
        decodedPath = decodedPath.slice(1);
      }

      const fullPath = path.normalize(decodedPath);
      const projectRoot = path.normalize(__dirname);
      const allowedBase = path.join(projectRoot, 'node_modules');

      // Security: restrict to node_modules only — never allow traversal outside
      if (!fullPath.startsWith(allowedBase + path.sep) && fullPath !== allowedBase) {
        console.error('[localfile] Blocked path traversal attempt:', fullPath);
        return new Response('Forbidden', { status: 403 });
      }

      // Serve the file
      return net.fetch(`file:///${fullPath.replace(/\\/g, '/')}`);
    } catch (err) {
      console.error('[localfile] Protocol error:', err.message);
      return new Response('Internal Error', { status: 500 });
    }
  });

  createWindow();
  buildMenu();

  // Register safe system directories for path traversal protection
  registerAllowedPath(app.getPath('userData'));
  registerAllowedPath(app.getPath('temp'));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ────────────────────────────────────────
// Menu
// ────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Mở tài liệu...',
          accelerator: 'CmdOrCtrl+O',
          click: () => { openFilePicker(); }
        },
        { type: 'separator' },
        {
          label: 'Thoát',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Về ứng dụng',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('nav:about');
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ────────────────────────────────────────
// Path & URL Security Validation
// ────────────────────────────────────────

const allowedPaths = new Set();

function registerAllowedPath(filePath) {
  if (!filePath) return;
  try {
    const resolved = path.resolve(filePath);
    allowedPaths.add(resolved);
  } catch (err) {
    console.error('Lỗi đăng ký đường dẫn được phép:', err);
  }
}

function isPathAllowed(filePath, isWrite = false) {
  if (!filePath) return false;
  try {
    const resolvedPath = path.resolve(filePath);
    
    // 1. Always allow paths that were explicitly selected by the user via dialog
    //    (registered via registerAllowedPath after dialog selection)
    for (const allowed of allowedPaths) {
      const resolvedAllowed = path.resolve(allowed);
      if (resolvedPath === resolvedAllowed || resolvedPath.startsWith(resolvedAllowed + path.sep)) {
        return true;
      }
    }
    
    // 2. Safe system directories — allow writes to user's common document folders.
    //    This covers save dialogs that return paths outside explicitly registered dirs.
    //    Read access to .pdf files is ONLY granted from these safe dirs, not globally.
    const safeReadDirs = [
      os.homedir(),
      app.getPath('documents'),
      app.getPath('downloads'),
      app.getPath('desktop'),
    ];
    const safeWriteDirs = [
      os.homedir(),
      app.getPath('documents'),
      app.getPath('downloads'),
      app.getPath('desktop'),
    ];

    const ext = path.extname(resolvedPath).toLowerCase();

    if (!isWrite && ext === '.pdf') {
      // PDF read: only from safe user directories (not arbitrary system paths)
      return safeReadDirs.some(d => resolvedPath.startsWith(path.normalize(d) + path.sep)
        || resolvedPath === path.normalize(d));
    }
    if (isWrite && (ext === '.md' || ext === '.txt' || ext === '.docx')) {
      // Write: only to safe user directories
      return safeWriteDirs.some(d => resolvedPath.startsWith(path.normalize(d) + path.sep)
        || resolvedPath === path.normalize(d));
    }
  } catch (err) {
    console.error('Lỗi kiểm tra đường dẫn:', err);
  }
  return false;
}

// ────────────────────────────────────────
// IPC Handlers
// ────────────────────────────────────────

// Window controls
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.restore();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

// File picker
async function openFilePicker() {
  if (!mainWindow) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn tài liệu cần dịch',
    filters: [
      { name: 'Tài liệu PDF', extensions: ['pdf'] }
    ],
    properties: ['openFile']
  });
  if (!canceled && filePaths.length > 0) {
    filePaths.forEach(p => registerAllowedPath(p));
    mainWindow.webContents.send('files:selected', filePaths);
  }
}

ipcMain.handle('dialog:openFiles', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn tài liệu cần dịch',
    filters: [
      { name: 'Tài liệu PDF', extensions: ['pdf'] }
    ],
    properties: ['openFile', 'multiSelections'] // Allow multiple files selection
  });
  if (!canceled && filePaths) {
    filePaths.forEach(p => registerAllowedPath(p));
  }
  return canceled ? [] : filePaths;
});

ipcMain.handle('dialog:saveFile', async (event, defaultName) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Lưu file Word',
    defaultPath: defaultName || 'output.docx',
    filters: [{ name: 'Word Document', extensions: ['docx'] }]
  });
  if (!canceled && filePath) {
    registerAllowedPath(filePath);
  }
  return canceled ? null : filePath;
});

ipcMain.handle('dialog:openFolder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn thư mục lưu',
    properties: ['openDirectory']
  });
  if (!canceled && filePaths && filePaths[0]) {
    registerAllowedPath(filePaths[0]);
  }
  return canceled ? null : filePaths[0];
});

ipcMain.handle('dialog:confirm', async (event, { message, title, type = 'question' }) => {
  if (!mainWindow) return false;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type,
    buttons: ['Xác nhận', 'Hủy bỏ'],
    defaultId: 0,
    cancelId: 1,
    title: title || 'Xác nhận',
    message: message
  });
  return response === 0;
});

ipcMain.handle('shell:openPath', async (event, filePath) => {
  if (!isPathAllowed(filePath)) {
    throw new Error('Đường dẫn không hợp lệ hoặc không được phép.');
  }
  try {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('File không tồn tại.');
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.sh', '.msi', '.com', '.scr', '.pif'];
    if (dangerousExtensions.includes(ext)) {
      throw new Error('Không thể mở file thực thi vì lý do bảo mật.');
    }
    await shell.openPath(resolvedPath);
  } catch (err) {
    console.error('Lỗi khi mở đường dẫn:', err);
    throw err;
  }
});

ipcMain.handle('shell:showItemInFolder', async (event, filePath) => {
  if (!isPathAllowed(filePath)) {
    throw new Error('Đường dẫn không hợp lệ hoặc không được phép.');
  }
  try {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error('File không tồn tại.');
    }
    shell.showItemInFolder(resolvedPath);
  } catch (err) {
    console.error('Lỗi khi mở file trong thư mục:', err);
    throw err;
  }
});

ipcMain.handle('shell:openExternal', async (event, url) => {
  if (!url) return;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      await shell.openExternal(url);
    } else {
      throw new Error('Chỉ chấp nhận các liên kết http:// hoặc https://');
    }
  } catch (err) {
    console.error('Lỗi khi mở liên kết ngoài:', err);
    throw err;
  }
});

// File system (async)
ipcMain.handle('fs:readFile', async (event, filePath) => {
  if (!isPathAllowed(filePath)) {
    throw new Error('Đường dẫn không hợp lệ hoặc không được phép.');
  }
  return fs.promises.readFile(filePath);
});

ipcMain.handle('fs:writeFile', async (event, filePath, buffer) => {
  if (!isPathAllowed(filePath, true)) {
    throw new Error('Đường dẫn lưu file không hợp lệ hoặc không được phép.');
  }
  if (buffer === null || buffer === undefined) {
    await fs.promises.writeFile(filePath, '');
  } else {
    const data = typeof buffer === 'string' ? buffer : Buffer.from(buffer);
    await fs.promises.writeFile(filePath, data);
  }
  return true;
});

ipcMain.handle('fs:stat', async (event, filePath) => {
  if (!isPathAllowed(filePath)) {
    throw new Error('Đường dẫn không hợp lệ hoặc không được phép.');
  }
  try {
    const stat = await fs.promises.stat(filePath);
    return { size: stat.size, mtime: stat.mtime };
  } catch {
    return null;
  }
});

// Settings and History Handlers (initialized inside app.whenReady)
ipcMain.handle('settings:load', () => settingsManager.getAll());
ipcMain.handle('settings:save', (event, settings) => settingsManager.saveAll(settings));
ipcMain.handle('settings:get', (event, key) => settingsManager.get(key));
ipcMain.handle('settings:set', (event, key, value) => settingsManager.set(key, value));

// AI Connection Test & Model Listing
ipcMain.handle('ai:testConnection', async (event, { provider, model }) => {
  const { testConnection } = require('./lib/ai-translate-engine');
  return testConnection(provider, model, settingsManager);
});

ipcMain.handle('ai:listModels', async (event, { provider }) => {
  const { listModels } = require('./lib/ai-translate-engine');
  return listModels(provider, settingsManager);
});

// History
ipcMain.handle('history:getAll', (event, { page, pageSize } = {}) => historyManager.getAll(page, pageSize));
ipcMain.handle('history:add', async (event, item) => {
  const id = await historyManager.addEntry(item);
  await statsManager.addRecord(item);
  return id;
});
ipcMain.handle('history:updateOutputPath', (event, { id, outputPath }) => historyManager.updateOutputPath(id, outputPath));
ipcMain.handle('history:updateEntry', (event, { id, fields }) => historyManager.updateEntry(id, fields));
ipcMain.handle('history:getMarkdown', (event, id) => historyManager.getMarkdown(id));
ipcMain.handle('history:delete', (event, id) => historyManager.deleteEntry(id));
ipcMain.handle('history:clear', () => historyManager.clearAll());

// Stats
// ── Run checkpoints ──────────────────────────────────────────────
// Each finished page is persisted immediately so a cancel or crash on page 2400
// of 2500 does not throw away the whole run.
ipcMain.handle('checkpoint:append', (event, { runId, record }) => checkpointManager.append(runId, record));
ipcMain.handle('checkpoint:read', (event, runId) => checkpointManager.read(runId));
ipcMain.handle('checkpoint:list', () => checkpointManager.list());
ipcMain.handle('checkpoint:clear', (event, runId) => checkpointManager.clear(runId));

ipcMain.handle('stats:getAll', () => statsManager.getAll());
ipcMain.handle('stats:deleteOlderThan', (event, days) => statsManager.deleteOlderThan(days));
ipcMain.handle('stats:clearAll', () => statsManager.clearAll());
ipcMain.handle('stats:add', async (event, record) => {
  await statsManager.addRecord(record);
});

// PDF Processing (delegated to renderer via IPC — heavy lifting in renderer using pdfjs)
// DOCX generation (in main process)
ipcMain.handle('docx:generate', async (event, { pages, settings, outputPath }) => {
  const DocxGenerator = require('./lib/docx-generator');
  const generator = new DocxGenerator(settings);
  return generator.generate(pages, outputPath);
});

// Track active AI requests for abort support
const activeAbortControllers = new Map();

ipcMain.on('ai:abort', (event, { requestId }) => {
  const controller = activeAbortControllers.get(requestId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(requestId);
  }
});

ipcMain.on('ai:abortAll', () => {
  for (const [id, controller] of activeAbortControllers) {
    controller.abort();
  }
  activeAbortControllers.clear();
});

// ============================================================================
// AI PROCESSING HANDLERS
// ============================================================================
// Flow:
// 1. Renderer (PDF.js) extracts raw image buffer of a PDF page.
// 2. Renderer sends buffer via IPC to main process (ai:extractPageText).
// 3. Main process calls Vertex AI to perform OCR/Text Extraction -> Markdown.
// 4. (Optional) Main process calls Vertex AI again to translate Markdown.
// 5. Results are returned to Renderer for UI display.
// ============================================================================

// Single page extract text / OCR (in main process — has access to AI SDKs)
ipcMain.handle('ai:extractPageText', async (event, { pageNum, base64, rawBuffer, settings, requestId }) => {
  const { buildProvider, DEFAULT_EXTRACT_PROMPT } = require('./lib/ai-translate-engine');
  const provider = buildProvider(settings.aiProvider, settingsManager);

  // rawBuffer = fast path (ArrayBuffer from renderer, Node wraps to Buffer)
  // base64 = legacy fallback
  const buf = rawBuffer
    ? Buffer.from(new Uint8Array(rawBuffer))
    : Buffer.from(base64, 'base64');

  const prompt = settings.customPrompt || DEFAULT_EXTRACT_PROMPT;
  
  const controller = new AbortController();
  activeAbortControllers.set(requestId, controller);

  try {
    const { text, usageStats } = await provider.processImageStream(buf, prompt, (chunk) => {
      event.sender.send('extract:chunk', { pageNum, chunk, requestId });
    }, { signal: controller.signal });

    // Send token usage stats to renderer
    if (usageStats) {
      event.sender.send('usage:stats', { pageNum, phase: 'extract', usageStats, requestId });
    }

    return text;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Đã hủy');
    throw new Error(`Trích xuất lỗi: ${err.message}`);
  } finally {
    activeAbortControllers.delete(requestId);
  }
});


// Single page translation (in main process)
ipcMain.handle('ai:translateText', async (event, { pageNum, text, targetLang, settings, requestId }) => {
  const { buildProvider } = require('./lib/ai-translate-engine');
  const provider = buildProvider(settings.aiProvider, settingsManager);

  const controller = new AbortController();
  activeAbortControllers.set(requestId, controller);

  try {
    const { text: resultText, bilingualSections, usageStats } = await provider.translateTextStream(
      text,
      targetLang,
      settings.sourceLanguage || 'auto',
      settings.translateMode === 'bilingual' || settings.bilingual,
      (chunk) => {
        event.sender.send('translate:chunk', { pageNum, chunk, requestId });
      },
      { signal: controller.signal }
    );

    const result = { text: resultText, bilingualSections, usageStats };

    // Send token usage stats to renderer
    if (result?.usageStats) {
      event.sender.send('usage:stats', { pageNum, phase: 'translate', usageStats: result.usageStats, requestId });
    }

    return result;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Đã hủy');
    throw new Error(`Dịch Lỗi: ${err.message}`);
  } finally {
    activeAbortControllers.delete(requestId);
  }
});
