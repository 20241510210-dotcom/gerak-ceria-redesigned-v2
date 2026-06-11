// ══════════════════════════════════════════
// ui/badge.js — Badge System
// ══════════════════════════════════════════

const BADGES = [
  { id: 'warmup_king',   icon: '🔥', name: 'Raja Pemanasan',    desc: 'Selesaikan AI Warm-Up pertamamu!',         trigger: 'warmup_complete' },
  { id: 'sporty_kid',    icon: '🏃', name: 'Atlet Sportif',     desc: 'Main 5 sesi game apapun.',                 trigger: 'play_5' },
  { id: 'jump_master',   icon: '🏆', name: 'Master Lompat',     desc: 'Lakukan 20 lompatan dalam satu sesi.',     trigger: 'jump_20' },
  { id: 'team_player',   icon: '🤝', name: 'Atlet Gotong Royong',desc: 'Menangkan estafet tim.',                  trigger: 'relay_win' },
  { id: 'active_kid',    icon: '⚡', name: 'Anak Aktif',        desc: 'Bermain 3 hari berturut-turut.',           trigger: 'streak_3' },
  { id: 'star_collector',icon: '⭐', name: 'Kolektor Bintang',  desc: 'Kumpulkan 10 bintang dari mission.',       trigger: 'stars_10' },
  { id: 'challenge_hero',icon: '⚔️', name: 'Hero Challenge',    desc: 'Capai combo x5 di Motion Challenge.',      trigger: 'combo_5' },
  { id: 'perfect_mover', icon: '💎', name: 'Gerak Sempurna',    desc: 'Raih skor 100% di salah satu mini game.',  trigger: 'perfect_score' },
];

(function() {
  /** Render badge grid */
  function renderBadgeGrid() {
    const grid = document.getElementById('badgeGrid');
    if (!grid) return;
    const state = GameState.get('badges') || {};
    grid.innerHTML = '';

    let unlocked = 0;
    BADGES.forEach(b => {
      const isUnlocked = state[b.id]?.unlocked ?? false;
      if (isUnlocked) unlocked++;
      const div = document.createElement('div');
      div.className = `badge-item ${isUnlocked ? 'unlocked' : 'locked'}`;
      div.innerHTML = `
        <span class="badge-icon badge-glow">${b.icon}</span>
        <div class="badge-name">${b.name}</div>
        <div class="badge-status ${isUnlocked ? 'unlocked' : 'locked'}">
          ${isUnlocked ? '✅ Didapat!' : '🔒 Terkunci'}
        </div>
      `;
      div.onclick = () => showBadgeDetail(b, isUnlocked, state[b.id]?.date);
      grid.appendChild(div);
    });

    const countEl = document.getElementById('badgeCount');
    if (countEl) countEl.textContent = unlocked;
    const portEl = document.getElementById('portBadges');
    if (portEl) portEl.textContent = unlocked;
  }

  function showBadgeDetail(badge, isUnlocked, date) {
    const overlay = document.getElementById('badgeDetailOverlay');
    document.getElementById('badgeDetailIcon').textContent = badge.icon;
    document.getElementById('badgeDetailName').textContent = badge.name;
    document.getElementById('badgeDetailDesc').textContent = badge.desc;
    const statusEl = document.getElementById('badgeDetailStatus');
    if (isUnlocked) {
      const d = date ? new Date(date).toLocaleDateString('id-ID') : '';
      statusEl.innerHTML = `<span style="color:var(--yellow-d);font-size:0.9rem;">✅ Didapat pada ${d}</span>`;
    } else {
      statusEl.innerHTML = `<span style="color:#94a3b8;">🔒 Belum didapat</span>`;
    }
    overlay.classList.remove('hidden');
    Audio.sfx.click();
  }

  /** Try to award a badge based on trigger */
  function tryAward(trigger) {
    const badge = BADGES.find(b => b.trigger === trigger);
    if (!badge) return;
    const wasNew = GameState.unlockBadge(badge.id);
    if (wasNew) {
      showBadgeToast(badge);
      Audio.sfx.badge();
      Confetti.burst(80);
      renderBadgeGrid();
    }
  }

  function showBadgeToast(badge) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = `🏅 Badge baru: ${badge.name} ${badge.icon}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3500);
  }

  window.closeBadgeDetail = function() {
    document.getElementById('badgeDetailOverlay').classList.add('hidden');
    Audio.sfx.click();
  };

  window.BadgeSystem = { render: renderBadgeGrid, tryAward, BADGES };
})();
