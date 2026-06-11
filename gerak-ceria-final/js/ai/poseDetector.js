// ══════════════════════════════════════════
// ai/poseDetector.js — MediaPipe Pose Wrapper
// Gerak Ceria AI Adventure
// ══════════════════════════════════════════

const POSE_CONNECTIONS = [
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [11,23],[12,24],[23,24],[23,25],[24,26],
  [25,27],[26,28],[27,29],[28,30],[29,31],[30,32],
  [15,17],[15,19],[15,21],[16,18],[16,20],[16,22]
];

class PoseDetectorClass {
  constructor() {
    this.landmarker = null;
    this.ready = false;
    this._lastTs = -1;
  }

  async init() {
    if (this.ready) return;
    const vision = await window.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    this.landmarker = await window.PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numPoses: 2
    });
    this.ready = true;
    console.log('[PoseDetector] Ready ✅');
  }

  /** Detect landmarks from a video element. Returns array of landmark sets. */
  detect(videoEl, timestamp) {
    if (!this.ready || !videoEl || videoEl.readyState < 2) return [];
    if (timestamp <= this._lastTs) return [];
    try {
      const result = this.landmarker.detectForVideo(videoEl, timestamp);
      this._lastTs = timestamp;
      return result.landmarks || [];
    } catch(e) {
      return [];
    }
  }

  /** Draw skeleton on canvas context */
  drawSkeleton(ctx, canvas, landmarks, color = '#22c55e', lineWidth = 3) {
    if (!landmarks || landmarks.length === 0) return;
    const W = canvas.width;
    const H = canvas.height;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';

    for (const [a, b] of POSE_CONNECTIONS) {
      const la = landmarks[a], lb = landmarks[b];
      if (!la || !lb) continue;
      if ((la.visibility ?? 1) < 0.3 || (lb.visibility ?? 1) < 0.3) continue;
      ctx.beginPath();
      ctx.moveTo(la.x * W, la.y * H);
      ctx.lineTo(lb.x * W, lb.y * H);
      ctx.stroke();
    }

    // Joints
    ctx.fillStyle = '#fff';
    for (const lm of landmarks) {
      if ((lm.visibility ?? 1) < 0.3) continue;
      ctx.beginPath();
      ctx.arc(lm.x * W, lm.y * H, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Extract joint angles for gesture detection */
  extractAngles(lm) {
    if (!lm || lm.length < 33) return null;
    const angle = (a, b, c) => {
      const ba = { x: a.x - b.x, y: a.y - b.y };
      const bc = { x: c.x - b.x, y: c.y - b.y };
      const dot = ba.x * bc.x + ba.y * bc.y;
      const mag = Math.sqrt(ba.x**2+ba.y**2) * Math.sqrt(bc.x**2+bc.y**2);
      if (mag === 0) return 0;
      return (Math.acos(Math.max(-1, Math.min(1, dot/mag))) * 180) / Math.PI;
    };
    return {
      leftElbow:    angle(lm[11], lm[13], lm[15]),
      rightElbow:   angle(lm[12], lm[14], lm[16]),
      leftShoulder: angle(lm[13], lm[11], lm[23]),
      rightShoulder:angle(lm[14], lm[12], lm[24]),
      leftHip:      angle(lm[11], lm[23], lm[25]),
      rightHip:     angle(lm[12], lm[24], lm[26]),
      leftKnee:     angle(lm[23], lm[25], lm[27]),
      rightKnee:    angle(lm[24], lm[26], lm[28]),
      // Y positions for jump detection
      leftWristY:   lm[15]?.y ?? 1,
      rightWristY:  lm[16]?.y ?? 1,
      leftShoulderY:lm[11]?.y ?? 0.5,
      rightShoulderY:lm[12]?.y ?? 0.5,
      noseY:        lm[0]?.y ?? 0.5,
      leftHipY:     lm[23]?.y ?? 0.7,
      rightHipY:    lm[24]?.y ?? 0.7,
    };
  }

  static getConnections() { return POSE_CONNECTIONS; }
}

window.PoseDetector = new PoseDetectorClass();
