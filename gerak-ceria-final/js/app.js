// ══════════════════════════════════════════
// APP.JS — Main Application Controller
// Gerak Ceria AI Adventure (Redesigned)
// ══════════════════════════════════════════

/** Show a named screen, hide all others */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');

  switch(id) {
    case 'mainMenu':
      updateMenuUI();
      if (window.Mascot) Mascot.startRotatingTips();
      break;
    case 'missionMap':
      if (window.MissionMap) MissionMap.render();
      break;
    case 'badgeScreen':
      if (window.BadgeSystem) BadgeSystem.render();
      break;
    case 'portfolioScreen':
      if (window.Portfolio) Portfolio.render();
      break;
    case 'settingsScreen':
      if (window.Settings) Settings.load();
      break;
    case 'referenceScreen':
      if (window.ReferenceManager) ReferenceManager.init();
      break;
    default:
      if (window.Mascot) Mascot.stopRotatingTips();
  }
}

function updateMenuUI() {
  const s = GameState.getState();

  const nameEl = document.getElementById('menuPlayerName');
  if (nameEl) nameEl.textContent = s.playerName || '';

  const lvlEl = document.getElementById('menuPlayerLevel');
  if (lvlEl) lvlEl.textContent = s.level || 1;

  const energyEl = document.getElementById('menuEnergy');
  if (energyEl) energyEl.textContent = s.energy || 0;

  const energyBar = document.getElementById('menuEnergyBar');
  if (energyBar) energyBar.style.width = Math.min(100, s.energy || 0) + '%';

  const starsEl = document.getElementById('menuStars');
  if (starsEl) starsEl.textContent = s.stars || 0;
}

function showToast(msg, duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), duration);
}

function closeQRModal() {
  document.getElementById('qrModal').classList.add('hidden');
}

// ─── INIT ───
window.addEventListener('DOMContentLoaded', () => {
  GameState.load();

  const btnSplash = document.getElementById('btnSplashStart');
  if (btnSplash) btnSplash.addEventListener('click', () => showScreen('mainMenu'));

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const splash = document.getElementById('splashScreen');
  if (splash) splash.classList.add('active');

  window.showScreen   = showScreen;
  window.showToast    = showToast;
  window.closeQRModal = closeQRModal;
  window.updateMenuUI = updateMenuUI;

  console.log('[Gerak Ceria] App initialized ✅');
});
