/**
 * drag-drop.js — Drag & drop and file selection for the drop zone
 */
window.DragDrop = (() => {
  function init(onFilesSelected) {
    const dz = document.getElementById('dropzone');
    if (!dz) return;

    ['dragenter', 'dragover'].forEach(e => dz.addEventListener(e, ev => {
      ev.preventDefault(); dz.classList.add('drag-over');
    }));
    ['dragleave', 'drop'].forEach(e => dz.addEventListener(e, ev => {
      ev.preventDefault(); dz.classList.remove('drag-over');
    }));

    dz.addEventListener('drop', ev => {
      const allowedExts = ['.pdf', '.docx', '.pptx', '.jpg', '.jpeg', '.png'];
      const files = [...ev.dataTransfer.files].filter(f => {
        const name = f.name.toLowerCase();
        return allowedExts.some(ext => name.endsWith(ext));
      });
      if (files.length) {
        // Electron 12+ with contextIsolation strips file.path;
        // must use webUtils.getPathForFile() via preload bridge
        const paths = files.map(f => window.api.getPathForFile(f));
        onFilesSelected(paths);
      }
    });

    dz.addEventListener('click', async () => {
      const paths = await window.api.dialog.openFiles();
      if (paths?.length) onFilesSelected(paths);
    });

    document.getElementById('btn-browse')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      const paths = await window.api.dialog.openFiles();
      if (paths?.length) onFilesSelected(paths);
    });
  }

  return { init };
})();
