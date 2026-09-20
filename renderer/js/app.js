/**
 * app.js — Main application entry point
 * Wires together all modules after DOM is ready
 */
window.App = (() => {
  let currentRecentPage = 1;
  async function init() {
    // Load settings
    const settings = await window.api.settings.load();

    // Init auxiliary UIs
    if (window.HistoryUI) await HistoryUI.init();
    if (window.DashboardUI) await DashboardUI.init();

    // Populate prompt templates dropdown
    const promptSelect = document.getElementById('preview-prompt-template');
    if (promptSelect && settings.promptTemplates) {
      promptSelect.innerHTML = settings.promptTemplates.map(t => 
        `<option value="${t.id}">${t.name}</option>`
      ).join('');
      promptSelect.value = settings.activePromptTemplate || 'default';
    }

    // Window controls
    document.getElementById('btn-minimize')?.addEventListener('click', () => window.api.window.minimize());
    document.getElementById('btn-maximize')?.addEventListener('click', () => window.api.window.maximize());
    document.getElementById('btn-close')?.addEventListener('click', () => window.api.window.close());

    // Nav items
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const view = btn.dataset.view;
        // Don't navigate to preview/convert/complete via nav if no file loaded
        if ((view === 'preview' || view === 'convert' || view === 'complete') && !PDFRenderer.getCurrentFilePath()) {
          UIManager.toast('Vui lòng chọn file tài liệu trước', 'warning');
          return;
        }
        if (view === 'settings') {
          await SettingsUI.loadAndRender();
        }
        UIManager.showView(view);
      });
    });

    // Drag & drop on home view
    DragDrop.init(handleFilesSelected);

    // Back button from preview
    document.getElementById('btn-back-home')?.addEventListener('click', () => UIManager.showView('home'));

    // Select all / deselect pages
    document.getElementById('btn-select-all')?.addEventListener('click', () => {
      PDFRenderer.selectAll();
    });
    document.getElementById('btn-deselect-all')?.addEventListener('click', () => {
      PDFRenderer.deselectAll();
    });

    // Zoom controls
    let currentZoomScale = 1.4;
    const updateZoomLabel = () => {
      const el = document.getElementById('zoom-level');
      if (el) el.textContent = `${Math.round(currentZoomScale / 1.4 * 100)}%`;
    };
    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      currentZoomScale = Math.min(currentZoomScale + 0.3, 4.0);
      PDFRenderer.renderMainPage(PDFRenderer.getCurrentPageNum?.() || 1, currentZoomScale);
      updateZoomLabel();
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      currentZoomScale = Math.max(currentZoomScale - 0.3, 0.5);
      PDFRenderer.renderMainPage(PDFRenderer.getCurrentPageNum?.() || 1, currentZoomScale);
      updateZoomLabel();
    });
    document.getElementById('btn-zoom-fit')?.addEventListener('click', () => {
      currentZoomScale = 1.4;
      PDFRenderer.renderMainPage(PDFRenderer.getCurrentPageNum?.() || 1, currentZoomScale);
      updateZoomLabel();
    });

    // Start convert from preview
    document.getElementById('btn-start-convert')?.addEventListener('click', async () => {
      let filePath = PDFRenderer.getCurrentFilePath();
      let pages = PDFRenderer.getSelectedPages();
      
      if (!filePath) { UIManager.toast('Chưa có file nào', 'warning'); return; }
      if (!pages.length) {
        UIManager.toast('Chưa chọn trang nào', 'warning'); return;
      }

      // Update languages and prompt from the preview dropdowns to settings
      const targetLang = document.getElementById('preview-target-lang')?.value || '';
      const sourceLang = document.getElementById('preview-source-lang')?.value || 'auto';
      const promptTemplateId = document.getElementById('preview-prompt-template')?.value || 'default';

      const settings = await window.api.settings.load();
      settings.translateLanguage = targetLang;
      settings.sourceLanguage = sourceLang;
      settings.activePromptTemplate = promptTemplateId;
      
      const template = (settings.promptTemplates || []).find(t => t.id === promptTemplateId);
      if (template) {
        settings.customPrompt = template.prompt;
      }

      await window.api.settings.save(settings);

      UIManager.toast('Đang kiểm tra kết nối AI...', 'info');
      try {
        // BUG-06 fix: use provider-specific model, not the stale global settings.model
        const providerModel = ProviderUtils.resolveProviderModel(settings);
        const testRes = await window.api.ai.testConnection({
          provider: ProviderUtils.getProviderId(settings),
          model: providerModel,
        });
        if (!testRes.success) {
          UIManager.toast(`Lỗi AI: ${testRes.message}. Vui lòng kiểm tra Cài đặt!`, 'error');
          return;
        }
      } catch (err) {
        UIManager.toast(`Lỗi hệ thống: ${err.message}`, 'error');
        return;
      }

      await TranslateController.startConvert(filePath, pages);
    });

    // Connect header start button to the main start button
    document.getElementById('btn-start-convert-header')?.addEventListener('click', () => {
      document.getElementById('btn-start-convert')?.click();
    });

    // Convert controls
    document.getElementById('btn-cancel-convert')?.addEventListener('click', () => TranslateController.cancel());
    document.getElementById('btn-pause-resume')?.addEventListener('click', () => TranslateController.togglePause());

    // Complete screen buttons
    document.getElementById('btn-save-docx')?.addEventListener('click', () => {
      TranslateController.saveDocxFile();
    });

    document.getElementById('btn-preview-translation')?.addEventListener('click', () => {
      const mdContent = TranslateController.getFullMarkdown();
      if (!mdContent) {
        UIManager.toast('Không có nội dung để xem trước', 'error');
        return;
      }
      
      const modal = document.getElementById('preview-modal');
      const content = document.getElementById('preview-modal-content');
      const footer = modal?.querySelector('.modal-footer');
      const closeBtn = document.getElementById('btn-close-preview-modal');
      
      if (modal && content) {
        content.textContent = mdContent;
        if (footer) footer.style.display = 'none';
        modal.style.display = 'flex';
        
        const onClose = () => {
          modal.style.display = 'none';
          if (footer) footer.style.display = 'flex';
          closeBtn?.removeEventListener('click', onClose);
        };
        closeBtn?.addEventListener('click', onClose);
      }
    });

    document.getElementById('btn-open-docx')?.addEventListener('click', () => {
      const p = TranslateController.getLastOutputPath();
      if (p) window.api.shell.openPath(p);
    });
    
    document.getElementById('btn-export-markdown')?.addEventListener('click', async () => {
      const mdContent = TranslateController.getFullMarkdown();
      if (!mdContent) {
        UIManager.toast('Không có nội dung Markdown để xuất', 'error');
        return;
      }
      
      const inputPath = TranslateController.getLastInputPath();
      const baseName = inputPath ? inputPath.split(/[\\/]/).pop().replace(/\.[^/.]+$/, '.md') : 'bản_dịch.md';
      
      const savePath = await window.api.dialog.saveFile(baseName);
      if (!savePath) return; // User canceled
      
      try {
        await window.api.fs.writeFile(savePath, mdContent);
        UIManager.toast('Xuất Markdown thành công!', 'success');
        window.api.shell.showInFolder(savePath);
      } catch (err) {
        UIManager.toast(`Lỗi khi xuất Markdown: ${err.message}`, 'error');
      }
    });

    document.getElementById('btn-open-folder')?.addEventListener('click', () => {
      const p = TranslateController.getLastOutputPath();
      if (p) window.api.shell.showInFolder(p);
    });
    document.getElementById('btn-convert-another')?.addEventListener('click', () => UIManager.showView('home'));
    document.getElementById('btn-clear-recent')?.addEventListener('click', async () => {
      await window.api.settings.set('recentFiles', []);
      currentRecentPage = 1;
      loadRecentFiles();
      UIManager.toast('Đã xóa lịch sử file gần đây', 'success');
    });

    document.getElementById('btn-recent-prev')?.addEventListener('click', () => {
      if (currentRecentPage > 1) {
        currentRecentPage--;
        loadRecentFiles();
      }
    });

    document.getElementById('btn-recent-next')?.addEventListener('click', () => {
      currentRecentPage++;
      loadRecentFiles();
    });

    // Settings UI
    SettingsUI.init();

    // Load recent files
    loadRecentFiles();

    // Lần dịch bị đứt vì app tắt giữa chừng: ghi phần đã dịch vào Lịch sử.
    // Dọn checkpoint cũ phải chạy SAU khi khôi phục, không thì một lần dịch bỏ
    // dở 8 ngày trước bị xoá trước khi kịp vào Lịch sử.
    TranslateController.recoverUnfinishedRuns()
      .catch(err => console.error('Lỗi khôi phục lần dịch dang dở:', err))
      .then(() => window.api?.checkpoint?.prune?.(7))
      .catch(() => { /* dọn dẹp hỏng thì thôi, không ảnh hưởng người dùng */ });

    // Update provider badge in sidebar
    await updateProviderBadge();

    // Listen for files from main process menu
    window.api.on('files:selected', (paths) => handleFilesSelected(paths));

    // ── Keyboard Shortcuts ──────────────────────────────────────
    document.addEventListener('keydown', (e) => {
      // Don't trigger shortcuts when typing in inputs/textareas
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const activeView = document.querySelector('.view.active')?.id;

      // Ctrl+O — Open file (global)
      if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        document.getElementById('btn-browse')?.click();
      }
      // Ctrl+Enter — Start translation (preview view)
      if (e.ctrlKey && e.key === 'Enter' && activeView === 'view-preview') {
        e.preventDefault();
        document.getElementById('btn-start-convert')?.click();
      }
      // Escape — Cancel conversion (convert view)
      if (e.key === 'Escape' && activeView === 'view-convert') {
        e.preventDefault();
        TranslateController.cancel();
      }
      // Space — Pause/Resume (convert view)
      if (e.key === ' ' && activeView === 'view-convert') {
        e.preventDefault();
        TranslateController.togglePause();
      }
    });
  }



  async function updateProviderBadge() {
    const s = await window.api.settings.load();
    const meta = ProviderUtils.getProviderMeta(s);
    const modelName = ProviderUtils.resolveProviderModel(s);
    const displayText = modelName ? `${meta.label} · ${modelName}` : meta.label;

    // Update sidebar badge
    const dot = document.getElementById('sidebar-provider-dot');
    const name = document.getElementById('sidebar-provider-name');
    if (dot) dot.style.background = meta.color;
    if (name) {
      name.textContent = displayText;
      name.style.color = meta.color;
    }

    // Update titlebar badge
    const titleDot = document.getElementById('titlebar-provider-dot');
    const titleName = document.getElementById('titlebar-provider-name');
    if (titleDot) titleDot.style.background = meta.color;
    if (titleName) {
      titleName.textContent = displayText;
      titleName.style.color = meta.color;
    }

    // Update convert view info
    const convertInfo = document.getElementById('convert-provider-info');
    if (convertInfo) convertInfo.textContent = `AI: ${displayText}`;
  }

  async function handleFilesSelected(paths) {
    if (!paths?.length) return;

    if (paths.length > 1) {
      UIManager.toast('Chỉ hỗ trợ một file mỗi lần. Đang mở file đầu tiên.', 'info');
      paths = [paths[0]];
    }

    const filePath = paths[0];
    const ext = filePath.split('.').pop().toLowerCase();
    

    // Save to recent files
    const recentList = await window.api.settings.get('recentFiles') || [];
    await window.api.settings.set('recentFiles',
      [filePath, ...recentList.filter(f => f !== filePath)].slice(0, 50)
    );

    currentRecentPage = 1;
    loadRecentFiles();

    document.getElementById('preview-filename').textContent = filePath.split(/[\\/]/).pop();

    if (ext === 'pdf') {
      UIManager.toast('Đang tải PDF...', 'info');
      try {
        const { pageCount, fileSize } = await PDFRenderer.loadFile(filePath);
        document.getElementById('preview-meta').textContent = `${pageCount} trang · ${UIManager.formatSize(fileSize)}`;
        
        const settings = await window.api.settings.load();
        const previewLangDropdown = document.getElementById('preview-target-lang');
        if (previewLangDropdown) {
          previewLangDropdown.value = settings.translateLanguage !== undefined ? settings.translateLanguage : 'Tiếng Việt';
        }

        // Restore canvas and thumbnails
        const mockViewer = document.getElementById('pdf-mock-viewer');
        if (mockViewer) mockViewer.style.display = 'none';
        const canvas = document.getElementById('pdf-main-canvas');
        if (canvas) canvas.style.display = 'block';
        const zoomControls = document.getElementById('pdf-zoom-controls');
        if (zoomControls) zoomControls.style.display = 'flex';
        const thumbPanel = document.getElementById('thumbnail-panel');
        if (thumbPanel) thumbPanel.style.display = 'flex';
        
        UIManager.showView('preview');
      } catch (err) {
        UIManager.toast(`Không thể tải PDF: ${err.message}`, 'error');
      }
    } else {
      UIManager.toast('Định dạng không được hỗ trợ', 'error');
    }
  }

  async function loadRecentFiles() {
    const recent = await window.api.settings.get('recentFiles') || [];
    const recentList = document.getElementById('recent-list');
    const paginationEl = document.getElementById('recent-pagination');
    const pageInfoEl = document.getElementById('recent-page-info');
    
    if (!recentList) return;

    if (!recent.length) {
      recentList.innerHTML = `<p class="text-muted text-sm text-center" style="padding:var(--space-lg)" data-i18n="home.no_recent">Chưa có file nào</p>`;
      if (paginationEl) paginationEl.style.display = 'none';
      return;
    }

    const pageSize = 5;
    const totalPages = Math.ceil(recent.length / pageSize);
    if (currentRecentPage > totalPages) currentRecentPage = totalPages;
    if (currentRecentPage < 1) currentRecentPage = 1;

    // Show/hide pagination
    if (paginationEl) {
      if (totalPages > 1) {
        paginationEl.style.display = 'flex';
        if (pageInfoEl) pageInfoEl.textContent = `Trang ${currentRecentPage} / ${totalPages}`;
        
        const prevBtn = document.getElementById('btn-recent-prev');
        const nextBtn = document.getElementById('btn-recent-next');
        if (prevBtn) prevBtn.disabled = currentRecentPage === 1;
        if (nextBtn) nextBtn.disabled = currentRecentPage === totalPages;
      } else {
        paginationEl.style.display = 'none';
      }
    }

    recentList.innerHTML = '';
    const startIndex = (currentRecentPage - 1) * pageSize;
    const paginatedItems = recent.slice(startIndex, startIndex + pageSize);

    paginatedItems.forEach(f => {
      const item = document.createElement('div');
      item.className = 'recent-item';
      item.onclick = () => App.openRecent(f);
      
      const icon = document.createElement('div');
      icon.className = 'recent-item-icon';
      icon.textContent = '📄';
      
      const info = document.createElement('div');
      info.className = 'recent-item-info';
      
      const name = document.createElement('div');
      name.className = 'recent-item-name';
      name.textContent = f.split(/[\\/]/).pop();
      
      const path = document.createElement('div');
      path.className = 'recent-item-path';
      path.textContent = f;
      
      info.appendChild(name);
      info.appendChild(path);
      item.appendChild(icon);
      item.appendChild(info);
      recentList.appendChild(item);
    });
  }

  function openRecent(filePath) {
    handleFilesSelected([filePath]);
  }

  // Start app when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { handleFilesSelected, openRecent, updateProviderBadge };
})();
