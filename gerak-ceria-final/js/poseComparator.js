const EXERCISES = {
  jumping_jack: {
    name: 'Jumping Jack',
    phases: [
      { label: 'Tangan turun, kaki rapat', angles: { leftShoulder: 15, rightShoulder: 15, leftElbow: 160, rightElbow: 160, leftHip: 170, rightHip: 170, leftKnee: 170, rightKnee: 170 } },
      { label: 'Tangan naik, kaki terbuka', angles: { leftShoulder: 160, rightShoulder: 160, leftElbow: 165, rightElbow: 165, leftHip: 155, rightHip: 155, leftKnee: 170, rightKnee: 170 } }
    ],
    requireStanding: true, minMovement: 40
  },
  squat: {
    name: 'Squat',
    phases: [
      { label: 'Berdiri tegak', angles: { leftShoulder: 15, rightShoulder: 15, leftHip: 170, rightHip: 170, leftKnee: 170, rightKnee: 170, leftElbow: 160, rightElbow: 160 } },
      { label: 'Jongkok', angles: { leftShoulder: 50, rightShoulder: 50, leftHip: 80, rightHip: 80, leftKnee: 80, rightKnee: 80, leftElbow: 160, rightElbow: 160 } }
    ],
    requireStanding: true, minMovement: 50
  },
  arm_raise: {
    name: 'Angkat Tangan',
    phases: [
      { label: 'Tangan di bawah', angles: { leftShoulder: 15, rightShoulder: 15, leftElbow: 170, rightElbow: 170, leftHip: 170, rightHip: 170, leftKnee: 170, rightKnee: 170 } },
      { label: 'Tangan di atas', angles: { leftShoulder: 170, rightShoulder: 170, leftElbow: 170, rightElbow: 170, leftHip: 170, rightHip: 170, leftKnee: 170, rightKnee: 170 } }
    ],
    requireStanding: true, minMovement: 60
  },
  lunge: {
    name: 'Lunges',
    phases: [
      { label: 'Berdiri tegak', angles: { leftHip: 170, rightHip: 170, leftKnee: 170, rightKnee: 170, leftShoulder: 15, rightShoulder: 15 } },
      { label: 'Lunge kiri', angles: { leftHip: 110, rightHip: 150, leftKnee: 85, rightKnee: 140, leftShoulder: 15, rightShoulder: 15 } }
    ],
    requireStanding: true, minMovement: 40
  },
  side_bend: {
    name: 'Side Bend',
    phases: [
      { label: 'Tegak', angles: { leftShoulder: 170, rightShoulder: 170, leftHip: 170, rightHip: 170, leftKnee: 170, rightKnee: 170 } },
      { label: 'Miring ke samping', angles: { leftShoulder: 170, rightShoulder: 170, leftHip: 140, rightHip: 140, leftKnee: 170, rightKnee: 170 } }
    ],
    requireStanding: true, minMovement: 20
  }
};

// Per-person tracking data
class PersonTracker {
  constructor() { this.reset(); }
  reset() {
    this.history = [];
    this.lastPhaseIdx = -1;
    this.phaseChanges = 0;
    this.frameCount = 0;
  }
}

export class PoseComparator {
  static getExercises() { return EXERCISES; }

  // Track up to 4 people
  static _trackers = [new PersonTracker(), new PersonTracker(), new PersonTracker(), new PersonTracker()];

  static resetTracking() {
    this._trackers.forEach(t => t.reset());
  }

  static calcAngle(a, b, c) {
    const ba = { x: a.x - b.x, y: a.y - b.y };
    const bc = { x: c.x - b.x, y: c.y - b.y };
    const dot = ba.x * bc.x + ba.y * bc.y;
    const magBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
    const magBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y);
    if (magBA === 0 || magBC === 0) return 0;
    return (Math.acos(Math.max(-1, Math.min(1, dot / (magBA * magBC)))) * 180) / Math.PI;
  }

  static extractAngles(lm) {
    if (!lm || lm.length < 33) return null;
    return {
      leftElbow: this.calcAngle(lm[11], lm[13], lm[15]),
      rightElbow: this.calcAngle(lm[12], lm[14], lm[16]),
      leftShoulder: this.calcAngle(lm[13], lm[11], lm[23]),
      rightShoulder: this.calcAngle(lm[14], lm[12], lm[24]),
      leftHip: this.calcAngle(lm[11], lm[23], lm[25]),
      rightHip: this.calcAngle(lm[12], lm[24], lm[26]),
      leftKnee: this.calcAngle(lm[23], lm[25], lm[27]),
      rightKnee: this.calcAngle(lm[24], lm[26], lm[28])
    };
  }

  static isStanding(ua) {
    if (!ua) return false;
    return ((ua.leftHip + ua.rightHip) / 2) > 130 && ((ua.leftKnee + ua.rightKnee) / 2) > 130;
  }

  static compare(refAngles, userAngles) {
    if (!refAngles || !userAngles) return { score: 0, details: {} };
    const keys = Object.keys(refAngles);
    let total = 0;
    const details = {};
    for (const k of keys) {
      const diff = Math.abs(refAngles[k] - userAngles[k]);
      const sim = Math.max(0, 100 - (diff / 1.8));
      total += sim;
      details[k] = { ref: refAngles[k], user: userAngles[k], diff, similarity: sim };
    }
    return { score: Math.round(total / keys.length), details };
  }

  // personIdx = index of the person (0-3)
  static compareToExercise(userAngles, exerciseKey, personIdx = 0) {
    if (!userAngles || !EXERCISES[exerciseKey]) return { score: 0, details: {}, phase: '' };
    const exercise = EXERCISES[exerciseKey];
    const tracker = this._trackers[personIdx] || this._trackers[0];
    tracker.frameCount++;

    if (exercise.requireStanding && !this.isStanding(userAngles)) {
      tracker.history.push({ ...userAngles });
      if (tracker.history.length > 30) tracker.history.shift();
      return { score: 5, details: { posture: { similarity: 5 } }, phase: '⚠️ Berdiri dulu!' };
    }

    let bestScore = 0, bestDetails = {}, bestPhase = '', bestIdx = 0;
    for (let i = 0; i < exercise.phases.length; i++) {
      const phase = exercise.phases[i];
      const keys = Object.keys(phase.angles);
      let total = 0;
      const details = {};
      for (const k of keys) {
        if (userAngles[k] === undefined) continue;
        const diff = Math.abs(phase.angles[k] - userAngles[k]);
        const sim = Math.max(0, 100 - (diff * 1.5));
        total += sim;
        details[k] = { target: phase.angles[k], user: userAngles[k], diff, similarity: sim };
      }
      const score = keys.length > 0 ? Math.round(total / keys.length) : 0;
      if (score > bestScore) { bestScore = score; bestDetails = details; bestPhase = phase.label; bestIdx = i; }
    }

    if (tracker.lastPhaseIdx !== -1 && bestIdx !== tracker.lastPhaseIdx && bestScore > 40) tracker.phaseChanges++;
    tracker.lastPhaseIdx = bestIdx;

    tracker.history.push({ ...userAngles });
    if (tracker.history.length > 30) tracker.history.shift();

    if (tracker.history.length >= 15) {
      const old = tracker.history[0], cur = tracker.history[tracker.history.length - 1];
      let tc = 0;
      for (const k of Object.keys(old)) { if (cur[k] !== undefined) tc += Math.abs(cur[k] - old[k]); }
      if ((tc / Object.keys(old).length) < 8 && tracker.frameCount > 60) {
        bestScore = Math.min(bestScore, 25);
        bestPhase = '⚠️ Mulai bergerak!';
      }
    }

    return { score: bestScore, details: bestDetails, phase: bestPhase };
  }

  static getFeedback(details) {
    const LABELS = {
      leftElbow: 'Siku Kiri', rightElbow: 'Siku Kanan',
      leftShoulder: 'Bahu Kiri', rightShoulder: 'Bahu Kanan',
      leftHip: 'Pinggul Kiri', rightHip: 'Pinggul Kanan',
      leftKnee: 'Lutut Kiri', rightKnee: 'Lutut Kanan', posture: 'Postur'
    };
    let worst = null, worstSim = 100;
    for (const [k, v] of Object.entries(details)) {
      if (v.similarity < worstSim) { worstSim = v.similarity; worst = k; }
    }
    if (!worst || worstSim > 75) return { text: 'Bagus! 💪', level: 'good' };
    if (worstSim > 50) return { text: `Perbaiki ${LABELS[worst] || worst}`, level: 'warn' };
    return { text: `Perhatikan ${LABELS[worst] || worst}!`, level: 'bad' };
  }
}
