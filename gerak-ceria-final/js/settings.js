// ══════════════════════════════════════════
// settings.js — Settings Screen
// Gerak Ceria AI Adventure
// ══════════════════════════════════════════

(function() {
  function loadSettings() {
    const s = GameState.getState();
    const nameEl = document.getElementById('settingName');
    if (nameEl) nameEl.value = s.playerName || '';
    const soundEl = document.getElementById('settingSound');
    if (soundEl) soundEl.checked = s.settings?.sound !== false;
    const musicEl = document.getElementById('settingMusic');
    if (musicEl) musicEl.checked = s.settings?.music !== false;
    const trackEl = document.getElementById('settingTracking');
    if (trackEl) trackEl.checked = s.settings?.tracking !== false;
  }

  window.saveSettings = function() {
    const name = document.getElementById('settingName')?.value?.trim();
    const sound = document.getElementById('settingSound')?.checked;
    const music = document.getElementById('settingMusic')?.checked;
    const tracking = document.getElementById('settingTracking')?.checked;

    if (name) GameState.set('playerName', name);
    GameState.set('settings', { sound, music, tracking });

    // Update UI with saved name
    const menuName = document.getElementById('menuPlayerName');
    if (menuName && name) menuName.textContent = name;

    Audio.sfx.success();
    showToast('✅ Pengaturan disimpan!');
    showScreen('mainMenu');
  };

  window.resetGameData = function() {
    if (confirm('Hapus semua data? Ini tidak bisa dibatalkan!')) {
      GameState.reset();
      showToast('🗑️ Data dihapus.');
      showScreen('mainMenu');
      updateMenuUI();
    }
  };

  window.Settings = { load: loadSettings };
})();
