// ══════════════════════════════════════════
// portfolio.js — Portfolio / Dashboard
// Gerak Ceria AI Adventure
// ══════════════════════════════════════════

(function() {
  function renderPortfolio() {
    const s = GameState.getState();

    // Hero section
    const nameEl = document.getElementById('portName');
    if (nameEl) nameEl.textContent = s.playerName || 'Pemain Baru';
    const lvlEl = document.getElementById('portLevel');
    if (lvlEl) lvlEl.textContent = s.level || 1;
    const expFill = document.getElementById('portExpFill');
    if (expFill) expFill.style.width = (s.exp || 0) + '%';
    const expLbl = document.getElementById('portExp');
    if (expLbl) expLbl.textContent = s.exp || 0;

    // Stats
    const statsMap = {
      portStars:  Object.values(s.levelStars || {}).reduce((a,b)=>a+b,0),
      portBadges: Object.values(s.badges || {}).filter(b=>b.unlocked).length,
      portStreak: s.streak || 0,
      portMoves:  s.totalMoves || 0,
    };
    Object.entries(statsMap).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    });

    // Activity chart
    const weekly = s.weeklyActivity || [0,0,0,0,0,0,0];
    ChartUI.renderActivityChart(weekly);

    // Activity log
    const log = document.getElementById('activityLog');
    if (log) {
      const entries = s.activityLog || [];
      if (entries.length === 0) {
        log.innerHTML = '<div class="log-empty">Belum ada aktivitas. Ayo mulai bermain!</div>';
      } else {
        log.innerHTML = entries.slice(0, 10).map(e => `
          <div class="log-item">
            <span class="log-icon">${e.icon || '🏃'}</span>
            <div class="log-info">
              <div class="log-name">${e.name}</div>
              <div class="log-date">${e.date}</div>
            </div>
            <div class="log-score">${e.score || 0} pts</div>
          </div>
        `).join('');
      }
    }

    // AI Coach Feedback
    const totalMoves = s.totalMoves || 0;
    const goodEl = document.getElementById('fbGood');
    const improveEl = document.getElementById('fbImprove');
    const calEl = document.getElementById('fbCalories');
    const movesEl = document.getElementById('fbMovesTotal');

    if (goodEl) {
      goodEl.textContent = totalMoves >= 10
        ? 'Konsistensi bagus! Kamu rajin berolahraga.'
        : 'Sudah mulai bergerak, pertahankan ya!';
    }
    if (improveEl) {
      improveEl.textContent = totalMoves < 5
        ? 'Coba tambah frekuensi bermain setiap hari.'
        : (s.streak < 3 ? 'Coba main 3 hari berturut-turut!' : 'Tingkatkan tantangan ke level berikutnya!');
    }
    if (calEl) calEl.textContent = s.totalCalories || 0;
    if (movesEl) movesEl.textContent = totalMoves;
  }

  window.Portfolio = { render: renderPortfolio };
})();
