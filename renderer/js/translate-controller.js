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
  let currentHistoryId = null;
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
    el.innerHTML = `<strong>${totalTokens.toLocaleString()}</strong> tokens &#183; <span style="color:var(--accent)">${costStr}</span>`;
  }

  function selectPageCard(pageNum) {
    document.querySelectorAll('.page-progress-card').forEach(c => c.classList.remove('active'));
    const card = document.getElementById(`page-card-${pageNum}`);
    if (card) card.classList.add('active');
    
    activePreviewPageNum = pageNum;
    renderFullOutput();
  }

  /**
   * Render the live preview panel.
   *
   * This used to concatenate EVERY page into one string and assign it to
   * textContent — on every streaming chunk. That is O(total document) per
   * chunk, so cost grows with the square of the document size: fine at 100
   * pages (~0.3 MB rebuilt per frame), a hard UI freeze at 2500 (~7.5 MB).
   *
   * The panel is a live progress view, not the deliverable — the complete
   * translation goes to the output file. So only the most recent pages are
   * shown, which keeps every rebuild bounded no matter how long the document is.
   */
  const PREVIEW_PAGE_WINDOW = 50;

  let _renderPending = false;
  function renderFullOutput() {
    if (_renderPending) return;
    _renderPending = true;
    requestAnimationFrame(() => {
      _renderPending = false;
      const el = document.getElementById('translate-output');
      if (!el) return;

      const sortedPages = Object.keys(pageOutputs).map(Number).sort((a, b) => a - b);
      const shown = sortedPages.slice(-PREVIEW_PAGE_WINDOW);
      const hidden = sortedPages.length - shown.length;

      const parts = [];
      if (hidden > 0) {
        parts.push(
          `--- Đã dịch xong ${hidden} trang trước đó ` +
          `(chỉ hiển thị ${shown.length} trang gần nhất — bản đầy đủ nằm trong file kết quả) ---\n`
        );
      }
      for (const pg of shown) {
        if (pageOutputs[pg]) parts.push(pageOutputs[pg], '\n\n');
      }

      el.textContent = parts.join('');
      el.scrollTop = el.scrollHeight;
    });
  }

  function appendPageOutput(pageNum, text) {
    pageOutputs[pageNum] = (pageOutputs[pageNum] || '') + text;

    // Drop page text that has scrolled out of the preview window. Without this,
    // a 2500-page run keeps every page's text alive purely to display none of it.
    const pages = Object.keys(pageOutputs);
    if (pages.length > PREVIEW_PAGE_WINDOW * 2) {
      const stale = pages.map(Number).sort((a, b) => a - b).slice(0, -PREVIEW_PAGE_WINDOW);
      for (const pg of stale) delete pageOutputs[pg];
    }

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

    // ── CRITICAL: Kill any previous run before starting ──────────
    // If a prior conversion is still in-flight (e.g. user cancelled doc A
    // and immediately started doc B), we must ensure ALL stale requests
    // are fully aborted and listeners are removed before proceeding.
    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
    }
    window.api.ai.abortAll();
    window.api.removeAllListeners('extract:chunk');
    window.api.removeAllListeners('translate:chunk');
    window.api.removeAllListeners('usage:stats');
    activeRequestIds.clear();

    abortController = new AbortController();
    isPaused = false;
    startTime = Date.now();
    lastOutputPath = null;
    currentRunId = createRunId();
    currentPageResults = [];
    pageTimes.length = 0;
    totalInputTokens = 0;
    totalOutputTokens = 0;
    totalCostUSD = 0;

    // Capture the runId for this specific conversion so that listeners
    // can reject stale data if a new run starts before this one finishes.
    const thisRunId = currentRunId;

    // Register event listeners dynamically for this conversion run
    window.api.on('extract:chunk', ({ requestId, chunk }) => {
      if (currentRunId !== thisRunId) return; // Stale run — drop
      if (!activeRequestIds.has(requestId)) return;
      const parts = requestId.split(':');
      const pageNum = parseInt(parts[2]);
      if (!isNaN(pageNum)) {
        appendPageOutput(pageNum, chunk);
      }
    });

    window.api.on('translate:chunk', ({ requestId, chunk }) => {
      if (currentRunId !== thisRunId) return; // Stale run — drop
      if (!activeRequestIds.has(requestId)) return;
      const parts = requestId.split(':');
      const pageNum = parseInt(parts[2]);
      if (!isNaN(pageNum)) {
        appendPageOutput(pageNum, chunk);
      }
    });

    window.api.on('usage:stats', ({ usageStats }) => {
      if (currentRunId !== thisRunId) return; // Stale run — drop
      if (!usageStats) return;
      totalInputTokens += usageStats.inputTokens || 0;
      totalOutputTokens += usageStats.outputTokens || 0;
      totalCostUSD += usageStats.costUSD || 0;
      updateUsageDisplay();
    });

    // Reset status outputs — clear ALL keys from previous runs to prevent memory leak
    Object.keys(pageOutputs).forEach(k => delete pageOutputs[k]);
    activePreviewPageNum = selectedPages[0];
    selectedPages.forEach(p => { pageOutputs[p] = ''; });

    // Update UI
    document.getElementById('convert-title').textContent = '⏳ Đang xử lý tài liệu...';
    document.getElementById('translate-output').textContent = '';
    // Set initial active progress status for better UX
    updateProgress(0.0, '⚙️ Đang phân tích tài liệu...');
    updateElapsed();
    document.getElementById('progress-estimated').textContent = 'Còn: Đang tính...';
    document.getElementById('translate-pulse').style.display = 'flex';

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
    let peakProgress = 0; // High-water mark — progress bar chỉ tăng, không bao giờ giảm

    try {
      const ext = filePath.split('.').pop().toLowerCase();
      let pageItems = [];

      if (ext === 'pdf') {
        // Step 1: Just get the list of pages. Rendering will happen on-demand per page
        pageItems = PDFRenderer.getSelectedPages().map(p => ({ pageNum: p, buffer: null, textContent: null }));
      }

      if (abortController.signal.aborted) return;

      // Step 2: Extract and translate pages using worker pool queue
      document.getElementById('convert-status').textContent = 'Đang đọc và dịch tài liệu bằng AI...';

      const processPage = async ({ pageNum, buffer, textContent }) => {
        const pageStart = Date.now();
        try {
          let currentBuffer = buffer;
          if (ext === 'pdf' && !currentBuffer) {
             updateProgress(peakProgress, `📸 Đang kết xuất hình ảnh trang ${pageNum}/${total}...`);
             currentBuffer = await window.PDFRenderer.renderPageForOCR(pageNum, dpi);
          }
          updateProgress(peakProgress, `⚡ Đang xử lý trang ${pageNum}/${total}...`);
          const result = await processPageCore(pageNum, currentBuffer, settings, '', textContent);
          currentBuffer = null; // Free memory

          processed++;
          pageTimes.push(Date.now() - pageStart);
          const pct = 0.1 + (processed / total) * 0.8;
          peakProgress = Math.max(peakProgress, pct);
          updateProgress(peakProgress, `Trang ${processed}/${total}`);
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
          peakProgress = Math.max(peakProgress, pct);
          updateProgress(peakProgress, `Trang ${processed}/${total}`);
          updateElapsed();
          updateETA(processed, total);

          return { page: pageNum, markdown: '', skipped: false, error: err.message };
        }
      };

      // Respect user setting directly
      let limit = parseInt(settings.concurrentPages) || 2;
      console.log('Tiến trình dịch chạy song song tối đa:', limit, 'trang');

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
      // Guard: if cancelled while awaiting final promises, bail out immediately
      if (abortController.signal.aborted) {
        return;
      }

      // Ensure results are sorted numerically by page number
      pageResults.sort((a, b) => a.page - b.page);
      currentPageResults = pageResults; // Store for retry access

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
      lastOutputPath = null;
      currentHistoryId = null;

      const elapsed = Date.now() - startTime;
      const successCount = pageResults.filter(r => !r.error && !r.skipped).length;
      const pct = Math.round((successCount / pageResults.length) * 100);

      // Save history immediately (outputPath starts empty)
      // Guard: double-check we haven't been aborted between the promise resolution and here
      if (abortController.signal.aborted) return;
      try {
        currentHistoryId = await window.api.history.add({
          inputFile: filePath,
          inputType: filePath.split('.').pop().toLowerCase(),
          pageCount: total,
          pagesProcessed: successCount,
          sourceLang: settings.sourceLanguage || 'auto',
          targetLang: settings.translateLanguage,
          translateMode: settings.translateMode || 'bilingual',
          model: ProviderUtils.resolveProviderModel(settings),
          totalTokens: totalInputTokens + totalOutputTokens,
          costUSD: totalCostUSD,
          elapsedMs: elapsed,
          outputPath: '',
          success: true,
          markdownContent: lastFullMarkdown
        });
      } catch (err) {
        console.error('Không thể lưu lịch sử:', err);
      }

      updateProgress(1.0, 'Dịch hoàn tất! Đang chuyển sang báo cáo sau 5 giây...');

      // Show complete screen
      document.getElementById('stat-pages').textContent = pageResults.length;
      document.getElementById('stat-time').textContent = UIManager.formatTime(elapsed);
      
      const successValEl = document.getElementById('stat-success');
      if (successValEl) {
        successValEl.textContent = `${pct}%`;
        successValEl.classList.remove('text-danger');
        successValEl.classList.add('text-success');
      }

      // Display cost
      const costEl = document.getElementById('stat-cost');
      if (costEl) {
        costEl.textContent = `$${totalCostUSD.toFixed(4)}`;
      }

      // Restore complete screen defaults for Successful state
      const iconContainer = document.getElementById('complete-icon-container');
      if (iconContainer) {
        iconContainer.className = 'success-icon-wrapper mb-md';
        iconContainer.innerHTML = `
          <svg class="success-checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
            <circle class="success-checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
            <path class="success-checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
          </svg>
        `;
      }

      const completeTitle = document.getElementById('complete-title');
      if (completeTitle) {
        completeTitle.innerHTML = `<span style="font-style: italic; color: var(--accent);">Bản dịch</span> đã sẵn sàng.`;
      }

      const completeSubtitle = document.getElementById('complete-subtitle');
      if (completeSubtitle) {
        completeSubtitle.textContent = 'Đã dịch thuật tài liệu thành công.';
      }

      document.getElementById('translate-pulse').style.display = 'none';

      // Set button visibilities appropriately (show Save, hide Open)
      const btnSaveDocx = document.getElementById('btn-save-docx');
      const btnOpenDocx = document.getElementById('btn-open-docx');
      const btnExportMarkdown = document.getElementById('btn-export-markdown');
      const btnPreviewTranslation = document.getElementById('btn-preview-translation');
      const btnOpenFolder = document.getElementById('btn-open-folder');
      const btnConvertAnother = document.getElementById('btn-convert-another');

      if (btnSaveDocx) btnSaveDocx.style.display = 'block';
      if (btnOpenDocx) btnOpenDocx.style.display = 'none';
      if (btnExportMarkdown) btnExportMarkdown.style.display = 'block';
      if (btnPreviewTranslation) btnPreviewTranslation.style.display = 'block';
      if (btnOpenFolder) btnOpenFolder.style.display = 'none';
      if (btnConvertAnother) btnConvertAnother.style.display = 'block';

      // Wait 5 seconds to let the user review the final translation details
      await sleep(5000);

      UIManager.showView('complete');
      UIManager.toast('Dịch thuật thành công và đã lưu lịch sử!', 'success');

      // Desktop notification
      try {
        new Notification('AI Translate', {
          body: `Hoàn thành dịch ${pageResults.length} trang trong ${UIManager.formatTime(elapsed)}`,
          icon: './assets/icon.png',
        });
      } catch {}

      // Add to recent files
      const recentList = await window.api.settings.get('recentFiles') || [];
      await window.api.settings.set('recentFiles',
        [filePath, ...recentList.filter(f => f !== filePath)].slice(0, 50)
      );

    } catch (err) {
      if (abortController?.signal?.aborted) {
        return;
      }
      UIManager.toast(`Lỗi: ${err.message}`, 'error');
      UIManager.showView('preview');
    } finally {
      activeRequestIds.clear();
      const pulse = document.getElementById('translate-pulse');
      if (pulse) pulse.style.display = 'none';

      // Clean up event listeners to prevent leaks
      window.api.removeAllListeners('extract:chunk');
      window.api.removeAllListeners('translate:chunk');
      window.api.removeAllListeners('usage:stats');
    }
  }

  /**
   * Prompts user for a save file destination, generates the DOCX, and updates the history record
   */
  async function saveDocxFile() {
    if (!currentPageResults || currentPageResults.length === 0) {
      UIManager.toast('Không có nội dung để lưu', 'error');
      return false;
    }

    const settings = await window.api.settings.load();
    const activeFilePath = PDFRenderer.getCurrentFilePath() || '';
    const baseName = activeFilePath
      ? activeFilePath.split(/[\\/]/).pop().replace(/\.[^/.]+$/, '.docx')
      : 'output.docx';
      
    const outputPath = await window.api.dialog.saveFile(baseName);
    if (!outputPath) {
      UIManager.toast('Đã hủy lưu file', 'warning');
      return false;
    }

    try {
      UIManager.toast('Đang tạo file Word...', 'info');
      await window.api.docx.generate({ pages: currentPageResults, settings, outputPath });
      lastOutputPath = outputPath;

      // Update history record with the new output path
      if (currentHistoryId) {
        await window.api.history.updateOutputPath({ id: currentHistoryId, outputPath });
      }

      UIManager.toast('Đã lưu file Word thành công!', 'success');
      
      // Update complete screen action buttons
      const btnSaveDocx = document.getElementById('btn-save-docx');
      const btnOpenDocx = document.getElementById('btn-open-docx');
      const btnOpenFolder = document.getElementById('btn-open-folder');

      if (btnSaveDocx) btnSaveDocx.style.display = 'none';
      if (btnOpenDocx) btnOpenDocx.style.display = 'block';
      if (btnOpenFolder) btnOpenFolder.style.display = 'block';
      
      return true;
    } catch (err) {
      UIManager.toast(`Lỗi khi tạo file Word: ${err.message}`, 'error');
      return false;
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
      const filePath = PDFRenderer.getCurrentFilePath();
      const ext = filePath ? filePath.split('.').pop().toLowerCase() : 'pdf';
      
      if (ext === 'pdf') {
        buffer = await window.PDFRenderer.renderPageForOCR(pageNum, settings.dpi || 300);
      } else {
        throw new Error('Định dạng không được hỗ trợ');
      }

      const result = await processPageCore(pageNum, buffer, settings, '-retry', null);

      // Update stored results so DOCX output will be correct
      const idx = currentPageResults.findIndex(r => r.page === pageNum);
      if (idx !== -1) {
        currentPageResults[idx] = result;
      } else {
        currentPageResults.push(result);
      }
      // Ensure pages are always sorted by page number
      currentPageResults.sort((a, b) => a.page - b.page);

      // Re-aggregate full markdown
      let fullMarkdown = '';
      let successCount = 0;
      for (const r of currentPageResults) {
        if (r.skipped || r.error) continue;
        successCount++;
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

      // Update database history record with updated successCount, tokens, cost, and markdown
      if (currentHistoryId) {
        try {
          await window.api.history.updateEntry({
            id: currentHistoryId,
            fields: {
              pagesProcessed: successCount,
              totalTokens: totalInputTokens + totalOutputTokens,
              costUSD: totalCostUSD,
              markdownContent: lastFullMarkdown
            }
          });
        } catch (err) {
          console.error('Không thể cập nhật lịch sử khi thử lại:', err);
        }
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
    const fill = document.getElementById('progress-fill');
    if (fill) fill.style.width = `${pct}%`;
    const percent = document.getElementById('progress-percent');
    if (percent) percent.textContent = `${pct}%`;
    const labelEl = document.getElementById('progress-label');
    if (labelEl) labelEl.textContent = label || '';

    // V3 Editorial typography progress
    const pctHuge = document.getElementById('progress-percent-huge');
    if (pctHuge) pctHuge.textContent = pct;
    const labelHuge = document.getElementById('progress-label-huge');
    if (labelHuge) labelHuge.textContent = label || 'Đang chuẩn bị...';
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

  // Abort-aware sleep: resolves immediately if the AbortController fires during the wait
  function sleep(ms) {
    if (abortController?.signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      const onAbort = () => { clearTimeout(timer); resolve(); };
      abortController?.signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  function createRunId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function createRequestId(type, pageNum) {
    return `${currentRunId}:${type}:${pageNum}`;
  }

  async function handleCancellationImmediate() {
    try {
      // Wait a brief moment to allow any pending IPC token/cost updates to register
      await sleep(300);

      const selected = PDFRenderer.getSelectedPages();
      const total = (selected && selected.length) ? selected.length : 1;
      
      // Calculate how many page progress cards have status-success class
      let successCount = 0;
      document.querySelectorAll('.page-progress-card').forEach(card => {
        if (card.classList.contains('status-success')) {
          successCount++;
        }
      });

      // Record token usage and cost spent so far into stats database
      if (totalInputTokens + totalOutputTokens > 0) {
        try {
          const settings = await window.api.settings.load();
          await window.api.stats.add({
            pageCount: total,
            pagesProcessed: successCount,
            sourceLang: settings.sourceLanguage || 'auto',
            targetLang: settings.translateLanguage,
            model: ProviderUtils.resolveProviderModel(settings),
            totalTokens: totalInputTokens + totalOutputTokens,
            costUSD: totalCostUSD,
            success: false
          });
        } catch (err) {
          console.error('Không thể lưu thống kê khi hủy:', err);
        }
      }

      const elapsed = startTime ? (Date.now() - startTime) : 0;

      updateProgress(1.0, 'Đang huỷ tiến trình...');

      // Setup complete screen for Cancelled state
      document.getElementById('stat-pages').textContent = `${successCount}/${total}`;
      document.getElementById('stat-time').textContent = UIManager.formatTime(elapsed);
      
      const successValEl = document.getElementById('stat-success');
      if (successValEl) {
        successValEl.textContent = 'Đã hủy';
        successValEl.classList.remove('text-success');
        successValEl.classList.add('text-danger');
      }

      const costEl = document.getElementById('stat-cost');
      if (costEl) {
        costEl.textContent = `$${totalCostUSD.toFixed(4)}`;
      }

      const iconContainer = document.getElementById('complete-icon-container');
      if (iconContainer) {
        iconContainer.className = 'cancel-icon-wrapper mb-md';
        iconContainer.innerHTML = `
          <svg class="cancel-checkmark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
            <circle class="cancel-checkmark-circle" cx="26" cy="26" r="25" fill="none"/>
            <path class="cancel-checkmark-x" fill="none" d="M16 16 L36 36 M36 16 L16 36"/>
          </svg>
        `;
      }

      const completeTitle = document.getElementById('complete-title');
      if (completeTitle) {
        completeTitle.innerHTML = `<span style="font-style: italic; color: var(--danger);">Dịch thuật</span> đã huỷ.`;
      }

      const completeSubtitle = document.getElementById('complete-subtitle');
      if (completeSubtitle) {
        completeSubtitle.textContent = 'Đã huỷ tiến trình. Không lưu file hay lịch sử dịch thuật. Số token và chi phí đã sử dụng vẫn được tính vào bảng thống kê.';
      }

      const btnSaveDocx = document.getElementById('btn-save-docx');
      const btnOpenDocx = document.getElementById('btn-open-docx');
      const btnExportMarkdown = document.getElementById('btn-export-markdown');
      const btnPreviewTranslation = document.getElementById('btn-preview-translation');
      const btnOpenFolder = document.getElementById('btn-open-folder');
      const btnConvertAnother = document.getElementById('btn-convert-another');

      if (btnSaveDocx) btnSaveDocx.style.display = 'none';
      if (btnOpenDocx) btnOpenDocx.style.display = 'none';
      if (btnExportMarkdown) btnExportMarkdown.style.display = 'none';
      if (btnPreviewTranslation) btnPreviewTranslation.style.display = 'none';
      if (btnOpenFolder) btnOpenFolder.style.display = 'none';
      if (btnConvertAnother) btnConvertAnother.style.display = 'block';

      const pulse = document.getElementById('translate-pulse');
      if (pulse) pulse.style.display = 'none';

      UIManager.showView('complete');
      UIManager.toast('Tiến trình dịch thuật đã huỷ!', 'warning');
    } catch (err) {
      console.error('Lỗi khi xử lý huỷ dịch:', err);
      UIManager.showView('preview');
    }
  }

  function cancel() {
    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
      // Abort all in-flight AI requests in main process
      window.api.ai.abortAll();
      // Immediately clean up listeners so no stale data leaks into a future run
      activeRequestIds.clear();
      window.api.removeAllListeners('extract:chunk');
      window.api.removeAllListeners('translate:chunk');
      window.api.removeAllListeners('usage:stats');
      handleCancellationImmediate();
    }
  }
  function togglePause() {
    isPaused = !isPaused;
    const btn = document.getElementById('btn-pause-resume');
    if (btn) btn.textContent = isPaused ? '▶ Tiếp tục' : '⏸ Tạm dừng';
  }



  return {
    startConvert,
    cancel,
    togglePause,
    retryPage,
    saveDocxFile,
    getLastOutputPath: () => lastOutputPath,
    getFullMarkdown: () => lastFullMarkdown,
    getLastInputPath: () => lastInputPath
  };
})();
