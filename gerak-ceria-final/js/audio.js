// ══════════════════════════════════════════
// AUDIO.JS — Sound Effects & Music System
// Gerak Ceria AI Adventure
// ══════════════════════════════════════════

(function() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let ctx = null;

  function getCtx() {
    if (!ctx) ctx = new AudioCtx();
    return ctx;
  }

  function beep(freq, duration, type = 'sine', vol = 0.3) {
    try {
      const ac = getCtx();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      gain.gain.setValueAtTime(vol, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + duration);
    } catch(e) {}
  }

  function chord(freqs, duration, vol = 0.2) {
    freqs.forEach(f => beep(f, duration, 'sine', vol));
  }

  const sfx = {
    click:   () => beep(800, 0.08, 'square', 0.15),
    success: () => { beep(523, 0.15); setTimeout(() => beep(659, 0.15), 100); setTimeout(() => beep(784, 0.25), 200); },
    fail:    () => { beep(300, 0.2, 'sawtooth'); setTimeout(() => beep(220, 0.3, 'sawtooth'), 150); },
    badge:   () => { chord([523,659,784], 0.2); setTimeout(() => chord([659,784,1047], 0.35), 200); },
    jump:    () => { beep(400, 0.05); setTimeout(() => beep(600, 0.1), 50); },
    rep:     () => beep(660, 0.1, 'sine', 0.2),
    combo:   () => { beep(880, 0.08); setTimeout(() => beep(1100, 0.12), 80); },
    levelup: () => {
      [523,587,659,698,784].forEach((f, i) => setTimeout(() => beep(f, 0.15), i * 80));
    },
    countdown: (n) => beep(n === 0 ? 880 : 440, 0.15),
    win:     () => {
      const notes = [523,659,784,1047];
      notes.forEach((f, i) => setTimeout(() => beep(f, 0.2), i * 120));
    },
  };

  window.Audio = { sfx };
})();
