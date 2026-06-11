import { PoseDetector } from './poseDetector.js';

const CONNS = PoseDetector.getConnections();
const CIRC = 2 * Math.PI * 27;
const PLAYER_COLORS = ['#ff00aa', '#00f0ff', '#00ff88', '#ffe600'];
const PLAYER_NAMES = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];

export class UIController {
  constructor() {
    this.refCanvas = document.getElementById('refCanvas');
    this.camCanvas = document.getElementById('camCanvas');
    this.refCtx = null;
    this.camCtx = null;
    this.timerEl = document.querySelector('.game-header .timer');
    this.playerCount = 0;
  }

  init() {
    this.refCtx = this.refCanvas.getContext('2d');
    this.camCtx = this.camCanvas.getContext('2d');
  }

  resizeCanvas(canvas, video) {
    canvas.width = video.videoWidth || video.clientWidth;
    canvas.height = video.videoHeight || video.clientHeight;
  }

  drawSkeleton(ctx, canvas, landmarks, color) {
    if (!landmarks) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const [a, b] of CONNS) {
      const la = landmarks[a], lb = landmarks[b];
      if (!la || !lb || la.visibility < 0.4 || lb.visibility < 0.4) continue;
      ctx.beginPath();
      ctx.moveTo(la.x * canvas.width, la.y * canvas.height);
      ctx.lineTo(lb.x * canvas.width, lb.y * canvas.height);
      ctx.stroke();
    }
    ctx.fillStyle = color;
    for (const lm of landmarks) {
      if (lm.visibility < 0.4) continue;
      ctx.beginPath();
      ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  // Draw player label near head
  drawPlayerLabel(ctx, canvas, landmarks, color, name, score) {
    if (!landmarks || !landmarks[0]) return;
    const nose = landmarks[0];
    const x = nose.x * canvas.width;
    const y = nose.y * canvas.height - 30;
    ctx.font = 'bold 14px Outfit';
    ctx.textAlign = 'center';
    // Background pill
    const text = `${name}: ${score}%`;
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 14, w, 22, 8);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  // Draw all detected people on reference video
  drawRefAll(landmarksArr, video) {
    this.resizeCanvas(this.refCanvas, video);
    this.refCtx.clearRect(0, 0, this.refCanvas.width, this.refCanvas.height);
    for (let i = 0; i < landmarksArr.length; i++) {
      this.drawSkeleton(this.refCtx, this.refCanvas, landmarksArr[i], '#00f0ff');
    }
  }

  // Draw all detected people on webcam
  drawCamAll(landmarksArr, video, scores) {
    this.resizeCanvas(this.camCanvas, video);
    this.camCtx.clearRect(0, 0, this.camCanvas.width, this.camCanvas.height);
    this.playerCount = landmarksArr.length;
    for (let i = 0; i < landmarksArr.length; i++) {
      const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      this.drawSkeleton(this.camCtx, this.camCanvas, landmarksArr[i], color);
      const score = scores && scores[i] !== undefined ? scores[i] : 0;
      this.drawPlayerLabel(this.camCtx, this.camCanvas, landmarksArr[i], color, PLAYER_NAMES[i], score);
    }
  }

  // Update multi-player score HUD
  updateScores(playerScores, feedbacks, avgScores) {
    const container = document.getElementById('playerScores');
    // Build HTML if player count changed
    if (container.children.length !== playerScores.length) {
      container.innerHTML = '';
      for (let i = 0; i < playerScores.length; i++) {
        const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
        const div = document.createElement('div');
        div.className = 'player-score-item';
        div.innerHTML = `
          <div class="player-dot" style="background:${color}"></div>
          <div class="player-info">
            <div class="player-name" style="color:${color}">${PLAYER_NAMES[i]}</div>
            <div class="player-score-val">0%</div>
            <div class="player-feedback">—</div>
          </div>
          <div class="player-avg">
            <div class="player-avg-label">AVG</div>
            <div class="player-avg-val">0%</div>
          </div>`;
        container.appendChild(div);
      }
    }

    // Update values
    for (let i = 0; i < playerScores.length; i++) {
      const item = container.children[i];
      if (!item) continue;
      const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      const score = playerScores[i];
      let col;
      if (score >= 80) col = '#00ff88';
      else if (score >= 50) col = '#ffe600';
      else col = '#ff3355';
      item.querySelector('.player-score-val').textContent = score + '%';
      item.querySelector('.player-score-val').style.color = col;
      const fb = feedbacks[i] || { text: '—' };
      item.querySelector('.player-feedback').textContent = fb.text;
      item.querySelector('.player-feedback').style.color = col;
      item.querySelector('.player-avg-val').textContent = (avgScores[i] || 0) + '%';
    }
  }

  updateTimer(elapsed, total) {
    const fmt = s => { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return `${m}:${String(sec).padStart(2, '0')}`; };
    this.timerEl.textContent = total > 0 ? `${fmt(elapsed)} / ${fmt(total)}` : fmt(elapsed);
  }

  async showCountdown() {
    const overlay = document.querySelector('.countdown-overlay');
    const numEl = document.querySelector('.countdown-number');
    overlay.classList.add('active');
    for (const n of ['3', '2', '1', 'GO!']) {
      numEl.textContent = n;
      numEl.style.animation = 'none';
      void numEl.offsetWidth;
      numEl.style.animation = 'countPulse 0.6s ease-out';
      await new Promise(r => setTimeout(r, 900));
    }
    overlay.classList.remove('active');
  }

  showResult(playerAvgScores) {
    const overlay = document.querySelector('.result-overlay');
    const card = overlay.querySelector('.result-card');

    // Build result for all players
    let html = '<h2>Hasil Latihan</h2>';
    for (let i = 0; i < playerAvgScores.length; i++) {
      const avg = playerAvgScores[i];
      const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      let grade, cls, label;
      if (avg >= 90) { grade = 'S'; cls = 's'; label = 'SEMPURNA! 🔥'; }
      else if (avg >= 75) { grade = 'A'; cls = 'a'; label = 'Hebat! 💪'; }
      else if (avg >= 55) { grade = 'B'; cls = 'b'; label = 'Lumayan! 👍'; }
      else { grade = 'C'; cls = 'c'; label = 'Coba Lagi! 💡'; }
      html += `
        <div class="result-player">
          <div class="result-player-name" style="color:${color}">${PLAYER_NAMES[i]}</div>
          <div class="final-score">${avg}%</div>
          <div class="grade ${cls}">Grade ${grade} — ${label}</div>
        </div>`;
    }
    html += '<br><button class="btn-retry" id="btnRetry" onclick="document.getElementById(\'btnRetry\').click()">🔄 Coba Lagi</button>';
    card.innerHTML = html;

    // Re-bind retry
    card.querySelector('.btn-retry').addEventListener('click', () => {
      window.__appRetry && window.__appRetry();
    });

    overlay.classList.add('active');
  }

  hideResult() {
    document.querySelector('.result-overlay').classList.remove('active');
  }
}
