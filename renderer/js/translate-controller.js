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
  // Dem trang dich xong. Khong the dem lai tu the DOM: tu ban 1.2.9 the cu bi
  // thu hoi de giu DOM nho, nen dem the se thieu o tai lieu hang nghin trang.
  let successPageCount = 0;
  // Trang da xong tu lan chay truoc (Chay tiep). Thong ke chi duoc cong phan
  // moi, khong thi mot tai lieu 10 trang huy o trang 4 roi chay tiep se thanh
  // 14 trang tren Dashboard.
  let resumedPageCount = 0;
  const pageTimes = [];
  let pageTimeTotalMs = 0;          // tổng chạy sẵn, tránh reduce() O(n²)
  let concurrentPagesForETA = 1;    // ETA phải biết có bao nhiêu trang chạy song song

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

  // ── Run checkpoints ─────────────────────────────────────────────
  //
  // Nothing used to reach disk until all pages had resolved, so cancelling at
  // page 2400 of 2500 discarded every page already paid for. Each finished page
  // is now written out immediately.

  /**
   * Persist one finished page. Deliberately swallows errors: a checkpoint is a
   * safety net, and failing to write one must never kill a working run.
   */
  async function saveCheckpoint(result) {
    if (!currentRunId || !window.api?.checkpoint) return;
    try {
      await window.api.checkpoint.append(currentRunId, {
        page: result.page,
        markdown: result.markdown || '',
        bilingualSections: result.bilingualSections || null,
        skipped: !!result.skipped,
        error: result.error || null,
        savedAt: Date.now(),
      });
    } catch (err) {
      console.warn('[checkpoint] không lưu được trang', result.page, err.message);
    }
  }

  /** Recover pages already finished for a run — used after a cancel or crash. */
  async function loadCheckpoint(runId) {
    if (!runId || !window.api?.checkpoint) return [];
    try {
      return await window.api.checkpoint.read(runId);
    } catch (err) {
      console.warn('[checkpoint] không đọc được:', err.message);
      return [];
    }
  }

  /**
   * If this document has an unfinished run, ask whether to continue it.
   * @returns {Promise<{runId: string, donePages: Set<number>, doneResults: Array}|null>}
   */
  async function offerResume(filePath, selectedPages) {
    if (!filePath || !window.api?.checkpoint?.findForFile) return null;

    let found;
    try {
      found = await window.api.checkpoint.findForFile(filePath);
    } catch {
      return null;
    }
    if (!found?.runId) return null;

    const saved = await loadCheckpoint(found.runId);
    // Only successful pages count — a page that failed still needs doing.
    const done = saved.filter(r => !r.error && !r.skipped && r.markdown);
    const wanted = new Set(selectedPages);
    const usable = done.filter(r => wanted.has(r.page));

    if (usable.length === 0) {
      await clearCheckpoint(found.runId);
      return null;
    }

    const remaining = selectedPages.length - usable.length;
    const when = found.savedAt ? new Date(found.savedAt).toLocaleString('vi-VN') : 'lần trước';
    const ok = await window.api.dialog.confirm({
      title: 'Chạy tiếp lần dịch dang dở?',
      type: 'question',
      message:
        `Tài liệu này có một lần dịch chưa hoàn tất (${when}).\n\n` +
        `Đã dịch xong: ${usable.length} trang\n` +
        `Còn lại: ${remaining} trang\n\n` +
        `Chọn "Chạy tiếp" để chỉ dịch ${remaining} trang còn lại.\n` +
        `Chọn "Dịch lại từ đầu" sẽ bỏ kết quả cũ và gọi lại API cho cả ${selectedPages.length} trang.`,
      buttons: ['Chạy tiếp', 'Dịch lại từ đầu'],
    });

    // dialog.confirm resolves truthy for the first button
    // dialog:confirm luôn trả boolean.
    const wantsResume = ok === true;
    if (!wantsResume) {
      await clearCheckpoint(found.runId);
      return null;
    }

    return {
      runId: found.runId,
      donePages: new Set(usable.map(r => r.page)),
      doneResults: usable,
    };
  }

  async function clearCheckpoint(runId) {
    if (!runId || !window.api?.checkpoint) return;
    try {
      await window.api.checkpoint.clear(runId);
    } catch { /* leaving a stale checkpoint behind is harmless; pruned after 7 days */ }
  }

  /**
   * Ghi vào Lịch sử những lần dịch bị đứt vì app tắt giữa chừng.
   *
   * Huỷ bằng nút Huỷ thì ghi ngay tại chỗ, nhưng app bị tắt (đóng cửa sổ, mất
   * điện, treo máy) thì không có cơ hội đó — phần đã dịch chỉ nằm trong
   * checkpoint và người dùng không thấy ở đâu cả. Chạy lúc mở app: mỗi
   * checkpoint chưa ghi sẽ thành một mục "chưa hoàn tất".
   *
   * Checkpoint vẫn giữ nguyên để "Chạy tiếp" dùng tiếp, và được đánh dấu để
   * lần mở sau không ghi trùng.
   */
  async function recoverUnfinishedRuns() {
    if (!window.api?.checkpoint?.list) return;

    let runs = [];
    try {
      runs = await window.api.checkpoint.list();
    } catch {
      return;
    }

    for (const run of runs) {
      const meta = run.meta;
      if (!meta || meta.historySavedAt) continue;

      try {
        const pages = await loadCheckpoint(run.runId);
        if (!pages.length) continue;
        pages.sort((a, b) => a.page - b.page);

        const markdown = buildFullMarkdown(pages);
        if (!markdown) continue;

        const done = pages.filter(p => !p.error && !p.skipped).length;

        await window.api.history.add({
          inputFile: meta.filePath || '',
          inputType: (meta.filePath || '').split('.').pop().toLowerCase() || 'pdf',
          pageCount: meta.totalPages || pages.length,
          pagesProcessed: done,
          sourceLang: meta.sourceLang || 'auto',
          targetLang: meta.targetLang || '',
          translateMode: meta.translateMode || 'bilingual',
          model: meta.model || '',
          totalTokens: 0,
          costUSD: 0,
          elapsedMs: 0,
          outputPath: '',
          success: false,
          status: 'interrupted',
          runId: run.runId,
          markdownContent: markdown
        });

        await window.api.checkpoint.saveMeta(run.runId, { historySavedAt: Date.now() });
      } catch (err) {
        console.error('Không khôi phục được lần dịch dang dở:', err);
      }
    }
  }

  // ── Progress cards ──────────────────────────────────────────────
  //
  // Each card is ~8 DOM nodes and used to carry 3 event listeners of its own,
  // all created up front. At 100 pages that is fine; at 2500 it is ~20k nodes
  // and ~7.5k listeners built in one go, which freezes the window on startup.
  //
  // So: render everything up front only for documents small enough to scroll
  // through, and above that create cards on demand, keeping a bounded number
  // alive. Clicks are handled by one delegated listener either way.

  // Render all cards up front at or below this many pages.
  const CARD_EAGER_LIMIT = 300;
  // Cards kept in the DOM when running lazily. Errors are never dropped.
  const CARD_KEEP_ALIVE = 150;

  let cardsAreLazy = false;
  let cardSettings = null;
  let progressDelegationBound = false;

  function pageCardHTML(pageNum) {
    return `
        <div class="page-progress-card status-waiting" id="page-card-${pageNum}" data-page="${pageNum}" style="cursor: pointer;">
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
      `;
  }

  function setupPageProgress(selectedPages, settings) {
    const container = document.getElementById('page-progress-container');
    if (!container) return;

    cardSettings = settings;
    cardsAreLazy = selectedPages.length > CARD_EAGER_LIMIT;

    container.innerHTML = cardsAreLazy
      ? `<div class="page-progress-note" id="page-progress-note" style="padding:8px 0;opacity:.75;font-size:13px;">
           Chỉ hiển thị các trang gần đây nhất.
         </div>`
      : selectedPages.map(pageCardHTML).join('');

    // One delegated listener for the whole list, instead of three per card.
    if (!progressDelegationBound) {
      progressDelegationBound = true;
      container.addEventListener('click', (e) => {
        const card = e.target.closest?.('.page-progress-card');
        if (!card) return;
        const pageNum = Number(card.dataset.page);
        if (!Number.isFinite(pageNum)) return;

        if (e.target.closest('.page-card-preview-btn')) {
          e.stopPropagation();
          togglePagePreview(pageNum);
          return;
        }
        if (e.target.closest('#page-btn-retry-' + pageNum)) {
          e.stopPropagation();
          retryPage(pageNum, cardSettings);
          return;
        }
        if (e.target.classList.contains('page-card-preview-area')) return;
        selectPageCard(pageNum);
      });
    }
  }

  /** Create this page's card if lazy mode dropped or never made it. */
  function ensurePageCard(pageNum) {
    if (document.getElementById(`page-card-${pageNum}`)) return;
    const container = document.getElementById('page-progress-container');
    if (!container) return;

    container.insertAdjacentHTML('beforeend', pageCardHTML(pageNum));
    if (!cardsAreLazy) return;

    // Retire the oldest finished cards. Errors stay so "Thử lại" remains reachable.
    const cards = container.querySelectorAll('.page-progress-card');
    let excess = cards.length - CARD_KEEP_ALIVE;
    for (const card of cards) {
      if (excess <= 0) break;
      if (card.classList.contains('status-success')) {
        card.remove();
        excess--;
      }
    }
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
      const window_ = new Set(sortedPages.slice(-PREVIEW_PAGE_WINDOW));
      // Retrying an early page while the run is far ahead would otherwise leave
      // the user watching a panel that never mentions the page they retried.
      if (activePreviewPageNum != null && pageOutputs[activePreviewPageNum] != null) {
        window_.add(activePreviewPageNum);
      }
      const shown = sortedPages.filter(p => window_.has(p));
      const hidden = sortedPages.length - shown.length;

      const parts = [];
      if (hidden > 0) {
        parts.push(
          '--- Chỉ hiển thị các trang gần đây nhất ---\n'
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
      for (const pg of stale) {
        if (pg === activePreviewPageNum) continue; // the page the user is watching
        delete pageOutputs[pg];
      }
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
    ensurePageCard(pageNum);
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

    successPageCount++;

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

  /**
   * Stitch finished pages into one markdown document.
   *
   * Both the end of a run and a retry need exactly this, and they used to carry
   * their own copy — which is how a formatting change could land in one and not
   * the other. Callers pass an already page-sorted array.
   */
  function buildFullMarkdown(results) {
    const parts = [];
    for (const r of results) {
      if (r.skipped || r.error) continue;
      if (r.bilingualSections) {
        for (const sec of r.bilingualSections) {
          if (sec.original) parts.push(`${sec.original}\n\n`);
          if (sec.translation) parts.push(`*${sec.translation}*\n\n`);
        }
      } else {
        parts.push(`${r.markdown}\n\n`);
      }
      parts.push('\n\n---\n\n');
    }
    return parts.join('').trim();
  }

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

    // Offer to continue an earlier run on this same document instead of paying
    // for every page again. Declining starts fresh and drops the old checkpoint.
    const resumed = await offerResume(filePath, selectedPages);

    abortController = new AbortController();
    isPaused = false;
    startTime = Date.now();
    lastOutputPath = null;
    currentRunId = resumed ? resumed.runId : createRunId();
    currentPageResults = resumed ? resumed.doneResults : [];
    // Khong reset o day thi id cua TAI LIEU TRUOC con sot lai: mo file moi roi
    // huy ngay se tuong la da luu lich su va bo qua nhanh ghi thong ke.
    currentHistoryId = null;
    resumedPageCount = resumed ? resumed.doneResults.length : 0;
    // Chay tiep: cac trang lan truoc da xong van tinh la thanh cong.
    successPageCount = resumed ? resumed.doneResults.length : 0;
    pageTimes.length = 0;
    pageTimeTotalMs = 0;
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
    // Deliberately NOT pre-seeding every page: the preview window shows the
    // highest-numbered pages that have output, so seeding all 2500 up front
    // would park the window on empty trailing pages and show nothing at all.

    // Update UI
    document.getElementById('convert-title').textContent = '⏳ Đang xử lý tài liệu...';
    document.getElementById('translate-output').textContent = '';
    // Set initial active progress status for better UX
    updateProgress(0.0, '⚙️ Đang phân tích tài liệu...');
    updateElapsed();
    document.getElementById('progress-estimated').textContent = 'Còn: Đang tính...';
    document.getElementById('translate-pulse').style.display = 'flex';

    // Prepare the progress cards. Below the threshold every card is rendered up
    // front as before; above it they are created on demand and old finished ones
    // are dropped (see ensurePageCard), because 2500 cards is ~20k DOM nodes and
    // freezes the window before the first page is even sent.
    setupPageProgress(selectedPages, settings);

    // Set first card active immediately
    ensurePageCard(selectedPages[0]);
    selectPageCard(selectedPages[0]);

    const dpi = settings.dpi || 300;
    const total = selectedPages.length;
    // Pages recovered from a checkpoint already count as done for the progress bar.
    let processed = resumed ? resumed.doneResults.length : 0;

    // Mot trang vua xong — dung chung cho ca nhanh thanh cong lan nhanh loi,
    // vi ca hai deu phai day thanh tien do va ETA giong het nhau.
    const advancePageProgress = (pageStart) => {
      processed++;
      const tookMs = Date.now() - pageStart;
      pageTimes.push(tookMs);
      pageTimeTotalMs += tookMs;
      peakProgress = Math.max(peakProgress, 0.1 + (processed / total) * 0.8);
      updateProgress(peakProgress, `Trang ${processed}/${total}`);
      updateElapsed();
      updateETA(processed, total);
    };
    let peakProgress = 0; // High-water mark — progress bar chỉ tăng, không bao giờ giảm

    // Let a future run find this checkpoint and know what document it belongs to.
    if (currentRunId && window.api?.checkpoint?.saveMeta) {
      window.api.checkpoint.saveMeta(currentRunId, {
        filePath,
        totalPages: selectedPages.length,
        startedAt: Date.now(),
        // Lưu kèm cấu hình đang dùng để nếu app bị tắt giữa chừng, lần mở sau
        // vẫn ghi đúng ngôn ngữ và model vào Lịch sử thay vì đoán theo cài đặt
        // hiện tại (có thể đã đổi).
        sourceLang: settings.sourceLanguage || 'auto',
        targetLang: settings.translateLanguage,
        translateMode: settings.translateMode || 'bilingual',
        model: ProviderUtils.resolveProviderModel(settings),
        // Chạy tiếp sinh thêm trang mới, nên lần dịch này lại cần được ghi
        // vào Lịch sử nếu bị đứt.
        historySavedAt: null,
      }).catch(() => { /* metadata is a convenience, never fail the run over it */ });
    }

    if (resumed) {
      // Show the recovered pages as already finished instead of silently skipping them.
      for (const r of resumed.doneResults) {
        ensurePageCard(r.page);
        const card = document.getElementById(`page-card-${r.page}`);
        const statusText = document.getElementById(`page-status-${r.page}`);
        if (card) card.className = 'page-progress-card status-success';
        if (statusText) statusText.textContent = '✅ Đã dịch (lần trước)';
      }
      UIManager.toast(`Chạy tiếp: bỏ qua ${resumed.doneResults.length} trang đã dịch xong`, 'info');
    }

    try {
      const ext = filePath.split('.').pop().toLowerCase();
      let pageItems = [];

      if (ext === 'pdf') {
        // Step 1: Just get the list of pages. Rendering will happen on-demand per page
        pageItems = PDFRenderer.getSelectedPages()
          .filter(p => !resumed || !resumed.donePages.has(p))
          .map(p => ({ pageNum: p, buffer: null, textContent: null }));
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

          // Persist before anything else can go wrong with the rest of the run.
          await saveCheckpoint(result);

          advancePageProgress(pageStart);

          return result;
        } catch (err) {
          ensurePageCard(pageNum);
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
          
          advancePageProgress(pageStart);

          const failed = { page: pageNum, markdown: '', skipped: false, error: err.message };
          // Record failures too, so a resumed run knows which pages still need work.
          await saveCheckpoint(failed);
          return failed;
        }
      };

      // Respect user setting directly
      let limit = parseInt(settings.concurrentPages) || 2;
      concurrentPagesForETA = limit;
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

        // Bam Tam dung trong luc dang cho delay thi truoc day trang van bi
        // phong di — nguoi dung thay da dung ma API van bi goi them.
        while (isPaused && !abortController.signal.aborted) {
          await sleep(500);
        }
        if (abortController.signal.aborted) break;

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
      // Guard: if cancelled while awaiting final promises, bail out immediately.
      // What was finished is already on disk — recoverable rather than discarded.
      if (abortController.signal.aborted) {
        const saved = await loadCheckpoint(thisRunId);
        if (saved.length > 0) {
          currentPageResults = saved;
          console.log(`[checkpoint] giữ lại ${saved.length} trang đã dịch xong trước khi huỷ`);
        }
        return;
      }

      // Pages recovered from a checkpoint were never re-run, so they are absent
      // from pageResults — merge them back in or a resumed run loses them.
      if (resumed) pageResults.push(...resumed.doneResults);

      // Ensure results are sorted numerically by page number
      pageResults.sort((a, b) => a.page - b.page);
      currentPageResults = pageResults; // Store for retry access

      // Aggregate full markdown for history
      lastFullMarkdown = buildFullMarkdown(pageResults);
      lastInputPath = filePath;
      lastOutputPath = null;
      currentHistoryId = null;

      const elapsed = Date.now() - startTime;
      const successCount = pageResults.filter(r => !r.error && !r.skipped).length;
      const pct = Math.round((successCount / pageResults.length) * 100);
      // Truoc day lan chay nao cung ghi success: true, nen tai lieu 10 trang
      // hong 5 trang van hien y het nhu dich tron ven.
      const runStatus = successCount === pageResults.length ? 'completed' : 'partial';

      // Save history immediately (outputPath starts empty)
      // Guard: double-check we haven't been aborted between the promise resolution and here
      if (abortController.signal.aborted) return;
      try {
        currentHistoryId = await window.api.history.add({
          inputFile: filePath,
          inputType: filePath.split('.').pop().toLowerCase(),
          pageCount: total,
          pagesProcessed: successCount,
          // Lich su giu tong de nguoi dung thay "10/10"; thong ke chi nhan
          // phan dich trong lan chay nay.
          pagesDelta: Math.max(0, successCount - resumedPageCount),
          sourceLang: settings.sourceLanguage || 'auto',
          targetLang: settings.translateLanguage,
          translateMode: settings.translateMode || 'bilingual',
          model: ProviderUtils.resolveProviderModel(settings),
          totalTokens: totalInputTokens + totalOutputTokens,
          costUSD: totalCostUSD,
          elapsedMs: elapsed,
          outputPath: '',
          success: runStatus === 'completed',
          status: runStatus,
          runId: thisRunId,
          markdownContent: lastFullMarkdown
        });
      } catch (err) {
        console.error('Không thể lưu lịch sử:', err);
      }

      // Chỉ xoá checkpoint SAU khi lịch sử đã lưu xong. Trước đây xoá ngay khi
      // dịch xong, nên app sập giữa lúc lưu là mất trắng 2500 trang vừa trả
      // tiền API. Nếu lưu lịch sử hỏng thì giữ checkpoint lại để còn chạy tiếp.
      if (currentHistoryId) {
        await clearCheckpoint(thisRunId);
      } else {
        console.warn('[checkpoint] giữ lại vì chưa lưu được lịch sử');
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
    // Keep the retried page in the preview window even if the run is far past it
    selectPageCard(pageNum);

    // Lần chạy chính gỡ listener 'usage:stats' trong finally, nên nếu không
    // nghe riêng ở đây thì token và chi phí của "Thử lại" biến mất khỏi cả màn
    // hình, Lịch sử lẫn Thống kê. Dùng off() chứ không removeAllListeners để
    // không cắt mất listener của lần chạy đang diễn ra.
    let retryTokens = 0;
    let retryCostUSD = 0;
    const onRetryUsage = ({ usageStats }) => {
      if (!usageStats) return;
      const inTok = usageStats.inputTokens || 0;
      const outTok = usageStats.outputTokens || 0;
      retryTokens += inTok + outTok;
      retryCostUSD += usageStats.costUSD || 0;
      totalInputTokens += inTok;
      totalOutputTokens += outTok;
      totalCostUSD += usageStats.costUSD || 0;
      updateUsageDisplay();
    };
    window.api.on('usage:stats', onRetryUsage);

    // Trang này trước đó hỏng hay đã xong? Chỉ khi hỏng -> xong mới là thêm
    // một trang dịch được, không thì bấm Thử lại nhiều lần sẽ thổi phồng số.
    const prevResult = currentPageResults.find(r => r.page === pageNum);
    const prevFailed = !prevResult || !!prevResult.error || !!prevResult.skipped;

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

      // A later line for the same page supersedes the earlier failure on read.
      await saveCheckpoint(result);

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
      lastFullMarkdown = buildFullMarkdown(currentPageResults);
      const successCount = currentPageResults.filter(r => !r.skipped && !r.error).length;

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

      // Mỗi bản ghi thống kê là một phiên xử lý. Cập nhật Lịch sử không chạm
      // tới Thống kê, nên phải ghi riêng phần vừa phát sinh ở đây.
      const gainedPage = prevFailed && !result.error && !result.skipped ? 1 : 0;
      if (retryTokens > 0 || gainedPage) {
        try {
          await window.api.stats.add({
            inputFile: filePath,
            runId: currentRunId,
            status: 'retry',
            pageCount: 0,
            pagesProcessed: gainedPage,
            sourceLang: settings.sourceLanguage || 'auto',
            targetLang: settings.translateLanguage,
            model: ProviderUtils.resolveProviderModel(settings),
            totalTokens: retryTokens,
            costUSD: retryCostUSD,
            success: !result.error && !result.skipped,
          });
        } catch (err) {
          console.warn('Không ghi được thống kê khi thử lại:', err.message);
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
    } finally {
      window.api.off('usage:stats', onRetryUsage);
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
    // Tổng chạy sẵn thay cho reduce() toàn mảng mỗi trang — reduce là O(n²)
    // trên cả lần chạy.
    const avgMs = pageTimeTotalMs / pageTimes.length;
    // Chia cho số trang chạy song song, nếu không ETA của 2500 trang sẽ dài
    // gấp đôi/gấp ba sự thật và người dùng tưởng app đứng.
    const etaMs = Math.round((avgMs * remaining) / Math.max(1, concurrentPagesForETA));
    el.textContent = `Còn ~${UIManager.formatTime(etaMs)}`;
  }

  // Abort-aware sleep: resolves immediately if the AbortController fires during the wait
  function sleep(ms) {
    const signal = abortController?.signal;
    if (signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      // Gỡ listener ở CẢ hai lối ra. Trước đây chỉ { once: true } lo cho lối
      // abort; lối bình thường để lại listener, nên một lần chạy 2500 trang
      // tích hàng nghìn listener cùng closure của chúng cho tới khi xong.
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener('abort', done, { once: true });
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
      
      const successCount = successPageCount;
      const settings = await window.api.settings.load();

      // Ghi lần dịch dang dở vào Lịch sử. Trước đây huỷ giữa chừng là không có
      // dấu vết nào trong Lịch sử: phần đã dịch nằm trong checkpoint nên không
      // mất, nhưng người dùng không nhìn thấy và không xuất file được.
      const savedPages = await loadCheckpoint(currentRunId);
      savedPages.sort((a, b) => a.page - b.page);
      const hasPartialResult = savedPages.length > 0;

      if (hasPartialResult) {
        currentPageResults = savedPages;
        lastFullMarkdown = buildFullMarkdown(savedPages);
        lastInputPath = PDFRenderer.getCurrentFilePath();
        lastOutputPath = null;

        try {
          currentHistoryId = await window.api.history.add({
            inputFile: lastInputPath,
            inputType: (lastInputPath || '').split('.').pop().toLowerCase(),
            pageCount: total,
            pagesProcessed: successCount,
            pagesDelta: Math.max(0, successCount - resumedPageCount),
            sourceLang: settings.sourceLanguage || 'auto',
            targetLang: settings.translateLanguage,
            translateMode: settings.translateMode || 'bilingual',
            model: ProviderUtils.resolveProviderModel(settings),
            totalTokens: totalInputTokens + totalOutputTokens,
            costUSD: totalCostUSD,
            elapsedMs: startTime ? (Date.now() - startTime) : 0,
            outputPath: '',
            success: false,
            status: 'cancelled',
            runId: currentRunId,
            markdownContent: lastFullMarkdown
          });

          // Đánh dấu đã ghi, để lần mở app sau không tạo thêm một mục trùng.
          await window.api.checkpoint.saveMeta(currentRunId, { historySavedAt: Date.now() });
        } catch (err) {
          console.error('Không thể lưu lịch sử lần dịch đã huỷ:', err);
        }
      }

      // Thống kê: history:add đã cộng token và chi phí vào thống kê rồi, nên
      // chỉ tự cộng khi không lưu được mục lịch sử nào.
      if (!currentHistoryId && totalInputTokens + totalOutputTokens > 0) {
        try {
          await window.api.stats.add({
            inputFile: lastInputPath || PDFRenderer.getCurrentFilePath(),
            runId: currentRunId,
            status: 'cancelled',
            pageCount: total,
            pagesProcessed: Math.max(0, successCount - resumedPageCount),
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
        completeSubtitle.textContent = hasPartialResult
          ? `Đã huỷ tiến trình. ${successCount} trang dịch xong được lưu vào Lịch sử và đánh dấu chưa hoàn tất — xem lại hoặc xuất file ngay tại đây. Mở lại tài liệu này sẽ có lựa chọn "Chạy tiếp".`
          : 'Đã huỷ tiến trình. Chưa có trang nào dịch xong nên không lưu gì vào Lịch sử. Số token và chi phí đã sử dụng vẫn được tính vào bảng thống kê.';
      }

      const btnSaveDocx = document.getElementById('btn-save-docx');
      const btnOpenDocx = document.getElementById('btn-open-docx');
      const btnExportMarkdown = document.getElementById('btn-export-markdown');
      const btnPreviewTranslation = document.getElementById('btn-preview-translation');
      const btnOpenFolder = document.getElementById('btn-open-folder');
      const btnConvertAnother = document.getElementById('btn-convert-another');

      // Có trang đã dịch xong thì cho xem lại và xuất ngay, khỏi phải vào Lịch sử.
      const partialDisplay = hasPartialResult ? 'block' : 'none';
      if (btnSaveDocx) btnSaveDocx.style.display = partialDisplay;
      if (btnOpenDocx) btnOpenDocx.style.display = 'none';
      if (btnExportMarkdown) btnExportMarkdown.style.display = partialDisplay;
      if (btnPreviewTranslation) btnPreviewTranslation.style.display = partialDisplay;
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
    recoverUnfinishedRuns,
    saveDocxFile,
    getLastOutputPath: () => lastOutputPath,
    getFullMarkdown: () => lastFullMarkdown,
    getLastInputPath: () => lastInputPath
  };
})();
