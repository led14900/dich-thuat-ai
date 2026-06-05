/**
 * ui-manager.js — View navigation and toast notifications
 */
window.UIManager = (() => {
  const views = ['home', 'preview', 'convert', 'complete', 'settings', 'about', 'history'];

  function showView(name) {
    views.forEach(v => {
      document.getElementById(`view-${v}`)?.classList.remove('active');
      document.querySelector(`[data-view="${v}"]`)?.classList.remove('active');
    });
    document.getElementById(`view-${name}`)?.classList.add('active');
    document.querySelector(`[data-view="${name}"]`)?.classList.add('active');
  }

  function toast(message, type = 'info', duration = 3500) {
    const icons = {
      success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️'
    };
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(30px)';
      el.style.transition = '300ms ease';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  function formatTime(ms) {
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  return { showView, toast, formatTime, formatSize };
})();

// Accordion toggle
function toggleAccordion(id) {
  document.getElementById(id)?.classList.toggle('open');
}
