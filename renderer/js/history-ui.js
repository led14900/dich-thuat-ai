class HistoryUI {
  static currentHistoryPage = 1;
  static pageSize = 10;

  static async init() {
    // Add "History" button to nav if not exists
    let navContainer = document.querySelector('.nav-section');
    if (navContainer && !document.getElementById('nav-history')) {
      const historyBtn = document.createElement('button');
      historyBtn.className = 'nav-item';
      historyBtn.id = 'nav-history';
      historyBtn.dataset.view = 'history';
      historyBtn.innerHTML = `
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        <span>Lịch sử</span>
      `;
      navContainer.appendChild(historyBtn);

      historyBtn.addEventListener('click', () => {
        UIManager.showView('history');
        this.currentHistoryPage = 1; // Reset to page 1 on view enter
        this.loadHistory();
      });
    }

    // Modal view logic
    document.getElementById('btn-close-history-modal')?.addEventListener('click', () => {
      document.getElementById('history-preview-modal').style.display = 'none';
    });

    document.getElementById('btn-clear-history')?.addEventListener('click', () => {
      this._confirmAndExecute(
        'Bạn có chắc chắn muốn xóa toàn bộ lịch sử dịch thuật?',
        () => {
          this.currentHistoryPage = 1;
          return window.api.history.clear();
        },
        'Đã xóa toàn bộ lịch sử'
      );
    });

    // Pagination events
    document.getElementById('btn-history-prev')?.addEventListener('click', () => {
      if (this.currentHistoryPage > 1) {
        this.currentHistoryPage--;
        this.loadHistory();
      }
    });

    document.getElementById('btn-history-next')?.addEventListener('click', () => {
      this.currentHistoryPage++;
      this.loadHistory();
    });
  }

  static async loadHistory() {
    const listEl = document.getElementById('history-list');
    const paginationEl = document.getElementById('history-pagination');
    const pageInfoEl = document.getElementById('history-page-info');

    if (!listEl) return;

    listEl.innerHTML = '<div style="text-align:center; padding: 40px; color: var(--text-secondary);">Đang tải lịch sử...</div>';

    try {
      const response = await window.api.history.getAll({
        page: this.currentHistoryPage,
        pageSize: this.pageSize
      });

      const history = response?.items || [];
      const totalCount = response?.total || 0;
      
      if (history.length === 0) {
        listEl.innerHTML = `
          <tr>
            <td colspan="6" style="text-align:center; padding: 80px 20px; color: var(--text-secondary);">
              <div style="display:flex; flex-direction:column; align-items:center; gap: 12px;">
                <svg style="width: 48px; height: 48px; opacity: 0.4; color: var(--text-muted);" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <div style="font-size: 14px; font-weight: 500; color: var(--text-primary);">Chưa có dữ liệu lịch sử</div>
                <div style="font-size: 13px;">Các tài liệu bạn dịch sẽ tự động xuất hiện tại đây.</div>
              </div>
            </td>
          </tr>
        `;
        if (paginationEl) paginationEl.style.display = 'none';
        return;
      }

      const totalPages = Math.ceil(totalCount / this.pageSize);
      if (this.currentHistoryPage > totalPages) this.currentHistoryPage = totalPages;
      if (this.currentHistoryPage < 1) this.currentHistoryPage = 1;

      // Update UI pagination buttons
      if (paginationEl) {
        if (totalPages > 1) {
          paginationEl.style.display = 'flex';
          if (pageInfoEl) pageInfoEl.textContent = `Trang ${this.currentHistoryPage} / ${totalPages}`;
          
          const prevBtn = document.getElementById('btn-history-prev');
          const nextBtn = document.getElementById('btn-history-next');
          if (prevBtn) prevBtn.disabled = this.currentHistoryPage === 1;
          if (nextBtn) nextBtn.disabled = this.currentHistoryPage === totalPages;
        } else {
          paginationEl.style.display = 'none';
        }
      }

      listEl.innerHTML = '';
      const paginatedItems = history;
      const escapeHtml = (str) => {
        if (!str) return '';
        return str.replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/"/g, '&quot;')
                  .replace(/'/g, '&#039;');
      };

      paginatedItems.forEach(item => {
        const date = new Date(item.timestamp).toLocaleString('vi-VN');
        const filename = item.inputFile ? item.inputFile.split(/[\\/]/).pop() : 'Tài liệu không tên';
        const cost = item.costUSD ? `$${item.costUSD.toFixed(4)}` : '$0.0000';
        
        const escapedFilename = escapeHtml(filename);
        const escapedInputType = escapeHtml(item.inputType ? item.inputType.toUpperCase() : 'PDF');
        const escapedTargetLang = escapeHtml(item.targetLang || 'Tiếng Việt');

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <div style="font-weight: 500; color: var(--text-primary); margin-bottom: 4px;">
              ${escapedFilename}${item.success === false ? `
              <span style="margin-left:6px; font-size:11px; font-weight:500; color:var(--danger); border:1px solid var(--danger); border-radius:3px; padding:1px 5px;">Chưa hoàn tất</span>` : ''}
            </div>
            <div style="font-size: 11px; color: var(--text-secondary);">${date}</div>
          </td>
          <td>${escapedInputType}</td>
          <td>${item.pagesProcessed} / ${item.pageCount}</td>
          <td>${escapedTargetLang}</td>
          <td style="color: var(--success);">${cost}</td>
          <td>
            <div style="display:flex; gap: 8px; justify-content: flex-end;">
              <button class="btn btn-secondary btn-sm btn-view-history" data-id="${item.id}" title="Xem Markdown">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
              </button>
              <button class="btn btn-secondary btn-sm btn-download-word" data-id="${item.id}" title="Tải file Word (DOCX)">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
              </button>
              ${item.outputPath ? `
              <button class="btn btn-secondary btn-sm btn-open-word" data-path="${escapeHtml(item.outputPath)}" title="Mở file Word">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              </button>` : ''}
              <button class="btn btn-secondary btn-sm btn-delete-history" data-id="${item.id}" style="color: #ef4444;" title="Xóa">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
              </button>
            </div>
          </td>
        `;

        tr.querySelector('.btn-view-history')?.addEventListener('click', () => this.viewMarkdown(item.id));
        tr.querySelector('.btn-download-word')?.addEventListener('click', () => this.downloadWordFile(item));
        tr.querySelector('.btn-delete-history')?.addEventListener('click', () => this.deleteEntry(item.id));
        if (item.outputPath) {
          tr.querySelector('.btn-open-word')?.addEventListener('click', () => window.api.shell.openPath(item.outputPath));
        }

        listEl.appendChild(tr);
      });
    } catch (err) {
      listEl.innerHTML = `<div style="text-align:center; padding: 40px; color: #ef4444;">Lỗi tải lịch sử: ${err.message}</div>`;
    }
  }

  static async viewMarkdown(id) {
    try {
      const markdown = await window.api.history.getMarkdown(id);
      if (!markdown) {
        UIManager.toast('Không tìm thấy nội dung markdown cho mục này', 'error');
        return;
      }
      const modal = document.getElementById('history-preview-modal');
      const content = document.getElementById('history-preview-content');
      if (modal && content) {
        content.textContent = markdown;
        modal.style.display = 'flex';
      }
    } catch (err) {
      UIManager.toast(`Lỗi lấy markdown: ${err.message}`, 'error');
    }
  }

  static async deleteEntry(id) {
    await this._confirmAndExecute(
      'Bạn có chắc chắn muốn xóa bản ghi này?',
      () => window.api.history.delete(id),
      'Đã xóa'
    );
  }

  static async downloadWordFile(item) {
    try {
      const markdown = await window.api.history.getMarkdown(item.id);
      if (!markdown) {
        UIManager.toast('Không tìm thấy nội dung bản dịch', 'error');
        return;
      }

      const inputFilename = item.inputFile ? item.inputFile.split(/[\\/]/).pop() : 'bản_dịch';
      const defaultName = inputFilename.replace(/\.[^/.]+$/, '.docx');

      const savePath = await window.api.dialog.saveFile(defaultName);
      if (!savePath) return; // User cancelled

      UIManager.toast('Đang tạo file Word...', 'info');

      const settings = await window.api.settings.load();
      const docxSettings = {
        outputFont: settings.outputFont,
        outputFontSize: settings.outputFontSize,
        pageSize: settings.pageSize,
        translateLanguage: item.targetLang,
        translateMode: item.translateMode || 'bilingual',
        bilingual: item.translateMode === 'bilingual'
      };

      const pages = markdown.split(/\n+---\n+/).map((pageMarkdown, index) => ({
        page: index + 1,
        markdown: pageMarkdown.trim()
      }));

      await window.api.docx.generate({
        pages: pages,
        settings: docxSettings,
        outputPath: savePath
      });

      // Update the record's output path in database so they can open it later
      await window.api.history.updateOutputPath({ id: item.id, outputPath: savePath });

      UIManager.toast('Tải file Word thành công!', 'success');
      window.api.shell.showInFolder(savePath);
      
      // Reload list to show the "Open Word" button with the new path
      await this.loadHistory();
    } catch (err) {
      UIManager.toast(`Lỗi khi tải file Word: ${err.message}`, 'error');
    }
  }

  static async _confirmAndExecute(message, apiCall, successMessage) {
    const ok = await window.api.dialog.confirm({ message, title: 'Xác nhận xóa' });
    if (ok) {
      try {
        await apiCall();
        await this.loadHistory();
        UIManager.toast(successMessage, 'success');
      } catch (err) {
        UIManager.toast(`Lỗi: ${err.message}`, 'error');
      }
    }
  }
}

window.HistoryUI = HistoryUI;
