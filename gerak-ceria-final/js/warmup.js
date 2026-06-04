// ══════════════════════════════════════════
// games/warmup.js — AI Warm-Up Module
// Gerak Ceria AI Adventure
// ══════════════════════════════════════════

const WARMUP_MOVES = [
  { id:'raise_both', name:'Angkat Kedua Tangan', icon:'🙌', reps:5, instruction:'Angkat kedua tangan ke atas kepala!' },
  { id:'squat',      name:'Squat',               icon:'🦵', reps:5, instruction:'Tekuk lutut seperti mau duduk, lalu berdiri lagi!' },
  { id:'jump',       name:'Lompat Kecil',         icon:'⬆️', reps:5, instruction:'Lompat-lompat kecil di tempat!' },
  { id:'run',        name:'Lari di Tempat',       icon:'🏃', reps:8, instruction:'Angkat kaki bergantian seperti lari!' },
];

(function() {
  let stream = null;
  let rafId  = null;
  let currentMoveIdx = 0;
  let currentReps    = 0;
  let energy         = 0;
  let running        = false;
  let lastGesture    = false;
  let emotionTimer   = null;

  const video  = () => document.getElementById('warmupVideo');
  const canvas = () => document.getElementById('warmupCanvas');
  const ctx    = () => canvas()?.getContext('2d');

  async function initCamera() {
    if (stream) return;
    stream = await navigator.mediaDevices.getUserMedia({ video:{ width:640, height:480, facingMode:'user' } });
    video().srcObject = stream;
    await video().play();
  }

  async function stopCamera() {
    if (stream) { stream.getTracks().forEach(t=>t.stop()); stream = null; }
    if (rafId)  { cancelAnimationFrame(rafId); rafId = null; }
    clearInterval(emotionTimer);
  }

  function updateUI() {
    const move = WARMUP_MOVES[currentMoveIdx];
    document.getElementById('warmupMoveIcon').textContent  = move?.icon ?? '✅';
    document.getElementById('warmupMoveName').textContent  = move?.name ?? 'Selesai!';
    document.getElementById('warmupReps').textContent      = currentReps;
    document.getElementById('warmupTarget').textContent    = move?.reps ?? 0;
    document.getElementById('warmupInstruction').textContent = move?.instruction ?? 'Pemanasan selesai!';
    document.getElementById('warmupEnergyBar').style.width = energy + '%';
    document.getElementById('warmupEnergyVal').textContent  = Math.round(energy);

    // Update move list
    renderMoveList();
  }

  function renderMoveList() {
    const list = document.getElementById('warmupMovesList');
    if (!list) return;
    list.innerHTML = WARMUP_MOVES.map((m,i) => {
      let cls = '';
      if (i < currentMoveIdx)  cls = 'done';
      if (i === currentMoveIdx) cls = 'active';
      const check = i < currentMoveIdx ? '✅' : (i === currentMoveIdx ? '👉' : '⬜');
      return `<div class="warmup-move-item ${cls}">
        <span class="move-check">${check}</span>
        <span>${m.icon} ${m.name} — ${m.reps}x</span>
      </div>`;
    }).join('');
  }

  function setFeedback(text, good = true) {
    document.getElementById('warmupFeedbackText').textContent = text;
    const fb = document.getElementById('warmupFeedback');
    fb.style.borderLeftColor = good ? 'var(--green)' : 'var(--orange)';
  }

  function gameLoop() {
    const v = video();
    const c = canvas();
    const cx = ctx();
    if (!v || !c || !cx || !running) return;

    // Resize canvas
    c.width  = v.videoWidth  || v.clientWidth;
    c.height = v.videoHeight || v.clientHeight;
    cx.clearRect(0, 0, c.width, c.height);

    const ts = performance.now();
    const allLandmarks = PoseDetector.detect(v, ts);
    const lm = allLandmarks[0] ?? null;

    if (lm) {
      PoseDetector.drawSkeleton(cx, c, lm, '#22c55e');
      const angles   = PoseDetector.extractAngles(lm);
      const gesture  = GestureDetector.detect(angles, 0);
      const move     = WARMUP_MOVES[currentMoveIdx];

      if (move) {
        const detected = GestureDetector.checkMove(move.id, angles, 0);
        if (detected && !lastGesture) {
          // Rising edge — count rep
          currentReps++;
          energy = Math.min(100, energy + (100 / (WARMUP_MOVES.reduce((a,m)=>a+m.reps,0))));
          Audio.sfx.energy();
          GameState.addEnergy(2);
          setFeedback(`${move.icon} Bagus! Rep ke-${currentReps}!`, true);

          if (currentReps >= move.reps) {
            // Move complete
            Audio.sfx.correct();
            currentMoveIdx++;
            currentReps = 0;
            if (currentMoveIdx >= WARMUP_MOVES.length) {
              onWarmupComplete();
              return;
            } else {
              setFeedback(`✅ ${move.name} selesai! Lanjut gerakan berikutnya!`, true);
            }
          }
        }

        if (!detected && currentMoveIdx < WARMUP_MOVES.length) {
          setFeedback(`${move.instruction}`, false);
        }
        lastGesture = detected;
      }

      // Emotion detection every 2s
      const emotion = EmotionDetector.update(allLandmarks);
    }

    updateUI();
    rafId = requestAnimationFrame(gameLoop);
  }

  async function onWarmupComplete() {
    running = false;
    cancelAnimationFrame(rafId);
    energy = 100;
    updateUI();

    // Show stars
    const burst = document.getElementById('starsBurst');
    burst.classList.remove('hidden');
    Audio.sfx.complete();
    Confetti.rain(3000);

    setTimeout(() => burst.classList.add('hidden'), 2000);

    // Save state
    GameState.set('energy', 100);
    const count = (GameState.get('warmupCount') || 0) + 1;
    GameState.set('warmupCount', count);
    GameState.addXP(20);
    GameState.addActivity({ type:'warmup', name:'AI Warm-Up', score:100, icon:'🔥' });
    BadgeSystem.tryAward('warmup_complete');
    if (count >= 1) BadgeSystem.tryAward('warmup_complete');

    setFeedback('🎉 Pemanasan selesai! Energy penuh!', true);
    document.getElementById('btnStartWarmup').textContent = '🔄 Ulangi Pemanasan';
    document.getElementById('btnStartWarmup').onclick = resetWarmup;

    // Unlock missions
    showToast('🔓 Mission Map terbuka!');
  }

  function resetWarmup() {
    currentMoveIdx = 0;
    currentReps    = 0;
    energy         = GameState.get('energy') || 0;
    lastGesture    = false;
    updateUI();
    running = true;
    GestureDetector.resetAll();
    EmotionDetector.reset();
    document.getElementById('btnStartWarmup').textContent = '🔥 Mulai Pemanasan!';
    document.getElementById('btnStartWarmup').onclick = startWarmup;
    gameLoop();
  }

  window.startWarmup = async function() {
    Audio.sfx.click();
    const loadingText = document.getElementById('loadingText');
    if (loadingText) loadingText.textContent = 'Menyiapkan kamera & AI...';
    document.getElementById('loadingOverlay').classList.remove('hidden');

    try {
      await initCamera();
      if (!PoseDetector.ready) await PoseDetector.init();
    } catch(e) {
      alert('Kamera tidak tersedia: ' + e.message);
      document.getElementById('loadingOverlay').classList.add('hidden');
      return;
    }

    document.getElementById('loadingOverlay').classList.add('hidden');

    // Countdown
    const cdEl = document.getElementById('warmupCountdown');
    cdEl.classList.remove('hidden');
    for (const n of ['3','2','1','GO!']) {
      cdEl.textContent = n;
      Audio.sfx.countdown();
      await new Promise(r=>setTimeout(r, 800));
    }
    cdEl.classList.add('hidden');
    Audio.sfx.go();

    currentMoveIdx = 0;
    currentReps    = 0;
    energy         = 0;
    lastGesture    = false;
    running        = true;
    GestureDetector.resetAll();
    EmotionDetector.reset();
    updateUI();
    gameLoop();
    document.getElementById('btnStartWarmup').classList.add('hidden');
  };

  window.stopWarmup = function() {
    running = false;
    stopCamera();
  };

  // Called when navigating away
  window._warmupCleanup = stopCamera;

  // Init
  energy = GameState.get('energy') || 0;
  renderMoveList();
  updateUI();
})();
