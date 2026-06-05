/**
 * translate-controller.js
 * Orchestrates the entire application state for the conversion process.
 * 
 * Pipeline Flow:
 * 1. User selects PDF -> loaded via PDF.js.
 * 2. `startConvert`: Initializes UI and starts loop over `selectedPages`.
 * 3. `processPageCore`: 
 *      - Extracts image from PDF.js.
 *      - Sends to Main Process for OCR.
 *      - (Optional) Sends OCR text to Main Process for Translation.
 * 4. Stores results in `currentPageResults`.
 * 5. Calls `window.api.docx.generate` to build the final Word file.
 */
window.TranslateController = (() => {
  let abortController = null;
  let isPaused = false;
  let startTime = null;
  let lastOutputPath = null;
  let lastFullMarkdown = null;
  let lastInputPath = null;
  let currentRunId = null;
  const activeRequestIds = new Set();

  let activePreviewPageNum = null;
  const pageOutputs = {};

  // Track page results for retry updates + page timing for ETA
  let currentPageResults = [];
  const pageTimes = [];

  // Track accumulated token usage and cost
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUSD = 0;

  function updateUsageDisplay() {
    const el = document.getElementById('usage-stats');
    if (!el) return;
    const totalTokens = totalInputTokens + totalOutputTokens;
    if (totalTokens === 0) {
      el.textContent = '';
      return;
    }
    const costStr = `$${totalCostUSD.toFixed(4)}`;
    el.innerHTML = `<strong>${totalTokens.toLocaleString()}</strong> tokens &#183; <span style="color:var(--success)">${costStr}</span>`;
  }

  function selectPageCard(pageNum) {
    document.querySelectorAll('.page-progress-card').forEach(c => c.classList.remove('active'));
    const card = document.getElementById(`page-card-${pageNum}`);
    if (card) card.classList.add('active');
    
    activePreviewPageNum = pageNum;
    renderFullOutput();
  }

  /**
   * Render ALL pages' output concatenated in the translate-output panel.
   * This ensures the user sees the complete translation growing as pages finish.
   * Uses requestAnimationFrame to throttle DOM updates during streaming.
   */
  let _renderPending = false;
  function renderFullOutput() {
    if (_renderPending) return;
    _renderPending = true;
    requestAnimationFrame(() => {
      _renderPending = false;
      const el = document.getElementById('translate-output');
      if (!el) return;

      const sortedPages = Object.keys(pageOutputs).map(Number).sort((a, b) => a - b);
      let fullText = '';
      for (const pg of sortedPages) {
        if (pageOutputs[pg]) {
          fullText += pageOutputs[pg];
          fullText += '\n\n';
        }
      }
      el.textContent = fullText;
      el.scrollTop = el.scrollHeight;
    });
  }

  function appendPageOutput(pageNum, text) {
    pageOutputs[pageNum] = (pageOutputs[pageNum] || '') + text;
    // Always re-render full output so users see all pages
    renderFullOutput();
  }

  function togglePagePreview(pageNum) {
    const el = document.getElementById(`page-preview-${pageNum}`);
    const btn = document.getElementById(`page-btn-preview-${pageNum}`);
    if (el) {
      el.classList.toggle('open');
      if (btn) {
        btn.textContent = el.classList.contains('open') ? '✕ Ẩn văn bản' : '📄 Xem văn bản';
      }
    }
  }

  // ── Shared core: extract + translate a single page ──────────────
  async function processPageCore(pageNum, buffer, settings, idSuffix = '', textContent = null) {
    const card = document.getElementById(`page-card-${pageNum}`);
    const statusText = document.getElementById(`page-status-${pageNum}`);
    const retryLabel = idSuffix ? ' (Thử lại)' : '';

    let result = { page: pageNum, markdown: '', skipped: false, error: null };

    if (textContent) {
      // Bypassing OCR, using extracted text from DOCX/PPTX directly
      if (card) {
        card.className = 'page-progress-card status-extracting';
        if (statusText) statusText.textContent = `🔍 Đang đọc văn bản${retryLabel}...`;
      }
      appendPageOutput(pageNum, `--- Đã đọc nội dung văn bản gốc trang ${pageNum}${retryLabel} ---\n`);
      result.markdown = textContent;
    } else {
      if (card) {
        card.className = 'page-progress-card status-extracting';
        if (statusText) statusText.textContent = `🔍 Đang trích xuất${retryLabel}...`;
        const prog = document.getElementById(`page-progress-bar-container-${pageNum}`);
        if (prog) prog.style.display = 'block';
      }

      appendPageOutput(pageNum, `--- Đang trích xuất văn bản gốc trang ${pageNum}${retryLabel} ---\n`);

      result = await extractPageTextViaMain(
        pageNum, buffer, settings,
        createRequestId(`extract${idSuffix}`, pageNum)
      );

      if (result.error) throw new Error(result.error);
    }
    
    appendPageOutput(pageNum, result.markdown + '\n');

    // Optional Translation Step
    if (settings.translateLanguage && settings.translateLanguage !== '') {
      if (card) {
        card.className = 'page-progress-card status-translating';
        if (statusText) statusText.textContent = '🔄 Đang dịch...';
      }

      if (settings.translateMode === 'bilingual' || settings.bilingual) {
        appendPageOutput(pageNum, `\n\n--- Bản dịch song ngữ xen kẽ trang ${pageNum} ---\n\n`);
      } else {
        appendPageOutput(pageNum, `\n\n--- Bản dịch trang ${pageNum} (${settings.translateLanguage}) ---\n\n`);
      }

      const translateResult = await translatePageViaMain({
        pageNum,
        text: result.markdown,
        targetLang: settings.translateLanguage,
        settings,
        requestId: createRequestId(`translate${idSuffix}`, pageNum),
      });

      if (!translateResult) throw new Error('Bản dịch rỗng');

      if ((settings.translateMode === 'bilingual' || settings.bilingual) && translateResult.bilingualSections) {
        result.markdown = translateResult.text;
        result.bilingualSections = translateResult.bilingualSections;
      } else {
        result.markdown = typeof translateResult === 'string' ? translateResult : translateResult.text;
      }
      appendPageOutput(pageNum, result.markdown + '\n');
    }

    // Update card to success
    if (card) {
      card.className = 'page-progress-card status-success';
      if (statusText) statusText.textContent = '✅ Hoàn thành';
      const prog = document.getElementById(`page-progress-bar-container-${pageNum}`);
      if (prog) prog.style.display = 'none';

      const btn = document.getElementById(`page-btn-preview-${pageNum}`);
      if (btn) btn.style.display = 'block';

      const previewEl = document.getElementById(`page-preview-${pageNum}`);
      if (previewEl) previewEl.textContent = result.markdown;
    }

    return result;
  }

  // ── Main conversion flow ────────────────────────────────────────
  async function startConvert(filePath, selectedPages) {
    const settings = await window.api.settings.load();
    UIManager.showView('convert');

    abortController = new AbortController();
    isPaused = false;
    startTime = Date.now();
    lastOutputPath = null;
    currentRunId = createRunId();
    activeRequestIds.clear();
    currentPageResults = [];
    pageTimes.length = 0;
    totalInputTokens = 0;
    totalOutputTokens = 0;
    totalCostUSD = 0;

    // Reset status outputs
    activePreviewPageNum = selectedPages[0];
    selectedPages.forEach(p => { pageOutputs[p] = ''; });

    // Update UI
    document.getElementById('convert-title').textContent = '⏳ Đang xử lý tài liệu...';
    document.getElementById('translate-output').textContent = '';
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-percent').textContent = '0%';
    document.getElementById('translate-pulse').style.display = 'flex';
    document.getElementById('progress-estimated').textContent = '';

    // Pre-render the progress cards
    const pageProgressContainer = document.getElementById('page-progress-container');
    if (pageProgressContainer) {
      pageProgressContainer.innerHTML = selectedPages.map(pageNum => `
        <div class="page-progress-card status-waiting" id="page-card-${pageNum}" style="cursor: pointer;">
          <div class="page-card-header">
            <div class="page-card-title">
              <span>Trang ${pageNum}</span>
            </div>
            <div class="page-card-status-text" id="page-status-${pageNum}">
              ⏳ Đang chờ...
            </div>
          </div>
          <div class="page-card-micro-progress" style="height: 3px; background: var(--border); margin-top: 8px; border-radius: 2px; overflow: hidden; display: none;" id="page-progress-bar-container-${pageNum}">
            <div id="page-progress-bar-${pageNum}" style="height: 100%; width: 100%; background: var(--accent); transition: width 0.3s ease; animation: pulse-opacity 1.5s infinite;"></div>
          </div>
          <button class="page-card-preview-btn" id="page-btn-preview-${pageNum}" style="display:none; text-align: left; width: fit-content; margin-top: 8px;">📄 Xem văn bản</button>
          <button class="btn btn-secondary btn-sm" id="page-btn-retry-${pageNum}" style="display:none; width: fit-content; margin-top: 4px;">🔄 Thử lại</button>
          <div class="page-card-preview-area" id="page-preview-${pageNum}"></div>
        </div>
      `).join('');
      
      // Bind clicks
      selectedPages.forEach(pageNum => {
        const card = document.getElementById(`page-card-${pageNum}`);
        card?.addEventListener('click', (e) => {
          if (e.target.classList.contains('page-card-preview-btn') || e.target.classList.contains('page-card-preview-area')) {
            return;
          }
          selectPageCard(pageNum);
        });
        
        const btn = document.getElementById(`page-btn-preview-${pageNum}`);
        btn?.addEventListener('click', (e) => {
          e.stopPropagation();
          togglePagePreview(pageNum);
        });
        
        const retryBtn = document.getElementById(`page-btn-retry-${pageNum}`);
        retryBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          retryPage(pageNum, settings);
        });
      });
    }

    // Set first card active immediately
    selectPageCard(selectedPages[0]);

    const dpi = settings.dpi || 300;
    const total = selectedPages.length;
    let processed = 0;

    try {
      const ext = filePath.split('.').pop().toLowerCase();
      let pageItems = [];

      if (ext === 'pdf') {
        // Step 1: Just get the list of pages. Rendering will happen on-demand per page
        pageItems = PDFRenderer.getSelectedPages().map(p => ({ pageNum: p, buffer: null, textContent: null }));
      } else if (['jpg', 'jpeg', 'png'].includes(ext)) {
        document.getElementById('convert-status').textContent = 'Đang nạp ảnh...';
        const buffer = await window.api.fs.readFile(filePath);
        pageItems = [{ pageNum: 1, buffer, textContent: null }];
      } else if (['docx', 'pptx'].includes(ext)) {
        document.getElementById('convert-status').textContent = `Đang đọc file ${ext.toUpperCase()}...`;
        const textContent = await window.api.extractTextFromFile({ filePath, fileType: ext });
        pageItems = [{ pageNum: 1, buffer: null, textContent }];
      }

      if (abortController.signal.aborted) return;

      // Step 2: Extract and translate pages using worker pool queue
      document.getElementById('convert-status').textContent = 'Đang đọc và dịch tài liệu bằng AI...';

      const processPage = async ({ pageNum, buffer, textContent }) => {
        const pageStart = Date.now();
        try {
          let currentBuffer = buffer;
          if (ext === 'pdf' && !currentBuffer) {
             currentBuffer = await window.PDFRenderer.renderPageForOCR(pageNum, dpi);
          }
          const result = await processPageCore(pageNum, currentBuffer, settings, '', textContent);
          currentBuffer = null; // Free memory

          processed++;
          pageTimes.push(Date.now() - pageStart);
          const pct = 0.1 + (processed / total) * 0.8;
          updateProgress(pct, `Trang ${processed}/${total}`);
          updateElapsed();
          updateETA(processed, total);

          return result;
        } catch (err) {
          const card = document.getElementById(`page-card-${pageNum}`);
          const statusText = document.getElementById(`page-status-${pageNum}`);
          if (card) {
            card.className = 'page-progress-card status-error';
            if (statusText) statusText.textContent = `❌ Lỗi: ${err.message}`;
            const prog = document.getElementById(`page-progress-bar-container-${pageNum}`);
            if (prog) prog.style.display = 'none';
            const retryBtn = document.getElementById(`page-btn-retry-${pageNum}`);
            if (retryBtn) retryBtn.style.display = 'block';
          }
          appendPageOutput(pageNum, `\n\n[Lỗi xử lý trang: ${err.message}]\n`);
          
          processed++;
          pageTimes.push(Date.now() - pageStart);
          const pct = 0.1 + (processed / total) * 0.8;
          updateProgress(pct, `Trang ${processed}/${total}`);
          updateElapsed();
          updateETA(processed, total);

          return { page: pageNum, markdown: '', skipped: false, error: err.message };
        }
      };

      // Auto-adjust concurrency based on file size
      let limit = settings.concurrentPages || 2;
      if (ext === 'pdf') {
        if (total > 50) limit = 1; // Reduce concurrency for large files to save memory
        else if (total <= 10) limit = 3; // Speed up small files
      }

      const executing = new Set();
      const results = [];
      const requestDelayMs = (settings.requestDelaySec ?? 2) * 1000;

      for (const item of pageItems) {
        if (abortController.signal.aborted) break;

        // Wait if paused
        while (isPaused && !abortController.signal.aborted) {
          await sleep(500);
        }

        // Configurable delay between requests to avoid RPM limits
        if (results.length > 0 && requestDelayMs > 0) {
          await sleep(requestDelayMs);
        }

        const taskPromise = Promise.resolve().then(() => processPage(item));
        results.push(taskPromise);
        executing.add(taskPromise);

        const clean = () => executing.delete(taskPromise);
        taskPromise.then(clean, clean);

        if (executing.size >= limit) {
          await Promise.race(executing);
        }
      }

      const pageResults = await Promise.all(results);
      currentPageResults = pageResults; // Store for retry access

      if (abortController.signal.aborted) {
        UIManager.toast('Đã hủy tiến trình', 'warning');
        UIManager.showView('preview');
        return;
      }

      // Step 3: Generate DOCX
      document.getElementById('convert-status').textContent = 'Đang tạo file Word...';
      updateProgress(0.9, 'Tạo file Word...');

      // Show preview modal before saving
      const modal = document.getElementById('preview-modal');
      const modalContent = document.getElementById('preview-modal-content');
      
      if (modal && modalContent) {
        // Aggregate all markdown content
        let allMarkdown = '';
        for (const r of pageResults) {
          if (r.skipped) continue;
          if (r.error) {
            allMarkdown += `\n\n[Trang ${r.page} - Lỗi: ${r.error}]\n\n`;
            continue;
          }
          if (r.bilingualSections) {
             for (const sec of r.bilingualSections) {
                if (sec.original) allMarkdown += `${sec.original}\n\n`;
                if (sec.translation) allMarkdown += `*${sec.translation}*\n\n`;
             }
          } else {
             allMarkdown += `${r.markdown}\n\n`;
          }
          allMarkdown += `\n\n---\n\n`;
        }
        
        modalContent.textContent = allMarkdown.trim() || 'Không có nội dung để xem trước.';
        modal.style.display = 'flex';
        
        const savePromise = new Promise((resolve) => {
          const btnConfirm = document.getElementById('btn-confirm-save');
          const btnCancel = document.getElementById('btn-cancel-save');
          const btnClose = document.getElementById('btn-close-preview-modal');
          
          const cleanup = () => {
            btnConfirm.removeEventListener('click', onConfirm);
            btnCancel.removeEventListener('click', onCancel);
            btnClose.removeEventListener('click', onCancel);
            modal.style.display = 'none';
          };
          
          const onConfirm = () => { cleanup(); resolve(true); };
          const onCancel = () => { cleanup(); resolve(false); };
          
          btnConfirm.addEventListener('click', onConfirm);
          btnCancel.addEventListener('click', onCancel);
          btnClose.addEventListener('click', onCancel);
        });
        
        const shouldSave = await savePromise;
        if (!shouldSave) {
          UIManager.toast('Đã hủy lưu file', 'warning');
          return;
        }
      }

      // Ask user where to save
      const activeFilePath = PDFRenderer.getCurrentFilePath() || window.currentNonPdfPath || '';
      const baseName = activeFilePath
        ? activeFilePath.split(/[\\/]/).pop().replace(/\.[^/.]+$/, '.docx')
        : 'output.docx';
      const outputPath = await window.api.dialog.saveFile(baseName);
      if (!outputPath) {
        UIManager.toast('Đã hủy lưu file', 'warning');
        return;
      }

      await window.api.docx.generate({ pages: pageResults, settings, outputPath });
      lastOutputPath = outputPath;

      updateProgress(1.0, 'Hoàn thành!');

      // Show complete screen
      const elapsed = Date.now() - startTime;
      const successCount = pageResults.filter(r => !r.error && !r.skipped).length;
      const pct = Math.round((successCount / pageResults.length) * 100);

      document.getElementById('stat-pages').textContent = pageResults.length;
      document.getElementById('stat-time').textContent = UIManager.formatTime(elapsed);
      document.getElementById('stat-success').textContent = `${pct}%`;

      // Display cost
      const costEl = document.getElementById('stat-cost');
      if (costEl) {
        costEl.textContent = `$${totalCostUSD.toFixed(4)}`;
      }

      document.getElementById('translate-pulse').style.display = 'none';
      UIManager.showView('complete');
      UIManager.toast('Dịch thuật thành công!', 'success');

      // Aggregate full markdown for history
      let fullMarkdown = '';
      for (const r of pageResults) {
        if (r.skipped || r.error) continue;
        if (r.bilingualSections) {
           for (const sec of r.bilingualSections) {
              if (sec.original) fullMarkdown += `${sec.original}\n\n`;
              if (sec.translation) fullMarkdown += `*${sec.translation}*\n\n`;
           }
        } else {
           fullMarkdown += `${r.markdown}\n\n`;
        }
        fullMarkdown += `\n\n---\n\n`;
      }
      
      lastFullMarkdown = fullMarkdown.trim();
      lastInputPath = filePath;

      // Save history
      try {
        await window.api.history.add({
          inputFile: filePath,
          inputType: filePath.split('.').pop().toLowerCase(),
          pageCount: total,
          pagesProcessed: successCount,
          sourceLang: settings.sourceLanguage || 'auto',
          targetLang: settings.translateLanguage,
          translateMode: settings.translateMode || 'bilingual',
          model: settings.model,
          totalTokens: totalInputTokens + totalOutputTokens,
          costUSD: totalCostUSD,
          elapsedMs: elapsed,
          outputPath: outputPath,
          success: true,
          markdownContent: fullMarkdown.trim()
        });
      } catch (err) {
        console.error('Không thể lưu lịch sử:', err);
      }

      // Desktop notification
      try {
        new Notification('AI Translate', {
          body: `Hoàn thành dịch ${pageResults.length} trang trong ${UIManager.formatTime(elapsed)}`,
          icon: './assets/icon.png',
        });
      } catch {}

      // Add to recent files
      await window.api.settings.set('recentFiles',
        [filePath, ...(await window.api.settings.get('recentFiles') || []).filter(f => f !== filePath)].slice(0, 10)
      );

    } catch (err) {
      document.getElementById('translate-pulse').style.display = 'none';
      UIManager.toast(`Lỗi: ${err.message}`, 'error');
      UIManager.showView('preview');
    } finally {
      activeRequestIds.clear();
      const pulse = document.getElementById('translate-pulse');
      if (pulse) pulse.style.display = 'none';
    }
  }

  // ── Retry a single page (updates currentPageResults for DOCX re-generation) ──
  async function retryPage(pageNum, settings) {
    const retryBtn = document.getElementById(`page-btn-retry-${pageNum}`);
    if (retryBtn) retryBtn.style.display = 'none';
    pageOutputs[pageNum] = ''; // Reset log

    try {
      let buffer = null;
      let textContent = null;
      const filePath = PDFRenderer.getCurrentFilePath() || window.currentNonPdfPath;
      const ext = filePath ? filePath.split('.').pop().toLowerCase() : 'pdf';
      
      if (ext === 'pdf') {
        buffer = await window.PDFRenderer.renderPageForOCR(pageNum, settings.dpi || 300);
      } else if (['jpg', 'jpeg', 'png'].includes(ext)) {
        buffer = await window.api.fs.readFile(filePath);
      } else if (['docx', 'pptx'].includes(ext)) {
        textContent = await window.api.extractTextFromFile({ filePath, fileType: ext });
      }

      const result = await processPageCore(pageNum, buffer, settings, '-retry', textContent);

      // Update stored results so DOCX output will be correct
      const idx = currentPageResults.findIndex(r => r.page === pageNum);
      if (idx !== -1) {
        currentPageResults[idx] = result;
      }

      UIManager.toast(`Đã thử lại thành công trang ${pageNum}`, 'success');
    } catch (err) {
      const card = document.getElementById(`page-card-${pageNum}`);
      const statusText = document.getElementById(`page-status-${pageNum}`);
      if (card) {
        card.className = 'page-progress-card status-error';
        if (statusText) statusText.textContent = `❌ Lỗi: ${err.message}`;
        const prog = document.getElementById(`page-progress-bar-container-${pageNum}`);
        if (prog) prog.style.display = 'none';
        if (retryBtn) retryBtn.style.display = 'block';
      }
      appendPageOutput(pageNum, `\n\n[Lỗi xử lý trang: ${err.message}]\n`);
    }
  }

  // ── IPC calls to main process ───────────────────────────────────
  async function extractPageTextViaMain(pageNum, buffer, settings, requestId) {
    activeRequestIds.add(requestId);
    try {
      // Send ArrayBuffer directly — Electron IPC handles binary natively, much faster
      // than Array.from() which creates a huge JS array for multi-MB images
      const uint8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const result = await window.api.extractPageText({ pageNum, rawBuffer: uint8.buffer, settings, requestId });
      return { page: pageNum, markdown: result, skipped: false, error: null };
    } catch (err) {
      return { page: pageNum, markdown: '', skipped: false, error: err.message };
    } finally {
      activeRequestIds.delete(requestId);
    }
  }

  async function translatePageViaMain(opts) {
    activeRequestIds.add(opts.requestId);
    try {
      return await window.api.translateText(opts);
    } finally {
      activeRequestIds.delete(opts.requestId);
    }
  }

  // ── Progress helpers ────────────────────────────────────────────
  function updateProgress(fraction, label) {
    const pct = Math.round(fraction * 100);
    document.getElementById('progress-fill').style.width = `${pct}%`;
    document.getElementById('progress-percent').textContent = `${pct}%`;
    document.getElementById('progress-label').textContent = label || '';
  }

  function updateElapsed() {
    const ms = Date.now() - startTime;
    document.getElementById('progress-elapsed').textContent = `Đã dùng: ${UIManager.formatTime(ms)}`;
  }

  function updateETA(processed, total) {
    const el = document.getElementById('progress-estimated');
    if (!el || pageTimes.length === 0) return;
    const remaining = total - processed;
    if (remaining <= 0) {
      el.textContent = '';
      return;
    }
    const avgMs = pageTimes.reduce((a, b) => a + b, 0) / pageTimes.length;
    const etaMs = Math.round(avgMs * remaining);
    el.textContent = `Còn ~${UIManager.formatTime(etaMs)}`;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function createRunId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function createRequestId(type, pageNum) {
    return `${currentRunId}:${type}:${pageNum}`;
  }

  function cancel() {
    abortController?.abort();
    // Abort all in-flight AI requests in main process
    window.api.ai.abortAll();
  }
  function togglePause() {
    isPaused = !isPaused;
    const btn = document.getElementById('btn-pause-resume');
    if (btn) btn.textContent = isPaused ? '▶ Tiếp tục' : '⏸ Tạm dừng';
  }

  // Listen for extraction chunk events (currently only used for system messages/warnings, not real-time streaming)
  window.api.on('extract:chunk', ({ requestId, chunk }) => {
    if (!activeRequestIds.has(requestId)) return;
    const parts = requestId.split(':');
    const pageNum = parseInt(parts[2]);
    if (!isNaN(pageNum)) {
      appendPageOutput(pageNum, chunk);
    }
  });

  // Listen for translation chunk events (currently only used for system messages/warnings, not real-time streaming)
  window.api.on('translate:chunk', ({ requestId, chunk }) => {
    if (!activeRequestIds.has(requestId)) return;
    const parts = requestId.split(':');
    const pageNum = parseInt(parts[2]);
    if (!isNaN(pageNum)) {
      appendPageOutput(pageNum, chunk);
    }
  });

  // Listen for token usage stats from main process
  window.api.on('usage:stats', ({ usageStats }) => {
    if (!usageStats) return;
    totalInputTokens += usageStats.inputTokens || 0;
    totalOutputTokens += usageStats.outputTokens || 0;
    totalCostUSD += usageStats.costUSD || 0;
    updateUsageDisplay();
  });

  return {
    startConvert,
    cancel,
    togglePause,
    retryPage,
    getLastOutputPath: () => lastOutputPath,
    getFullMarkdown: () => lastFullMarkdown,
    getLastInputPath: () => lastInputPath
  };
})();
