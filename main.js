const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

// Dark theme for system
nativeTheme.themeSource = 'dark';

app.setName('AI Translate');

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
      sandbox: false,        // Required for pdfjs worker
      webSecurity: false,    // Allow dynamic import of local file:// ESM modules (pdfjs)
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

// ────────────────────────────────────────
// App Lifecycle
// ────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  buildMenu();

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
      { name: 'Tất cả file hỗ trợ', extensions: ['pdf', 'docx', 'pptx', 'jpg', 'jpeg', 'png'] },
      { name: 'Tài liệu', extensions: ['pdf', 'docx', 'pptx'] },
      { name: 'Hình ảnh', extensions: ['jpg', 'jpeg', 'png'] }
    ],
    properties: ['openFile']
  });
  if (!canceled && filePaths.length > 0) {
    mainWindow.webContents.send('files:selected', filePaths);
  }
}

ipcMain.handle('dialog:openFiles', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn tài liệu cần dịch',
    filters: [
      { name: 'Tất cả file hỗ trợ', extensions: ['pdf', 'docx', 'pptx', 'jpg', 'jpeg', 'png'] },
      { name: 'Tài liệu', extensions: ['pdf', 'docx', 'pptx'] },
      { name: 'Hình ảnh', extensions: ['jpg', 'jpeg', 'png'] }
    ],
    properties: ['openFile', 'multiSelections'] // Allow multiple files selection
  });
  return canceled ? [] : filePaths;
});

ipcMain.handle('dialog:saveFile', async (event, defaultName) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Lưu file Word',
    defaultPath: defaultName || 'output.docx',
    filters: [{ name: 'Word Document', extensions: ['docx'] }]
  });
  return canceled ? null : filePath;
});

ipcMain.handle('dialog:openFolder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn thư mục lưu',
    properties: ['openDirectory']
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('shell:openPath', async (event, filePath) => {
  await shell.openPath(filePath);
});

ipcMain.handle('shell:showItemInFolder', async (event, filePath) => {
  shell.showItemInFolder(filePath);
});

// File system
ipcMain.handle('fs:readFile', async (event, filePath) => {
  return fs.readFileSync(filePath);
});

ipcMain.handle('fs:writeFile', async (event, filePath, buffer) => {
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return true;
});

ipcMain.handle('fs:stat', async (event, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    return { size: stat.size, mtime: stat.mtime };
  } catch {
    return null;
  }
});

// Settings and History
const SettingsManager = require('./lib/settings-manager');
const settingsManager = new SettingsManager();

const HistoryManager = require('./lib/history-manager');
const historyManager = new HistoryManager(app.getPath('userData'));

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
ipcMain.handle('history:getAll', () => historyManager.getAll());
ipcMain.handle('history:add', (event, item) => historyManager.addEntry(item));
ipcMain.handle('history:getMarkdown', (event, id) => historyManager.getMarkdown(id));
ipcMain.handle('history:delete', (event, id) => historyManager.deleteEntry(id));
ipcMain.handle('history:clear', () => historyManager.clearAll());

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

// Extract text directly from file (DOCX, PPTX) without OCR
ipcMain.handle('ai:extractTextFromFile', async (event, { filePath, fileType }) => {
  try {
    if (fileType === 'docx') {
      const DocxHandler = require('./lib/input-handlers/docx-handler');
      return await DocxHandler.extractText(filePath);
    } else if (fileType === 'pptx') {
      const PptxHandler = require('./lib/input-handlers/pptx-handler');
      return await PptxHandler.extractText(filePath);
    } else {
      throw new Error('Định dạng không được hỗ trợ để trích xuất text trực tiếp');
    }
  } catch (err) {
    throw new Error(`Lỗi đọc file: ${err.message}`);
  }
});

// Single page translation (in main process)
ipcMain.handle('ai:translateText', async (event, { pageNum, text, targetLang, settings, requestId }) => {
  const { buildProvider } = require('./lib/ai-translate-engine');
  const provider = buildProvider(settings.aiProvider, settingsManager);

  // No longer truncating input — modern Gemini models (3.5 Flash, etc.) support 1M+ context
  const textToTranslate = text;

  const controller = new AbortController();
  activeAbortControllers.set(requestId, controller);

  try {
    const { text: resultText, bilingualSections, usageStats } = await provider.translateTextStream(
      textToTranslate,
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
