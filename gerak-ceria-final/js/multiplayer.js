// ══════════════════════════════════════════
// games/multiplayer.js — Estafet Tim Module
// Red vs Blue team relay challenge
// ══════════════════════════════════════════

const RELAY_CHALLENGES = [
  { text:'Angkat kedua tangan 3x!', move:'raise_both', target:3, icon:'🙌' },
  { text:'Squat 3x!',               move:'squat',      target:3, icon:'🦵' },
  { text:'Lompat 3x!',              move:'jump',       target:3, icon:'⬆️' },
  { text:'Lari 5 langkah!',         move:'run',        target:5, icon:'🏃' },
  { text:'Tangan kanan 3x!',        move:'raise_right',target:3, icon:'✋' },
];

(function() {
  let stream    = null;
  let rafId     = null;
  let running   = false;
  let activeTeam = 'red'; // 'red' | 'blue'
  let redScore  = 0, blueScore = 0;
  let round     = 0;
  const MAX_ROUNDS = 5;
  let timeLeft  = 10;
  let timerInterval = null;
  let reps      = 0;
  let lastGesture = false;
  let currentChallenge = null;

  const video  = () => document.getElementById('multiVideo');
  const canvas = () => document.getElementById('multiCanvas');
  const ctx    = () => canvas()?.getContext('2d');

  async function initCamera() {
    if (stream) return;
    stream = await navigator.mediaDevices.getUserMedia({ video:{width:640,height:480,facingMode:'user'} });
    video().srcObject = stream;
    await video().play();
  }

  function stopCamera() {
    if (stream) { stream.getTracks().forEach(t=>t.stop()); stream = null; }
    if (rafId)  { cancelAnimationFrame(rafId); rafId = null; }
    clearInterval(timerInterval);
    running = false;
  }

  function updateScoreUI() {
    document.getElementById('redScore').textContent  = redScore;
    document.getElementById('blueScore').textContent = blueScore;
    const total = redScore + blueScore || 1;
    document.getElementById('redBar').style.width  = (redScore/total*100) + '%';
    document.getElementById('blueBar').style.width = (blueScore/total*100) + '%';
    document.getElementById('multiRound').textContent = round;
  }

  function updateActiveTeam() {
    const badge = document.getElementById('activeTeamBadge');
    const btn   = document.getElementById('btnStartRelay');
    if (activeTeam === 'red') {
      badge.textContent = '🔴 Tim Merah';
      badge.style.background = 'rgba(239,68,68,0.85)';
      btn.className = 'btn-main red';
    } else {
      badge.textContent = '🔵 Tim Biru';
      badge.style.background = 'rgba(59,130,246,0.85)';
      btn.className = 'btn-main blue';
    }
  }

  function nextRound() {
    if (round >= MAX_ROUNDS) { endRelay(); return; }
    round++;
    reps = 0;
    lastGesture = false;
    timeLeft = 12;
    currentChallenge = RELAY_CHALLENGES[Math.floor(Math.random() * RELAY_CHALLENGES.length)];
    document.getElementById('multiChallengeText').textContent =
      `${activeTeam === 'red' ? '🔴' : '🔵'} ${currentChallenge.text}`;
    document.getElementById('relayTimer').textContent = timeLeft;
    updateScoreUI();

    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timeLeft--;
      document.getElementById('relayTimer').textContent = timeLeft;
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        // Missed — switch team
        switchTeam();
      }
    }, 1000);
  }

  function switchTeam() {
    activeTeam = activeTeam === 'red' ? 'blue' : 'red';
    updateActiveTeam();
    nextRound();
  }

  function endRelay() {
    running = false;
    clearInterval(timerInterval);
    stopCamera();

    const resultEl = document.getElementById('multiResult');
    const banner   = document.getElementById('winnerBanner');
    resultEl.classList.remove('hidden');

    if (redScore > blueScore) {
      banner.innerHTML = '🔴 TIM MERAH MENANG! 🏆<br><span style="font-size:1.5rem">Selamat Tim Merah!</span>';
      banner.style.color = '#ef4444';
      GameState.set('redTeamWins', (GameState.get('redTeamWins')||0)+1);
    } else if (blueScore > redScore) {
      banner.innerHTML = '🔵 TIM BIRU MENANG! 🏆<br><span style="font-size:1.5rem">Selamat Tim Biru!</span>';
      banner.style.color = '#3b82f6';
      GameState.set('blueTeamWins', (GameState.get('blueTeamWins')||0)+1);
    } else {
      banner.innerHTML = '🤝 SERI! Kalian hebat semua!';
      banner.style.color = '#eab308';
    }

    Confetti.rain(4000);
    Audio.sfx.levelUp();
    BadgeSystem.tryAward('relay_win');
    GameState.addActivity({ type:'relay', name:'Estafet Tim', score: Math.max(redScore,blueScore), icon:'👥' });

    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-main green';
    closeBtn.textContent = '🏠 Kembali ke Menu';
    closeBtn.style.marginTop = '20px';
    closeBtn.onclick = () => {
      resultEl.classList.add('hidden');
      showScreen('mainMenu');
    };
    resultEl.appendChild(closeBtn);
  }

  function gameLoop() {
    const v = video();
    const c = canvas();
    const cx = ctx();
    if (!v || !c || !cx || !running) return;

    c.width  = v.videoWidth  || v.clientWidth;
    c.height = v.videoHeight || v.clientHeight;
    cx.clearRect(0, 0, c.width, c.height);

    const ts = performance.now();
    const landmarks = PoseDetector.detect(v, ts);
    const lm = landmarks[0] ?? null;

    if (lm && currentChallenge) {
      const color = activeTeam === 'red' ? '#ef4444' : '#3b82f6';
      PoseDetector.drawSkeleton(cx, c, lm, color);
      const angles = PoseDetector.extractAngles(lm);
      const ok = GestureDetector.checkMove(currentChallenge.move, angles, 0);

      if (ok && !lastGesture) {
        reps++;
        Audio.sfx.energy();
        document.getElementById('multiChallengeText').textContent =
          `${currentChallenge.icon} Rep ${reps}/${currentChallenge.target}`;

        if (reps >= currentChallenge.target) {
          clearInterval(timerInterval);
          const pts = Math.max(10, timeLeft * 5);
          if (activeTeam === 'red') redScore += pts;
          else blueScore += pts;
          Audio.sfx.correct();
          Confetti.burst(25);
          updateScoreUI();
          document.getElementById('multiChallengeText').textContent = `✅ +${pts}pts!`;
          // Move runner animation
          animateRunner();
          setTimeout(switchTeam, 1200);
        }
      }
      lastGesture = ok;
    }

    rafId = requestAnimationFrame(gameLoop);
  }

  function animateRunner() {
    const runner = activeTeam === 'red'
      ? document.getElementById('redRunner')
      : document.getElementById('blueRunner');
    runner.style.transform = 'scale(1.5)';
    setTimeout(() => { runner.style.transform = ''; }, 500);
  }

  window.startRelay = async function() {
    Audio.sfx.click();
    document.getElementById('loadingOverlay').classList.remove('hidden');
    document.getElementById('loadingText').textContent = 'Menyiapkan Estafet...';
    document.getElementById('multiResult').classList.add('hidden');

    try {
      await initCamera();
      if (!PoseDetector.ready) await PoseDetector.init();
    } catch(e) {
      alert('Kamera tidak tersedia: ' + e.message);
      document.getElementById('loadingOverlay').classList.add('hidden');
      return;
    }
    document.getElementById('loadingOverlay').classList.add('hidden');

    redScore = blueScore = round = 0;
    activeTeam = 'red';
    running = true;
    GestureDetector.resetAll();
    updateActiveTeam();
    updateScoreUI();
    document.getElementById('btnStartRelay').classList.add('hidden');
    gameLoop();
    nextRound();
  };

  window._multiplayerCleanup = stopCamera;
})();
