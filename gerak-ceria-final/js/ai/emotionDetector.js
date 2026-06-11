// ══════════════════════════════════════════
// ai/emotionDetector.js — Emotion & Motivation
// Gerak Ceria AI Adventure
// ══════════════════════════════════════════

(function() {
  const EMOTION_MESSAGES = {
    happy:   ['Semangat terus! 🎉', 'Kamu hebat! 🌟', 'Luar biasa! ⭐'],
    tired:   ['Istirahat sebentar ya!', 'Tetap semangat! 💪', 'Kamu bisa!'],
    great:   ['Gerakan sempurna! 🏆', 'Mantap sekali! 🔥', 'Terus begitu!'],
    neutral: ['Ayo bergerak! 🏃', 'Fokus ya!', 'Kita bisa!'],
  };

  /**
   * Detect "emotion" from pose angles (simple heuristic)
   * Returns: 'happy' | 'tired' | 'great' | 'neutral'
   */
  function detect(angles) {
    if (!angles) return 'neutral';

    // Both hands raised = happy/energetic
    const bothUp = angles.leftWristY < angles.leftShoulderY - 0.1 &&
                   angles.rightWristY < angles.rightShoulderY - 0.1;
    if (bothUp) return 'happy';

    // Deep squat = great effort
    const deepSquat = (angles.leftKnee + angles.rightKnee) / 2 < 100;
    if (deepSquat) return 'great';

    // Low shoulder angles might indicate tiredness
    const shoulderAvg = (angles.leftShoulder + angles.rightShoulder) / 2;
    if (shoulderAvg < 20) return 'tired';

    return 'neutral';
  }

  function getMessage(emotion) {
    const msgs = EMOTION_MESSAGES[emotion] || EMOTION_MESSAGES.neutral;
    return msgs[Math.floor(Math.random() * msgs.length)];
  }

  window.EmotionDetector = { detect, getMessage };
})();
