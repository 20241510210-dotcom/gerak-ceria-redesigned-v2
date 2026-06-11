// ══════════════════════════════════════════
// ui/mascot.js — AI Coach Mascot Controller
// ══════════════════════════════════════════

(function() {
  const TIPS = [
    'Selamat datang! Mau mulai petualangan hari ini?',
    'Ingat pemanasan dulu sebelum main ya!',
    'Olahraga itu menyenangkan kalau dilakukan dengan gembira!',
    'Gerakan yang benar lebih penting dari kecepatan!',
    'Minum air putih dulu, baru kita mulai!',
    'Level baru menunggumu di Mission Map!',
    'Kumpulkan semua badge untuk jadi Atlet Sejati!',
    'Bergerak setiap hari bikin badan sehat dan kuat!',
  ];

  let tipIdx = 0;
  let tipInterval = null;

  /** Show a speech bubble message for the mascot */
  function say(el, message, duration = 0) {
    if (!el) return;
    el.textContent = message;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = 'slideIn 0.3s ease both';
    if (duration > 0) {
      setTimeout(() => { el.textContent = ''; }, duration);
    }
  }

  /** Start rotating tips in the main menu */
  function startRotatingTips() {
    const el = document.getElementById('coachSpeech');
    if (!el) return;
    say(el, TIPS[tipIdx]);
    clearInterval(tipInterval);
    tipInterval = setInterval(() => {
      tipIdx = (tipIdx + 1) % TIPS.length;
      say(el, TIPS[tipIdx]);
    }, 5000);
  }

  function stopRotatingTips() {
    clearInterval(tipInterval);
  }

  /** React to emotion */
  function reactToEmotion(emotion) {
    const el = document.getElementById('coachSpeech');
    if (!el) return;
    const msg = window.EmotionDetector?.getMessage(emotion) ?? '';
    if (msg) say(el, msg);
  }

  window.Mascot = { say, startRotatingTips, stopRotatingTips, reactToEmotion };
})();
