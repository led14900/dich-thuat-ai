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
    currentFilePath = filePath;
    selectedPages.clear();
    currentPDF = null;

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
                 thumbnailCache.set(pageNum, canvas.toDataURL('image/png'));
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
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') throw err;
    }
  }

  /**
   * Render a page at high DPI and return as PNG Uint8Array
   * Used for AI OCR processing
   */
  async function renderPageForOCR(pageNum, dpi = 300) {
    if (!currentPDF) throw new Error('Chưa tải file PDF');
    const scale = dpi / 72; // PDF default is 72 DPI
    const page = await currentPDF.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

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
  function getTotalPages() { return totalPages; }
  function getCurrentFilePath() { return currentFilePath; }
  function getCurrentPageNum() { return currentPageNum; }

  function clear() {
    currentFilePath = null;
    currentPDF = null;
    selectedPages.clear();
    totalPages = 0;
    const canvas = document.getElementById('pdf-main-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    const panel = document.getElementById('thumbnail-panel');
    if (panel) panel.innerHTML = '';
    updateSelectionUI();
  }

  return {
    loadFile, renderMainPage, renderPageForOCR,
    selectAll, deselectAll,
    getSelectedPages, getTotalPages, getCurrentFilePath, getCurrentPageNum,
    clear
  };
})();
