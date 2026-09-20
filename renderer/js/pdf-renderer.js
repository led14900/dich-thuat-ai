/**
 * pdf-renderer.js — PDF rendering using pdfjs-dist in renderer process
 * FIXED: Proper pdfjs-dist loading for Electron (no ES module issues)
 */
window.PDFRenderer = (() => {
  let pdfjsLib = null;
  let currentPDF = null;
  let currentFilePath = null;
  const selectedPages = new Set();
  let totalPages = 0;
  let currentPageNum = 1;
  const thumbnailCache = new Map();
  let thumbnailObserver = null;
  // Giữ cả loadingTask, không chỉ proxy: chỉ loadingTask.destroy() mới thật sự
  // giải phóng worker và bộ nhớ của tài liệu cũ.
  let currentLoadingTask = null;

  // Trần cache thumbnail. Trước đây Map này không có giới hạn, nên cuộn hết
  // 2500 trang là giữ 2500 data URL PNG — hàng trăm MB nằm lại vô thời hạn.
  const THUMBNAIL_CACHE_MAX = 80;

  // Cạnh dài tối đa của ảnh gửi cho AI, khớp với BaseProvider.MAX_IMAGE_EDGE.
  // Render thẳng ở mức này thay vì render 300–600 DPI rồi mới thu nhỏ: A4 ở
  // 300 DPI là canvas RGBA ~35 MB, ở 600 DPI là ~139 MB. Với 5 trang song song
  // thì riêng canvas đã gần 700 MB — rồi tất cả bị vứt đi sau khi thu nhỏ.
  const OCR_MAX_EDGE = 2000;

  function rememberThumbnail(pageNum, dataUrl) {
    thumbnailCache.set(pageNum, dataUrl);
    // Map giữ thứ tự chèn, nên khoá đầu tiên là khoá cũ nhất.
    while (thumbnailCache.size > THUMBNAIL_CACHE_MAX) {
      thumbnailCache.delete(thumbnailCache.keys().next().value);
    }
  }

  async function loadPdfJs() {
    if (pdfjsLib) return pdfjsLib;

    // pdfjs-dist v4 is ESM. We serve it via our custom 'localfile:' Electron protocol
    // (registered in main.js) which is allowed even with webSecurity:true.
    // This avoids having to set webSecurity:false in BrowserWindow.
    try {
      // Build path relative to project root using our custom protocol
      // window.location.href = file:///E:/Claude/Code/dich-thuat-ai/renderer/index.html
      const rendererDir = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);
      const rootDir = rendererDir.replace(/renderer\/$/, '').replace(/renderer\\$/, '');

      // Convert file:// URL to localfile:// path for our custom protocol
      // file:///E:/Claude/Code/... => localfile:///E:/Claude/Code/...
      const rootPath = new URL(rootDir).pathname.replace(/^\//, ''); // 'E:/Claude/Code/dich-thuat-ai/'
      const pdfPath = `localfile:///${rootPath}node_modules/pdfjs-dist/build/pdf.min.mjs`;
      const workerPath = `localfile:///${rootPath}node_modules/pdfjs-dist/build/pdf.worker.min.mjs`;
      const cMapPath = `localfile:///${rootPath}node_modules/pdfjs-dist/cmaps/`;

      // Dynamic import of ESM module via localfile: protocol
      const pdfMod = await import(pdfPath);
      pdfjsLib = pdfMod;

      // Set worker source
      if (pdfjsLib.GlobalWorkerOptions) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;
      }

      // Store cMapUrl for later use in getDocument()
      pdfjsLib._cMapUrl = cMapPath;
    } catch (err) {
      throw new Error(`Không thể tải PDF.js. Hãy chạy: npm install\n${err.message}`);
    }

    return pdfjsLib;
  }


  /**
   * Load a PDF file and show thumbnails in preview
   * @param {string} filePath
   * @returns {{ pageCount, fileSize }}
   */
  async function loadFile(filePath) {
    if (currentFilePath !== filePath) {
      thumbnailCache.clear();
    }
    // Mở file thứ hai mà không huỷ file thứ nhất thì worker, font và ảnh của
    // tài liệu cũ nằm lại cho tới khi đóng app.
    await destroyCurrentDocument();
    currentFilePath = filePath;
    selectedPages.clear();

    const lib = await loadPdfJs();

    // Read file via IPC (main process has fs access)
    const fileBuffer = await window.api.fs.readFile(filePath);

    // Convert to Uint8Array — handle ArrayBuffer or Buffer
    let uint8;
    if (fileBuffer instanceof ArrayBuffer) {
      uint8 = new Uint8Array(fileBuffer);
    } else if (fileBuffer?.buffer instanceof ArrayBuffer) {
      uint8 = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.byteLength);
    } else {
      // Node Buffer returned as plain object via IPC — reconstruct
      const arr = Object.values(fileBuffer);
      uint8 = new Uint8Array(arr);
    }

    // Load PDF document
    const loadingTask = lib.getDocument({
      data: uint8,
      cMapUrl: lib._cMapUrl || '../node_modules/pdfjs-dist/cmaps/',
      cMapPacked: true,
    });

    currentLoadingTask = loadingTask;
    currentPDF = await loadingTask.promise;
    totalPages = currentPDF.numPages;

    // Select all pages by default
    for (let i = 1; i <= totalPages; i++) selectedPages.add(i);

    await renderThumbnails();
    await renderMainPage(1);

    const stat = await window.api.fs.stat(filePath);
    return { pageCount: totalPages, fileSize: stat?.size || 0 };
  }

  async function renderThumbnails() {
    const panel = document.getElementById('thumbnail-panel');
    if (!panel) return;
    panel.innerHTML = '';
    
    if (thumbnailObserver) {
      thumbnailObserver.disconnect();
    }
    
    thumbnailObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const item = entry.target;
          const pageNum = parseInt(item.dataset.page);
          const canvas = item.querySelector('canvas');
          
          if (!canvas.dataset.rendered) {
            canvas.dataset.rendered = 'true';
            // Vẽ xong rồi thì không cần theo dõi nữa; 2500 mục vẫn nằm trong
            // observer là chi phí thừa mỗi lần cuộn.
            thumbnailObserver.unobserve(item);
            
            if (thumbnailCache.has(pageNum)) {
               const img = new Image();
               img.onload = () => {
                 canvas.width = img.width;
                 canvas.height = img.height;
                 const ctx = canvas.getContext('2d');
                 ctx.drawImage(img, 0, 0);
               };
               img.src = thumbnailCache.get(pageNum);
            } else {
               renderPageToCanvas(pageNum, canvas, 0.25).then(() => {
                 rememberThumbnail(pageNum, canvas.toDataURL('image/png'));
               }).catch(() => {
                 const ctx = canvas.getContext('2d');
                 canvas.width = 120; canvas.height = 160;
                 ctx.fillStyle = '#1b1813';
                 ctx.fillRect(0, 0, 120, 160);
                 ctx.fillStyle = '#6f675a';
                 ctx.font = '11px sans-serif';
                 ctx.textAlign = 'center';
                 ctx.fillText(`Tr. ${pageNum}`, 60, 85);
               });
            }
          }
        }
      });
    }, { root: panel, rootMargin: '200px 0px' });

    // Create DOM elements
    for (let i = 1; i <= totalPages; i++) {
      const item = document.createElement('div');
      item.className = `thumbnail-item${selectedPages.has(i) ? ' selected' : ''}`;
      item.dataset.page = i;

      const canvas = document.createElement('canvas');
      canvas.id = `thumb-canvas-${i}`;
      const label = document.createElement('div');
      label.className = 'thumbnail-label';
      label.textContent = `Trang ${i}`;

      const checkbox = document.createElement('div');
      checkbox.className = 'thumbnail-checkbox';

      item.appendChild(canvas);
      item.appendChild(label);
      item.appendChild(checkbox);
      panel.appendChild(item);

      const pageIdx = i; // Capture for closure
      item.addEventListener('click', () => {
        togglePage(pageIdx);
        currentPageNum = pageIdx;
        renderMainPage(pageIdx);
        document.querySelectorAll('.thumbnail-item').forEach(t => t.classList.remove('active'));
        item.classList.add('active');
      });

      thumbnailObserver.observe(item);
    }

    updateSelectionUI();
  }

  async function renderMainPage(pageNum, scale = 1.4) {
    if (!currentPDF) return;
    currentPageNum = pageNum;
    const canvas = document.getElementById('pdf-main-canvas');
    if (!canvas) return;
    try {
      await renderPageToCanvas(pageNum, canvas, scale);
    } catch (err) {
      console.warn('renderMainPage error:', err);
    }
  }

  async function renderPageToCanvas(pageNum, canvas, scale = 1.0) {
    if (!currentPDF || !canvas) return;
    try {
      const page = await currentPDF.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      // Cancel previous render on same canvas if any
      if (canvas._renderTask) {
        try { canvas._renderTask.cancel(); } catch {}
      }

      const renderTask = page.render({ canvasContext: ctx, viewport });
      canvas._renderTask = renderTask;
      await renderTask.promise;
      canvas._renderTask = null;
      // Pixel đã nằm trên canvas — operator list, font và ảnh của trang không
      // còn cần giữ. Không gọi thì mỗi trang đi qua đều để lại phần của nó.
      page.cleanup();
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') throw err;
    }
  }

  /** Đóng tài liệu đang mở và dọn mọi thứ bám theo nó. */
  async function destroyCurrentDocument() {
    if (thumbnailObserver) {
      thumbnailObserver.disconnect();
      thumbnailObserver = null;
    }
    const task = currentLoadingTask;
    currentLoadingTask = null;
    currentPDF = null;
    if (task) {
      try { await task.destroy(); } catch { /* đang tải dở cũng không sao */ }
    }
  }

  /**
   * Render a page at high DPI and return as PNG Uint8Array
   * Used for AI OCR processing
   */
  async function renderPageForOCR(pageNum, dpi = 300) {
    if (!currentPDF) throw new Error('Chưa tải file PDF');
    const page = await currentPDF.getPage(pageNum);

    // Kẹp thẳng ở đây thay vì render to rồi thu nhỏ sau. Ảnh gửi đi vẫn y hệt,
    // nhưng đỉnh bộ nhớ giảm vài chục lần và bỏ hẳn một lượt resize.
    const base = page.getViewport({ scale: 1 });
    const longEdgePt = Math.max(base.width, base.height);
    const scale = Math.min(dpi / 72, OCR_MAX_EDGE / longEdgePt);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    try {
      await page.render({ canvasContext: ctx, viewport }).promise;
    } finally {
      page.cleanup();
    }

    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) {
          canvas.width = 0;
          canvas.height = 0;
          return reject(new Error('Canvas toBlob failed'));
        }
        const reader = new FileReader();
        reader.onload = () => {
          canvas.width = 0;
          canvas.height = 0;
          resolve(new Uint8Array(reader.result));
        };
        reader.onerror = (err) => {
          canvas.width = 0;
          canvas.height = 0;
          reject(err);
        };
        reader.readAsArrayBuffer(blob);
      }, 'image/png');
    });
  }

  function togglePage(pageNum) {
    const item = document.querySelector(`.thumbnail-item[data-page="${pageNum}"]`);
    if (selectedPages.has(pageNum)) {
      selectedPages.delete(pageNum);
      item?.classList.remove('selected');
    } else {
      selectedPages.add(pageNum);
      item?.classList.add('selected');
    }
    updateSelectionUI();
  }

  function selectAll() {
    for (let i = 1; i <= totalPages; i++) selectedPages.add(i);
    document.querySelectorAll('.thumbnail-item').forEach(t => t.classList.add('selected'));
    updateSelectionUI();
  }

  function deselectAll() {
    selectedPages.clear();
    document.querySelectorAll('.thumbnail-item').forEach(t => t.classList.remove('selected'));
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const count = selectedPages.size;
    const badge = document.getElementById('selected-count');
    if (badge) badge.textContent = `Đã chọn: ${count}`;
    const btn = document.getElementById('btn-start-convert');
    if (btn) btn.disabled = count === 0;
  }

  function getSelectedPages() { return [...selectedPages].sort((a, b) => a - b); }
  function getCurrentFilePath() { return currentFilePath; }
  function getCurrentPageNum() { return currentPageNum; }

  return {
    loadFile, renderMainPage, renderPageForOCR,
    selectAll, deselectAll,
    getSelectedPages, getCurrentFilePath, getCurrentPageNum,
  };
})();
