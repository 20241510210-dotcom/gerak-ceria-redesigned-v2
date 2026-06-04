// ══════════════════════════════════════════
// REFERENCE MANAGER — Movement Reference Upload
// Gerak Ceria AI Adventure
// ══════════════════════════════════════════

const ReferenceManager = (() => {
  let references = [];    // { id, name, type, url, fileType }
  let activeRefId = null;

  // Load from localStorage
  function load() {
    try {
      const saved = localStorage.getItem('gerak_references');
      if (saved) references = JSON.parse(saved);
    } catch(e) {
      references = [];
    }
    renderAll();
    updateCount();
  }

  // Save to localStorage (store object URLs are session-only, so store names + type hints)
  function save() {
    try {
      // Only save metadata (not blob URLs which are session-only)
      const meta = references.map(r => ({
        id: r.id, name: r.name, type: r.type, fileType: r.fileType
      }));
      localStorage.setItem('gerak_references_meta', JSON.stringify(meta));
    } catch(e) {}
  }

  // Process uploaded files
  function addFiles(files) {
    let added = 0;
    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return;
      if (file.size > 50 * 1024 * 1024) {
        showToast('File terlalu besar (maks 50MB): ' + file.name);
        return;
      }

      const url = URL.createObjectURL(file);
      const ref = {
        id: Date.now() + '_' + Math.random().toString(36).slice(2),
        name: file.name,
        type: file.type.startsWith('image/') ? 'image' : 'video',
        fileType: file.type,
        url: url,
        size: file.size
      };
      references.push(ref);
      added++;
    });

    if (added > 0) {
      renderAll();
      updateCount();
      showToast('✅ ' + added + ' file berhasil diupload!');
    }
  }

  // Remove a reference
  function remove(id) {
    const ref = references.find(r => r.id === id);
    if (ref) {
      URL.revokeObjectURL(ref.url);
      if (activeRefId === id) {
        activeRefId = null;
        updateOverlay(null, null);
        updateOverlay(null, 'challenge');
      }
    }
    references = references.filter(r => r.id !== id);
    renderAll();
    updateCount();
    showToast('🗑️ File dihapus');
  }

  // Clear all
  function clearAll() {
    references.forEach(r => URL.revokeObjectURL(r.url));
    references = [];
    activeRefId = null;
    updateOverlay(null, null);
    updateOverlay(null, 'challenge');
    renderAll();
    updateCount();
    showToast('🗑️ Semua referensi dihapus');
  }

  // Set active reference
  function setActive(id) {
    activeRefId = (activeRefId === id) ? null : id;
    const ref = activeRefId ? references.find(r => r.id === activeRefId) : null;
    renderAll(); // re-render to update active states

    // Update both overlays
    updateOverlay(ref, 'warmup');
    updateOverlay(ref, 'challenge');

    if (ref) showToast('📌 Referensi aktif: ' + ref.name);
    else showToast('📌 Referensi dinonaktifkan');
  }

  // Update overlay in camera panels
  function updateOverlay(ref, context) {
    const overlayId = context === 'challenge' ? 'challengeRefOverlay' : 'activeRefOverlay';
    const contentId = context === 'challenge' ? 'challengeRefContent' : 'activeRefContent';
    const overlay = document.getElementById(overlayId);
    const content = document.getElementById(contentId);
    if (!overlay || !content) return;

    if (!ref) {
      overlay.classList.add('hidden');
      content.innerHTML = '';
      return;
    }

    overlay.classList.remove('hidden');
    if (ref.type === 'image') {
      content.innerHTML = `<img src="${ref.url}" alt="${ref.name}" style="width:80px;height:60px;object-fit:cover;border-radius:8px;display:block;">`;
    } else {
      content.innerHTML = `<video src="${ref.url}" style="width:80px;height:60px;object-fit:cover;border-radius:8px;display:block;" muted loop autoplay playsinline></video>`;
    }
  }

  // Render reference list in all panels
  function renderAll() {
    renderToPanel('referencesList', 'full');
    renderToPanel('warmupRefPreviews', 'compact');
  }

  function renderToPanel(containerId, mode) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (references.length === 0) {
      container.innerHTML = '<div class="empty-refs">Belum ada file yang diupload. Upload gambar atau video gerakan untuk memulai!</div>';
      return;
    }

    container.innerHTML = '';
    references.forEach(ref => {
      const isActive = ref.id === activeRefId;
      const item = document.createElement('div');
      item.className = 'reference-preview-item';
      item.style.border = isActive ? '2px solid #22c55e' : '';

      let thumbHtml = '';
      if (ref.type === 'image') {
        thumbHtml = `<img src="${ref.url}" class="ref-thumb" alt="${ref.name}">`;
      } else {
        thumbHtml = `<div class="ref-video-thumb">🎬</div>`;
      }

      const sizeMB = ref.size ? (ref.size / 1024 / 1024).toFixed(1) : '?';

      item.innerHTML = `
        ${thumbHtml}
        <div class="ref-info">
          <div class="ref-name" title="${ref.name}">${ref.name}</div>
          <div class="ref-type">${ref.type === 'image' ? '🖼️ Gambar' : '🎬 Video'} • ${sizeMB}MB</div>
          ${isActive ? '<div class="ref-active-badge">✅ Aktif</div>' : ''}
        </div>
        <div class="ref-actions">
          <button class="btn-ref-use" onclick="ReferenceManager.setActive('${ref.id}')">
            ${isActive ? '✗ Nonaktif' : '📌 Aktif'}
          </button>
          <button class="btn-ref-delete" onclick="ReferenceManager.remove('${ref.id}')">🗑️</button>
        </div>
      `;
      container.appendChild(item);
    });

    // Update empty state indicator
    const emptyEl = document.getElementById('warmupRefEmpty');
    if (emptyEl) emptyEl.style.display = references.length > 0 ? 'none' : 'block';
  }

  function updateCount() {
    const countEl = document.getElementById('refCount');
    if (countEl) countEl.textContent = references.length;
  }

  // Setup drag-and-drop + file input for a drop zone
  function setupDropZone(dropZoneId, fileInputId) {
    const zone = document.getElementById(dropZoneId);
    const input = document.getElementById(fileInputId);
    if (!zone || !input) return;

    input.addEventListener('change', e => {
      if (e.target.files.length > 0) addFiles(e.target.files);
      e.target.value = '';
    });

    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    });
  }

  // Init
  function init() {
    load();
    setupDropZone('refDropZone', 'referenceFileInput');
    setupDropZone('warmupDropZone', 'warmupFileInput');
  }

  return {
    init, addFiles, remove, clearAll, setActive,
    getActive: () => references.find(r => r.id === activeRefId) || null,
    getAll: () => references
  };
})();

// Global access for buttons
window.ReferenceManager = ReferenceManager;

function clearAllReferences() {
  if (confirm('Hapus semua referensi gerakan?')) {
    ReferenceManager.clearAll();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  ReferenceManager.init();
});
