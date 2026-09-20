/**
 * dashboard-ui.js — Controller for statistics reporting and visualization
 */
window.DashboardUI = (() => {
  let isInitialized = false;
  let cachedStats = [];

  async function init() {
    if (isInitialized) return;
    
    // Add "Dashboard" button to navigation sidebar dynamically (similar to HistoryUI)
    const settingsBtn = document.getElementById('nav-settings');
    const targetContainer = settingsBtn ? settingsBtn.parentNode : (document.querySelector('.nav-section') || document.getElementById('sidebar'));
    
    if (targetContainer && !document.getElementById('nav-dashboard')) {
      const dashBtn = document.createElement('button');
      dashBtn.className = 'nav-item';
      dashBtn.id = 'nav-dashboard';
      dashBtn.dataset.view = 'dashboard';
      dashBtn.innerHTML = `
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" style="width: 18px; height: 18px;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
        <span>Thống kê</span>
      `;
      
      if (settingsBtn) {
        targetContainer.insertBefore(dashBtn, settingsBtn);
      } else {
        targetContainer.appendChild(dashBtn);
      }
 
      dashBtn.addEventListener('click', () => {
        UIManager.showView('dashboard');
        loadDashboard();
      });
    }

    let redrawTimeout;
    const triggerRedraw = () => {
      if (redrawTimeout) clearTimeout(redrawTimeout);
      redrawTimeout = setTimeout(() => {
        renderDashboardForPeriod();
      }, 50);
    };

    // Wire up filter change listeners
    document.getElementById('dash-period-select')?.addEventListener('change', triggerRedraw);
    document.getElementById('chart-view-select')?.addEventListener('change', triggerRedraw);

    // Wire up statistics cleanup modal logic
    document.getElementById('btn-reset-stats')?.addEventListener('click', () => {
      const modal = document.getElementById('stats-cleanup-modal');
      if (modal) modal.style.display = 'flex';
    });

    const closeModal = () => {
      const modal = document.getElementById('stats-cleanup-modal');
      if (modal) modal.style.display = 'none';
    };

    document.getElementById('btn-close-cleanup-modal')?.addEventListener('click', closeModal);
    document.getElementById('btn-cancel-cleanup')?.addEventListener('click', closeModal);

    document.getElementById('btn-confirm-cleanup')?.addEventListener('click', async () => {
      const type = document.getElementById('cleanup-time-select')?.value;
      if (!type) return;

      let confirmMsg = 'Bạn có chắc chắn muốn dọn dẹp thống kê?';
      if (type === 'all') {
        confirmMsg = 'Bạn có chắc chắn muốn XÓA TOÀN BỘ thống kê? Thao tác này không thể khôi phục!';
      }
      const ok = await window.api.dialog.confirm({
        message: confirmMsg,
        title: 'Xác nhận dọn dẹp'
      });
      if (ok) {
        try {
          if (type === 'all') {
            await window.api.stats.clear();
            UIManager.toast('Đã xóa toàn bộ thống kê', 'success');
          } else {
            const days = parseInt(type, 10);
            const res = await window.api.stats.deleteOlderThan(days);
            UIManager.toast(`Đã xóa ${res.deletedCount || 0} bản ghi thống kê cũ`, 'success');
          }
          closeModal();
          await loadDashboard(); // Reload statistics
        } catch (err) {
          UIManager.toast(`Lỗi dọn dẹp thống kê: ${err.message}`, 'error');
        }
      }
    });

    isInitialized = true;
  }

  async function loadDashboard() {
    try {
      // Load stats from independent stats log instead of deletable history
      cachedStats = await window.api.stats.getAll();
      renderDashboardForPeriod();
    } catch (err) {
      console.error('Lỗi khi tải dashboard:', err);
    }
  }

  function renderDashboardForPeriod() {
    const period = document.getElementById('dash-period-select')?.value || 'all';
    const now = new Date();
    
    // Filter statistics records based on selected period
    const filtered = cachedStats.filter(item => {
      if (!item.timestamp) return false;
      const date = new Date(item.timestamp);
      
      if (period === 'today') {
        return date.toDateString() === now.toDateString();
      } else if (period === 'month') {
        return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
      } else if (period === 'year') {
        return date.getFullYear() === now.getFullYear();
      }
      return true; // 'all'
    });

    // 1. Calculate basic statistics
    //
    // "Tổng tài liệu" đếm theo đường dẫn file, không phải số bản ghi. Dịch đi
    // dịch lại cùng một file vẫn là MỘT tài liệu; số lần dịch nằm ở thẻ riêng.
    // Bản ghi cũ (trước 1.2.10) không có documentKey/runId nên được đếm mỗi
    // bản một đơn vị, giữ nguyên con số người dùng đã quen thấy.
    const docKeys = new Set();
    const runKeys = new Set();
    filtered.forEach((item, i) => {
      docKeys.add(item.documentKey || `cu:${i}`);
      runKeys.add(item.runId || `cu:${i}`);
    });
    const totalFiles = docKeys.size;
    const totalRuns = runKeys.size;

    const totalTokens = filtered.reduce((sum, item) => sum + (item.totalTokens || 0), 0);
    const totalCost = filtered.reduce((sum, item) => sum + (item.costUSD || 0), 0);
    const totalPages = filtered.reduce((sum, item) => sum + (item.pagesProcessed || 0), 0);

    // Tỉ lệ thành công chỉ tính những lần chạy đến cùng. Người dùng bấm Huỷ là
    // lựa chọn của họ, không phải lỗi, mà trước đây vẫn bị kéo tụt tỉ lệ. Bản
    // ghi 'retry' là phần bù của một lần chạy, không phải một lần chạy riêng.
    const finishedRuns = filtered.filter(item => {
      const st = item.status || (item.success === false ? 'cancelled' : 'completed');
      return st !== 'cancelled' && st !== 'interrupted' && st !== 'retry';
    });
    const successCount = finishedRuns.filter(item =>
      (item.status || 'completed') === 'completed' && item.success !== false).length;
    const successRate = finishedRuns.length > 0
      ? Math.round((successCount / finishedRuns.length) * 100) : 0;
    
    // Update Summary DOM Cards
    setText('dash-total-files', totalFiles);
    setText('dash-total-runs', totalRuns);
    setText('dash-total-pages', totalPages);
    setText('dash-total-tokens', totalTokens.toLocaleString('vi-VN'));
    setText('dash-total-cost', `$${totalCost.toFixed(4)}`);
    setText('dash-success-rate', `${successRate}%`);
    
    // 2. Render chart (uses filtered stats to align with selected period filter)
    renderChart(filtered);

    // 3. Render breakdowns (filtered to the period)
    renderBreakdowns(filtered);
  }

  function renderChart(stats) {
    renderCostChart(stats);
    renderTokensChart(stats);
  }

  function renderCostChart(stats) {
    const canvas = document.getElementById('dashboard-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const chartView = document.getElementById('chart-view-select')?.value || 'day';
    const dataPointsMap = {};
    const labels = [];
    const now = new Date();

    // Group stats data based on the chosen view (Day, Month, or Year)
    if (chartView === 'day') {
      document.getElementById('chart-title').textContent = 'Chi phí 14 ngày qua (USD)';
      // Group by past 14 days
      for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
        dataPointsMap[dateStr] = 0;
        labels.push(dateStr);
      }
      stats.forEach(item => {
        if (!item.timestamp) return;
        const dateStr = new Date(item.timestamp).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
        if (dataPointsMap[dateStr] !== undefined) {
          dataPointsMap[dateStr] += (item.costUSD || 0);
        }
      });
    } else if (chartView === 'month') {
      document.getElementById('chart-title').textContent = 'Chi phí 12 tháng qua (USD)';
      // Group by past 12 months
      for (let i = 11; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const dateStr = d.toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' });
        dataPointsMap[dateStr] = 0;
        labels.push(dateStr);
      }
      stats.forEach(item => {
        if (!item.timestamp) return;
        const dateStr = new Date(item.timestamp).toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' });
        if (dataPointsMap[dateStr] !== undefined) {
          dataPointsMap[dateStr] += (item.costUSD || 0);
        }
      });
    } else if (chartView === 'year') {
      document.getElementById('chart-title').textContent = 'Chi phí theo các năm (USD)';
      // Group by past 5 years
      const currentYear = now.getFullYear();
      for (let i = 4; i >= 0; i--) {
        const year = currentYear - i;
        const dateStr = `${year}`;
        dataPointsMap[dateStr] = 0;
        labels.push(dateStr);
      }
      stats.forEach(item => {
        if (!item.timestamp) return;
        const dateStr = `${new Date(item.timestamp).getFullYear()}`;
        if (dataPointsMap[dateStr] !== undefined) {
          dataPointsMap[dateStr] += (item.costUSD || 0);
        }
      });
    }

    const dataPoints = labels.map(label => dataPointsMap[label]);
    const maxVal = Math.max(...dataPoints, 0.005) * 1.15; // 15% padding on top for values
    
    // Support High DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || 600;
    const cssHeight = rect.height || 240;
    
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    ctx.scale(dpr, dpr);
    
    // Clear canvas
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    
    const styles = getComputedStyle(document.body);
    const colorBorder = styles.getPropertyValue('--border').trim() || '#e3ddcf';
    const colorTextSec = styles.getPropertyValue('--text-secondary').trim() || '#6f675a';
    const colorTextPri = styles.getPropertyValue('--text-primary').trim() || '#1b1813';
    const colorAccent = styles.getPropertyValue('--accent').trim() || '#c8502d';

    const paddingLeft = 55;
    const paddingRight = 15;
    const paddingTop = 25;
    const paddingBottom = 35;
    const width = cssWidth - paddingLeft - paddingRight;
    const height = cssHeight - paddingTop - paddingBottom;
    
    // Draw Y-axis grid lines and cost labels
    ctx.strokeStyle = colorBorder;
    ctx.lineWidth = 1;
    ctx.fillStyle = colorTextSec;
    ctx.font = '10px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'right';
    
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const yVal = (maxVal / gridCount) * i;
      const y = paddingTop + height - (height / gridCount) * i;
      
      ctx.beginPath();
      if (i > 0) {
        ctx.setLineDash([4, 4]); // Dashed lines for interior grid
      } else {
        ctx.setLineDash([]); // Solid base line
      }
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(paddingLeft + width, y);
      ctx.stroke();
      
      ctx.fillText(`$${yVal.toFixed(4)}`, paddingLeft - 8, y + 3);
    }
    
    // Draw columns (Bar chart)
    const barWidth = Math.max((width / labels.length) * 0.45, 10);
    const colWidth = width / labels.length;
    
    ctx.setLineDash([]); // Reset line dash
    
    labels.forEach((label, i) => {
      const cost = dataPoints[i];
      const barHeight = (cost / maxVal) * height;
      const x = paddingLeft + i * colWidth + (colWidth - barWidth) / 2;
      const y = paddingTop + height - barHeight;
      
      if (barHeight > 0) {
        // Minimal flat bar color (Highlight the latest column in terracotta accent)
        ctx.fillStyle = (i === labels.length - 1) ? colorAccent : colorTextPri;
        drawRoundedRect(ctx, x, y, barWidth, barHeight, 2);
        
        // Render precise value above bar
        ctx.fillStyle = colorTextPri;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`$${cost.toFixed(3)}`, x + barWidth / 2, y - 5);
      }
      
      // Draw X-axis date labels
      ctx.fillStyle = colorTextSec;
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, x + barWidth / 2, paddingTop + height + 16);
    });
  }

  function renderTokensChart(stats) {
    const canvas = document.getElementById('dashboard-tokens-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const chartView = document.getElementById('chart-view-select')?.value || 'day';
    const dataPointsMap = {};
    const labels = [];
    const now = new Date();

    // Group stats data based on the chosen view (Day, Month, or Year)
    if (chartView === 'day') {
      document.getElementById('tokens-chart-title').textContent = 'Tokens tiêu thụ 14 ngày qua';
      // Group by past 14 days
      for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
        dataPointsMap[dateStr] = 0;
        labels.push(dateStr);
      }
      stats.forEach(item => {
        if (!item.timestamp) return;
        const dateStr = new Date(item.timestamp).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
        if (dataPointsMap[dateStr] !== undefined) {
          dataPointsMap[dateStr] += (item.totalTokens || 0);
        }
      });
    } else if (chartView === 'month') {
      document.getElementById('tokens-chart-title').textContent = 'Tokens tiêu thụ 12 tháng qua';
      // Group by past 12 months
      for (let i = 11; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const dateStr = d.toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' });
        dataPointsMap[dateStr] = 0;
        labels.push(dateStr);
      }
      stats.forEach(item => {
        if (!item.timestamp) return;
        const dateStr = new Date(item.timestamp).toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric' });
        if (dataPointsMap[dateStr] !== undefined) {
          dataPointsMap[dateStr] += (item.totalTokens || 0);
        }
      });
    } else if (chartView === 'year') {
      document.getElementById('tokens-chart-title').textContent = 'Tokens tiêu thụ theo các năm';
      // Group by past 5 years
      const currentYear = now.getFullYear();
      for (let i = 4; i >= 0; i--) {
        const year = currentYear - i;
        const dateStr = `${year}`;
        dataPointsMap[dateStr] = 0;
        labels.push(dateStr);
      }
      stats.forEach(item => {
        if (!item.timestamp) return;
        const dateStr = `${new Date(item.timestamp).getFullYear()}`;
        if (dataPointsMap[dateStr] !== undefined) {
          dataPointsMap[dateStr] += (item.totalTokens || 0);
        }
      });
    }

    const dataPoints = labels.map(label => dataPointsMap[label]);
    const maxVal = Math.max(...dataPoints, 1000) * 1.15; // 15% padding on top for values
    
    // Support High DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width || 600;
    const cssHeight = rect.height || 240;
    
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
    ctx.scale(dpr, dpr);
    
    // Clear canvas
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    
    const styles = getComputedStyle(document.body);
    const colorBorder = styles.getPropertyValue('--border').trim() || '#e3ddcf';
    const colorTextSec = styles.getPropertyValue('--text-secondary').trim() || '#6f675a';
    const colorTextPri = styles.getPropertyValue('--text-primary').trim() || '#1b1813';
    const colorWarning = styles.getPropertyValue('--warning').trim() || '#f97316';

    const paddingLeft = 55;
    const paddingRight = 15;
    const paddingTop = 25;
    const paddingBottom = 35;
    const width = cssWidth - paddingLeft - paddingRight;
    const height = cssHeight - paddingTop - paddingBottom;
    
    // Draw Y-axis grid lines and labels
    ctx.strokeStyle = colorBorder; // var(--border) warm line
    ctx.lineWidth = 1;
    ctx.fillStyle = colorTextSec; // var(--text-secondary)
    ctx.font = '10px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'right';
    
    const formatCompactNumber = (num) => {
      if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
      return num.toString();
    };
    
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const yVal = (maxVal / gridCount) * i;
      const y = paddingTop + height - (height / gridCount) * i;
      
      ctx.beginPath();
      if (i > 0) {
        ctx.setLineDash([4, 4]); // Dashed lines for interior grid
      } else {
        ctx.setLineDash([]); // Solid base line
      }
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(paddingLeft + width, y);
      ctx.stroke();
      
      ctx.fillText(formatCompactNumber(yVal), paddingLeft - 8, y + 3);
    }
    
    // Draw columns (Bar chart)
    const barWidth = Math.max((width / labels.length) * 0.45, 10);
    const colWidth = width / labels.length;
    
    ctx.setLineDash([]); // Reset line dash
    
    labels.forEach((label, i) => {
      const tokens = dataPoints[i];
      const barHeight = (tokens / maxVal) * height;
      const x = paddingLeft + i * colWidth + (colWidth - barWidth) / 2;
      const y = paddingTop + height - barHeight;
      
      if (barHeight > 0) {
        // Vibrant orange highlight for the latest column, charcoal/primary for others
        ctx.fillStyle = (i === labels.length - 1) ? colorWarning : colorTextPri;
        drawRoundedRect(ctx, x, y, barWidth, barHeight, 2);
        
        // Render precise value above bar
        ctx.fillStyle = colorTextPri;
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(formatCompactNumber(tokens), x + barWidth / 2, y - 5);
      }
      
      // Draw X-axis labels
      ctx.fillStyle = colorTextSec;
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, x + barWidth / 2, paddingTop + height + 16);
    });
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
  }

  function renderBreakdowns(stats) {
    const modelData = {};
    const langData = {};
    
    stats.forEach(item => {
      // Group by Model
      const model = item.model || 'Unknown';
      if (!modelData[model]) {
        modelData[model] = { count: 0, pages: 0, tokens: 0, cost: 0 };
      }
      modelData[model].count++;
      modelData[model].pages += (item.pagesProcessed || 0);
      modelData[model].tokens += (item.totalTokens || 0);
      modelData[model].cost += (item.costUSD || 0);
      
      // Group by Target Language
      const lang = item.targetLang || 'Giữ nguyên';
      if (!langData[lang]) {
        langData[lang] = 0;
      }
      langData[lang]++;
    });
    
    // Render Model Breakdown Table
    const tbody = document.getElementById('dash-model-breakdown');
    if (tbody) {
      tbody.innerHTML = Object.entries(modelData).map(([model, data]) => `
        <tr style="border-bottom: 1px solid var(--border);">
          <td style="padding: 10px 8px; font-weight: 500; color: var(--text-primary);">${UIManager.escapeHtml(model)}</td>
          <td style="padding: 10px 8px;">${data.count}</td>
          <td style="padding: 10px 8px;">${data.pages}</td>
          <td style="padding: 10px 8px;">${data.tokens.toLocaleString('vi-VN')}</td>
          <td style="padding: 10px 8px; color: var(--success); font-weight: 500;">$${data.cost.toFixed(4)}</td>
        </tr>
      `).join('') || '<tr><td colspan="5" style="text-align:center; padding: 20px; color: var(--text-secondary);">Chưa có dữ liệu</td></tr>';
    }
    
    // Render Language Breakdown Table
    const langBody = document.getElementById('dash-lang-breakdown');
    if (langBody) {
      langBody.innerHTML = Object.entries(langData)
        .sort((a, b) => b[1] - a[1])
        .map(([lang, count]) => `
          <tr style="border-bottom: 1px solid var(--border);">
            <td style="padding: 10px 8px; font-weight: 500; color: var(--text-primary);">${UIManager.escapeHtml(lang)}</td>
            <td style="padding: 10px 8px;">${count} lần dịch</td>
          </tr>
        `).join('') || '<tr><td colspan="2" style="text-align:center; padding: 20px; color: var(--text-secondary);">Chưa có dữ liệu</td></tr>';
    }
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  return { init, loadDashboard };
})();
