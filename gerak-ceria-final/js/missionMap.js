// ══════════════════════════════════════════
// missionMap.js — Mission Map & Mini Games
// Gerak Ceria AI Adventure
// ══════════════════════════════════════════

const MISSIONS = [
  { id:1, name:'Latihan Dasar',   icon:'🌱', desc:'Gerakan dasar olahraga', color:'#22c55e', moves:['raise_both','squat'], target:5 },
  { id:2, name:'Lompatan Ceria',  icon:'⬆️', desc:'Tantangan melompat',    color:'#3b82f6', moves:['jump','raise_both'],  target:8 },
  { id:3, name:'Sprint Mini',     icon:'🏃', desc:'Lari di tempat',        color:'#f97316', moves:['run','squat'],        target:10 },
  { id:4, name:'Combo Gerak',     icon:'⚡', desc:'Kombinasi gerakan',     color:'#a855f7', moves:['raise_both','squat','jump'], target:8 },
  { id:5, name:'Master Olahraga', icon:'🏆', desc:'Gerakan terbaik',       color:'#eab308', moves:['raise_both','squat','jump','run'], target:12 },
];

(function() {
  let activeMissionId = null;
  let missionStream   = null;
  let missionRafId    = null;
  let missionReps     = 0;
  let missionMoveIdx  = 0;
  let lastGesture     = false;
  let missionRunning  = false;
  let missionScore    = 0;
  let missionCombo    = 1;
  let missionTimer    = null;

  /** Render the mission map nodes — horizontal layout matching the mockup */
  function renderMap() {
    const container = document.getElementById('mapNodes');
    if (!container) return;

    const state = GameState.getState();
    container.innerHTML = '';

    MISSIONS.forEach((m, i) => {
      const unlocked = i === 0 ? true : (state.levelUnlocked[m.id] ?? false);
      const stars    = state.levelStars[m.id] ?? 0;
      const isBoss   = i === MISSIONS.length - 1;

      const wrapper = document.createElement('div');
      wrapper.className = 'map-level-node';

      const btn = document.createElement('button');
      btn.className = `map-node-btn ${unlocked ? 'unlocked' : ''}`;
      btn.style.background = isBoss ? '#dc2626' : (unlocked ? m.color : '#94a3b8');
      btn.disabled = !unlocked;
      const icon = isBoss ? '🏆' : (unlocked ? m.icon : '🔒');
      btn.innerHTML = `
        <span style="font-size:1.7rem">${icon}</span>
        <span class="node-level-num">${isBoss ? 'BOSS' : m.id}</span>
      `;
      if (unlocked) btn.onclick = () => startMission(m);

      const stars_row = document.createElement('div');
      stars_row.className = 'map-node-stars';
      stars_row.style.textAlign = 'center';
      stars_row.textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);

      const label = document.createElement('div');
      label.className = 'map-node-name';
      label.style.textAlign = 'center';
      label.textContent = m.name;

      wrapper.appendChild(btn);
      wrapper.appendChild(stars_row);
      wrapper.appendChild(label);
      container.appendChild(wrapper);

      if (i < MISSIONS.length - 1) {
        const line = document.createElement('div');
        line.className = 'map-connector';
        container.appendChild(line);
      }
    });

    // Update total stars
    const total = Object.values(GameState.get('levelStars') || {}).reduce((a,b)=>a+b,0);
    const el = document.getElementById('totalMapStars');
    if (el) el.textContent = total;
  }

  /** Launch a mission as a mini game */
  function startMission(mission) {
    activeMissionId = mission.id;
    missionMoveIdx  = 0;
    missionReps     = 0;
    missionScore    = 0;
    missionCombo    = 1;
    missionRunning  = false;

    document.getElementById('miniGameTitle').textContent = mission.icon + ' ' + mission.name;
    document.getElementById('miniScore').textContent = '0';
    document.getElementById('miniCombo').textContent  = 'x1';
    document.getElementById('miniTimer').textContent  = '30';
    document.getElementById('miniResult').classList.add('hidden');

    showScreen('miniGameScreen');

    setTimeout(() => launchMissionGame(mission), 200);
  }

  async function launchMissionGame(mission) {
    try {
      // Camera
      missionStream = await navigator.mediaDevices.getUserMedia({ video:{ width:640, height:480, facingMode:'user' } });
      const vid = document.getElementById('miniVideo');
      vid.srcObject = missionStream;
      await vid.play();

      // Pose detector
      if (!PoseDetector.ready) {
        const ov = document.getElementById('loadingOverlay');
        const lt = document.getElementById('loadingText');
        ov.classList.remove('hidden');
        if (lt) lt.textContent = 'Memuat AI Body Tracking...';
        await PoseDetector.init();
        ov.classList.add('hidden');
      }

      // Countdown
      for (let i = 3; i >= 1; i--) {
        document.getElementById('miniGameTitle').textContent = `Bersiap... ${i}`;
        Audio.sfx.countdown(i);
        await sleep(900);
      }
      Audio.sfx.countdown(0);
      document.getElementById('miniGameTitle').textContent = mission.icon + ' ' + mission.name;

      missionRunning = true;
      missionReps = 0;
      lastGesture = false;

      const moves = mission.moves;
      let currentMove = moves[missionMoveIdx % moves.length];
      showMoveHint(currentMove);

      // Timer
      let timeLeft = 30;
      document.getElementById('miniTimer').textContent = timeLeft;
      missionTimer = setInterval(() => {
        timeLeft--;
        document.getElementById('miniTimer').textContent = timeLeft;
        if (timeLeft <= 0) {
          clearInterval(missionTimer);
          endMission(mission, false);
        }
      }, 1000);

      // Game loop
      function gameLoop() {
        if (!missionRunning) return;
        const vid = document.getElementById('miniVideo');
        const camCvs = document.getElementById('miniCameraCanvas');
        const ts = performance.now();
        const landmarks = PoseDetector.detect(vid, ts);

        if (landmarks.length > 0) {
          const lm = landmarks[0];
          const angles = PoseDetector.extractAngles(lm);

          camCvs.width  = vid.videoWidth  || 320;
          camCvs.height = vid.videoHeight || 240;
          const camCtx2 = camCvs.getContext('2d');
          camCtx2.clearRect(0, 0, camCvs.width, camCvs.height);
          PoseDetector.drawSkeleton(camCtx2, camCvs, lm, '#22c55e');

          const performed = GestureDetector.checkMove(currentMove, angles, 0);

          if (performed && !lastGesture) {
            missionReps++;
            missionScore += 10 * missionCombo;
            if (missionReps % 3 === 0) missionCombo = Math.min(5, missionCombo + 1);
            Audio.sfx.rep();

            document.getElementById('miniScore').textContent  = missionScore;
            document.getElementById('miniCombo').textContent  = 'x' + missionCombo;

            // Update HUD toast inside game
            showToast(`${getMoveEmoji(currentMove)} +${10 * missionCombo}pts`, 800);

            if (missionReps >= mission.target) {
              clearInterval(missionTimer);
              endMission(mission, true);
              return;
            }
            missionMoveIdx++;
            currentMove = moves[missionMoveIdx % moves.length];
            showMoveHint(currentMove);
          }
          lastGesture = performed;
        }

        missionRafId = requestAnimationFrame(gameLoop);
      }

      missionRafId = requestAnimationFrame(gameLoop);
    } catch(err) {
      console.error('[Mission]', err);
      showToast('Kamera tidak bisa diakses. Cek izin kamera browser kamu.');
      showScreen('missionMap');
    }
  }

  function showMoveHint(move) {
    document.getElementById('miniGameTitle').textContent = getMoveEmoji(move) + ' ' + getMoveName(move);
  }

  function getMoveEmoji(move) {
    const map = { raise_both:'🙌', raise_right:'✋', raise_left:'🤚', squat:'🦵', jump:'⬆️', run:'🏃' };
    return map[move] || '🎯';
  }
  function getMoveName(move) {
    const map = { raise_both:'Angkat Kedua Tangan!', raise_right:'Angkat Tangan Kanan!', raise_left:'Angkat Tangan Kiri!', squat:'Squat!', jump:'Lompat!', run:'Lari di Tempat!' };
    return map[move] || move;
  }

  function endMission(mission, completed) {
    missionRunning = false;
    if (missionRafId) { cancelAnimationFrame(missionRafId); missionRafId = null; }
    if (missionTimer)  { clearInterval(missionTimer); missionTimer = null; }
    if (missionStream) { missionStream.getTracks().forEach(t=>t.stop()); missionStream = null; }

    const stars = completed
      ? (missionScore >= mission.target * 25 ? 3 : missionScore >= mission.target * 15 ? 2 : 1)
      : (missionReps > 0 ? 1 : 0);

    GameState.setLevelStars(mission.id, stars);
    GameState.addActivity({ type:'mission', name:mission.name, score:missionScore, icon:mission.icon });
    const leveled = GameState.addXP(stars * 15 + Math.floor(missionScore / 2));

    if (stars === 3) BadgeSystem.tryAward('perfect_score');
    const totalSessions = (GameState.get('warmupCount') || 0) + 1;
    if (totalSessions >= 5) BadgeSystem.tryAward('play_5');
    const allStars = Object.values(GameState.get('levelStars') || {}).reduce((a,b)=>a+b,0);
    if (allStars >= 10) BadgeSystem.tryAward('stars_10');

    if (completed) { Confetti.burst(80); Audio.sfx.win(); }
    else Audio.sfx.fail();

    if (leveled) {
      Audio.sfx.levelup();
      showToast('🎉 Level Up! Kamu naik level!', 3000);
    }

    document.getElementById('resultEmoji').textContent    = completed ? '🎉' : '😅';
    document.getElementById('resultTitle').textContent    = completed ? 'Berhasil! 🏆' : 'Waktu Habis!';
    document.getElementById('resultScoreBig').textContent = missionScore;
    document.getElementById('resultStars').textContent    = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
    document.getElementById('miniResult').classList.remove('hidden');
    document.getElementById('miniGameTitle').textContent  = mission.icon + ' ' + mission.name;

    document.getElementById('btnPlayAgain').onclick = () => startMission(mission);
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  window.exitMiniGame = function() {
    missionRunning = false;
    if (missionRafId) { cancelAnimationFrame(missionRafId); missionRafId = null; }
    if (missionTimer)  { clearInterval(missionTimer); missionTimer = null; }
    if (missionStream) { missionStream.getTracks().forEach(t=>t.stop()); missionStream = null; }
    renderMap();
    showScreen('missionMap');
  };

  window.MissionMap  = { render: renderMap, startMission };
  window.startMission = startMission;
})();
