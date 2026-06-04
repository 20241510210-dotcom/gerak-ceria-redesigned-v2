// ══════════════════════════════════════════
// ai/gestureDetector.js — Gesture Recognition
// Detects: raise_hand, squat, jump, run_in_place
// ══════════════════════════════════════════

(function() {
  // History for smoothing
  const HISTORY_SIZE = 8;
  const histories = {};

  function getHistory(id) {
    if (!histories[id]) histories[id] = [];
    return histories[id];
  }
  function pushHistory(id, val) {
    const h = getHistory(id);
    h.push(val);
    if (h.length > HISTORY_SIZE) h.shift();
    return h;
  }
  function avgHistory(id) {
    const h = getHistory(id);
    if (!h.length) return 0;
    return h.reduce((a,b)=>a+b,0) / h.length;
  }
  function resetAll() { Object.keys(histories).forEach(k=>delete histories[k]); }

  /**
   * Analyze angles object and return detected gestures.
   * @param {Object} angles - from PoseDetector.extractAngles()
   * @returns {Object} { raisedHands, squat, jumping, running, handRight, handLeft }
   */
  function detect(angles, personId = 0) {
    if (!angles) return {};
    const pid = `p${personId}`;

    // ── RAISED HANDS ──
    // Wrist Y < shoulder Y means hands are above shoulders
    const leftRaised  = angles.leftWristY  < angles.leftShoulderY  - 0.05;
    const rightRaised = angles.rightWristY < angles.rightShoulderY - 0.05;
    const bothHandsRaised = leftRaised && rightRaised;
    pushHistory(`${pid}_raised`, bothHandsRaised ? 1 : 0);
    const raisedHands = avgHistory(`${pid}_raised`) > 0.6;

    pushHistory(`${pid}_leftHand`, leftRaised ? 1 : 0);
    const handLeft = avgHistory(`${pid}_leftHand`) > 0.6;

    pushHistory(`${pid}_rightHand`, rightRaised ? 1 : 0);
    const handRight = avgHistory(`${pid}_rightHand`) > 0.6;

    // ── SQUAT ──
    // Knee angles < 120° = bent = squatting
    const kneeAvg = (angles.leftKnee + angles.rightKnee) / 2;
    const hipAvg  = (angles.leftHip  + angles.rightHip)  / 2;
    pushHistory(`${pid}_squat`, (kneeAvg < 120 && hipAvg < 120) ? 1 : 0);
    const squat = avgHistory(`${pid}_squat`) > 0.5;

    // ── JUMP DETECTION ──
    // Track nose Y position; sudden upward movement = jump
    const noseY = angles.noseY;
    pushHistory(`${pid}_noseY`, noseY);
    const noseHist = getHistory(`${pid}_noseY`);
    let jumping = false;
    if (noseHist.length >= 4) {
      const diff = noseHist[0] - noseHist[noseHist.length - 1];
      jumping = diff > 0.04; // moved upward (Y decreases upward)
    }

    // ── RUNNING IN PLACE ──
    // Alternating knee lifts
    const leftKneeLift  = angles.leftKnee  < 140;
    const rightKneeLift = angles.rightKnee < 140;
    pushHistory(`${pid}_runL`, leftKneeLift  ? 1 : 0);
    pushHistory(`${pid}_runR`, rightKneeLift ? 1 : 0);
    const runActivity = (avgHistory(`${pid}_runL`) + avgHistory(`${pid}_runR`)) / 2;
    const running = runActivity > 0.3;

    return { raisedHands, handLeft, handRight, squat, jumping, running };
  }

  /**
   * Check if a specific move is performed.
   * Moves: 'raise_both', 'raise_right', 'raise_left', 'squat', 'jump', 'run'
   */
  function checkMove(moveName, angles, personId = 0) {
    const g = detect(angles, personId);
    switch (moveName) {
      case 'raise_both':  return g.raisedHands;
      case 'raise_right': return g.handRight;
      case 'raise_left':  return g.handLeft;
      case 'squat':       return g.squat;
      case 'jump':        return g.jumping;
      case 'run':         return g.running;
      default: return false;
    }
  }

  window.GestureDetector = { detect, checkMove, resetAll };
})();
