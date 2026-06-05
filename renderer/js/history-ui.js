class HistoryUI {
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
        this.loadHistory();
      });
    }

    // Modal view logic
    document.getElementById('btn-close-history-modal')?.addEventListener('click', () => {
      document.getElementById('history-preview-modal').style.display = 'none';
    });

    document.getElementById('btn-clear-history')?.addEventListener('click', async () => {
      if (confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử dịch thuật?')) {
        await window.api.history.clear();
        await this.loadHistory();
        UIManager.toast('Đã xóa toàn bộ lịch sử', 'success');
      }
    });
  }

  static async loadHistory() {
    const listEl = document.getElementById('history-list');
    if (!listEl) return;

    listEl.innerHTML = '<div style="text-align:center; padding: 40px; color: var(--text-secondary);">Đang tải lịch sử...</div>';

    try {
      const history = await window.api.history.getAll();
      
      if (!history || history.length === 0) {
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
        return;
      }

      listEl.innerHTML = '';
      history.forEach(item => {
        const date = new Date(item.timestamp).toLocaleString('vi-VN');
        const filename = item.inputFile ? item.inputFile.split(/[\\/]/).pop() : 'Tài liệu không tên';
        const cost = item.costUSD ? `$${item.costUSD.toFixed(4)}` : '$0.0000';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <div style="font-weight: 500; color: var(--text-primary); margin-bottom: 4px;">${filename}</div>
            <div style="font-size: 11px; color: var(--text-secondary);">${date}</div>
          </td>
          <td>${item.inputType ? item.inputType.toUpperCase() : 'PDF'}</td>
          <td>${item.pagesProcessed} / ${item.pageCount}</td>
          <td>${item.targetLang}</td>
          <td style="color: var(--success);">${cost}</td>
          <td>
            <div style="display:flex; gap: 8px; justify-content: flex-end;">
              <button class="btn btn-secondary btn-sm btn-view-history" data-id="${item.id}" title="Xem Markdown">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
              </button>
              ${item.outputPath ? `
              <button class="btn btn-secondary btn-sm btn-open-word" data-path="${item.outputPath}" title="Mở file Word">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              </button>` : ''}
              <button class="btn btn-secondary btn-sm btn-delete-history" data-id="${item.id}" style="color: #ef4444;" title="Xóa">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
              </button>
            </div>
          </td>
        `;

        tr.querySelector('.btn-view-history')?.addEventListener('click', () => this.viewMarkdown(item.id));
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
    if (confirm('Bạn có chắc chắn muốn xóa bản ghi này?')) {
      await window.api.history.delete(id);
      await this.loadHistory();
      UIManager.toast('Đã xóa', 'success');
    }
  }
}

window.HistoryUI = HistoryUI;
