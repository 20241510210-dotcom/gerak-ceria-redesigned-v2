// ══════════════════════════════════════════
// games/motionChallenge.js — AI Motion Challenge
// Random pose challenges with scoring
// ══════════════════════════════════════════

const CHALLENGES = [
  { text: 'Angkat kedua tangan! 🙌', move:'raise_both', icon:'🙌' },
  { text: 'Squat sekarang! 🦵',       move:'squat',      icon:'🦵' },
  { text: 'Lompat 1x! ⬆️',            move:'jump',       icon:'⬆️' },
  { text: 'Lari di tempat! 🏃',        move:'run',        icon:'🏃' },
  { text: 'Angkat tangan kanan! ✋',   move:'raise_right',icon:'✋' },
  { text: 'Angkat tangan kiri! 🤚',   move:'raise_left', icon:'🤚' },
];

(function() {
  let stream   = null;
  let rafId    = null;
  let running  = false;
  let score    = 0;
  let combo    = 1;
  let challengeIdx  = -1;
  let timeLeft      = 0;
  let challengeDone = false;
  let historyLog    = [];
  let timerInterval = null;

  const CHALLENGE_TIME = 5; // seconds per challenge
  const TOTAL_ROUNDS   = 10;
  let round = 0;

  const video  = () => document.getElementById('challengeVideo');
  const canvas = () => document.getElementById('challengeCanvas');
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

  function randomChallenge() {
    const idx = Math.floor(Math.random() * CHALLENGES.length);
    return { ...CHALLENGES[idx], idx };
  }

  let currentChallenge = null;

  function nextChallenge() {
    if (round >= TOTAL_ROUNDS) { endChallenge(); return; }
    round++;
    challengeDone = false;
    currentChallenge = randomChallenge();
    timeLeft = CHALLENGE_TIME;

    document.getElementById('challengeText').textContent = currentChallenge.text;
    updateRing(1);
    document.getElementById('challengeRingNum').textContent = timeLeft;
    document.getElementById('challengeFeedback').textContent = 'Siap?';
    clearInterval(timerInterval);

    timerInterval = setInterval(() => {
      timeLeft--;
      document.getElementById('challengeRingNum').textContent = timeLeft;
      updateRing(timeLeft / CHALLENGE_TIME);
      if (timeLeft <= 0) {
        clearInterval(timerInterval);
        if (!challengeDone) {
          // Missed
          combo = 1;
          updateComboUI();
          addHistory(currentChallenge, false);
          document.getElementById('challengeFeedback').textContent = '😢 Waktu habis! Coba gerakan selanjutnya!';
          Audio.sfx.wrong();
          setTimeout(nextChallenge, 1200);
        }
      }
    }, 1000);
  }

  function updateRing(ratio) {
    const circ = 2 * Math.PI * 40;
    const offset = circ * (1 - ratio);
    const ring = document.getElementById('challengeRing');
    if (ring) {
      ring.style.strokeDashoffset = offset;
      ring.style.stroke = ratio > 0.5 ? '#4ade80' : ratio > 0.25 ? '#eab308' : '#ef4444';
    }
  }

  function updateComboUI() {
    const el = document.getElementById('challengeCombo');
    if (el) { el.textContent = `x${combo}`; el.style.animation='none'; void el.offsetWidth; el.style.animation=''; }
    const el2 = document.getElementById('miniCombo');
    if (el2) el2.textContent = `x${combo}`;
  }

  function addHistory(challenge, correct) {
    historyLog.unshift({ challenge, correct });
    if (historyLog.length > 8) historyLog.pop();
    renderHistory();
  }

  function renderHistory() {
    const el = document.getElementById('challengeHistory');
    if (!el) return;
    const items = historyLog.map(h =>
      `<div class="history-item ${h.correct?'correct':'wrong'}">
        ${h.correct?'✅':'❌'} ${h.challenge.icon} ${h.challenge.text}
      </div>`
    ).join('');
    // Keep title
    const title = el.querySelector('.history-title')?.outerHTML || '<div class="history-title">Riwayat Gerakan</div>';
    el.innerHTML = title + items;
  }

  function endChallenge() {
    running = false;
    clearInterval(timerInterval);
    stopCamera();
    const prev = GameState.get('challengeHighScore') || 0;
    if (score > prev) GameState.set('challengeHighScore', score);
    GameState.addActivity({ type:'challenge', name:'Motion Challenge', score, icon:'⚡' });
    GameState.addXP(Math.floor(score / 10));

    if (combo >= 5) BadgeSystem.tryAward('combo_5');

    document.getElementById('challengeText').textContent = `🎉 Selesai! Skor: ${score}`;
    document.getElementById('challengeFeedback').textContent = 'Hebat! Kamu luar biasa!';
    Confetti.burst(60);
    Audio.sfx.complete();
    updateScoreUI();

    document.getElementById('btnStartChallenge').classList.remove('hidden');
    document.getElementById('btnStartChallenge').textContent = '🔄 Main Lagi';
  }

  function updateScoreUI() {
    document.getElementById('challengeScore').textContent = score;
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

    if (lm) {
      PoseDetector.drawSkeleton(cx, c, lm, '#f97316');
      const angles = PoseDetector.extractAngles(lm);

      if (currentChallenge && !challengeDone && timeLeft > 0) {
        const ok = GestureDetector.checkMove(currentChallenge.move, angles, 0);
        if (ok) {
          challengeDone = true;
          clearInterval(timerInterval);
          const points = Math.max(10, timeLeft * 20) * combo;
          score += points;
          combo++;
          if (combo > 3) Audio.sfx.combo();
          else Audio.sfx.correct();
          updateComboUI();
          updateScoreUI();
          addHistory(currentChallenge, true);
          document.getElementById('challengeFeedback').textContent =
            combo > 3 ? `🔥 COMBO x${combo}! +${points}pts!` : `✅ Bagus! +${points}pts!`;
          Confetti.burst(20);
          if (combo >= 5) BadgeSystem.tryAward('combo_5');
          setTimeout(nextChallenge, 900);
        }
      }
    }

    rafId = requestAnimationFrame(gameLoop);
  }

  window.startChallenge = async function() {
    Audio.sfx.click();
    document.getElementById('loadingOverlay').classList.remove('hidden');
    document.getElementById('loadingText').textContent = 'Menyiapkan Challenge...';

    try {
      await initCamera();
      if (!PoseDetector.ready) await PoseDetector.init();
    } catch(e) {
      alert('Kamera tidak tersedia: ' + e.message);
      document.getElementById('loadingOverlay').classList.add('hidden');
      return;
    }
    document.getElementById('loadingOverlay').classList.add('hidden');

    score  = 0; combo = 1; round = 0;
    running = true;
    historyLog = [];
    GestureDetector.resetAll();
    updateScoreUI();
    updateComboUI();
    renderHistory();
    document.getElementById('btnStartChallenge').classList.add('hidden');

    gameLoop();

    // Brief countdown
    document.getElementById('challengeText').textContent = 'Bersiap...';
    await new Promise(r=>setTimeout(r,800));
    nextChallenge();
  };

  window._challengeCleanup = stopCamera;
})();
