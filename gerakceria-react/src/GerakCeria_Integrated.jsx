import { useState, useEffect, useRef, useCallback } from "react";

// ─── MEDIAPIPE + MOVENET LOADER ───────────────────────────────────────────────
// Lazy-loads MediaPipe Tasks Vision (PoseLandmarker) from CDN.
// Falls back gracefully if the browser lacks camera or WebAssembly support.

const MEDIAPIPE_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision";
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Singleton loader — call once per app lifetime
let _poseInitPromise = null;
async function loadMediaPipe() {
  if (_poseInitPromise) return _poseInitPromise;
  _poseInitPromise = (async () => {
    // Inject script tags if not already present
    if (!window.FilesetResolver) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.type = "module";
        s.textContent = `
          import { FilesetResolver, PoseLandmarker }
            from "${MEDIAPIPE_CDN}/vision_bundle.mjs";
          window.FilesetResolver = FilesetResolver;
          window.PoseLandmarker  = PoseLandmarker;
          window.dispatchEvent(new Event('mediapipe_loaded'));
        `;
        document.head.appendChild(s);
        window.addEventListener("mediapipe_loaded", resolve, { once: true });
        setTimeout(reject, 15000); // 15 s timeout
      });
    }
    const vision = await window.FilesetResolver.forVisionTasks(
      `${MEDIAPIPE_CDN}/wasm`
    );
    const landmarker = await window.PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 2,
    });
    return landmarker;
  })();
  return _poseInitPromise;
}

// ─── POSE CONNECTIONS (skeleton lines) ───────────────────────────────────────
const POSE_CONNECTIONS = [
  [11,12],[11,13],[13,15],[12,14],[14,16],
  [11,23],[12,24],[23,24],[23,25],[24,26],
  [25,27],[26,28],[27,29],[28,30],[29,31],[30,32],
  [15,17],[15,19],[15,21],[16,18],[16,20],[16,22],
];

// ─── PURE-JS POSE DETECTOR (ported from ZIP ai/poseDetector.js) ──────────────
class PoseDetectorEngine {
  constructor() { this.landmarker = null; this.ready = false; this._lastTs = -1; }
  async init() {
    if (this.ready) return;
    try {
      this.landmarker = await loadMediaPipe();
      this.ready = true;
    } catch(e) {
      console.warn("[PoseDetector] MediaPipe load failed:", e);
    }
  }
  detect(videoEl, timestamp) {
    if (!this.ready || !videoEl || videoEl.readyState < 2) return [];
    if (timestamp <= this._lastTs) return [];
    try {
      const result = this.landmarker.detectForVideo(videoEl, timestamp);
      this._lastTs = timestamp;
      return result.landmarks || [];
    } catch(e) { return []; }
  }
  drawSkeleton(ctx, canvas, landmarks, color = "#22c55e", lineWidth = 3) {
    if (!landmarks || landmarks.length === 0) return;
    const W = canvas.width, H = canvas.height;
    ctx.strokeStyle = color; ctx.lineWidth = lineWidth; ctx.lineCap = "round";
    for (const [a, b] of POSE_CONNECTIONS) {
      const la = landmarks[a], lb = landmarks[b];
      if (!la || !lb) continue;
      if ((la.visibility ?? 1) < 0.3 || (lb.visibility ?? 1) < 0.3) continue;
      ctx.beginPath();
      ctx.moveTo(la.x * W, la.y * H);
      ctx.lineTo(lb.x * W, lb.y * H);
      ctx.stroke();
    }
    ctx.fillStyle = "#fff";
    for (const lm of landmarks) {
      if ((lm.visibility ?? 1) < 0.3) continue;
      ctx.beginPath();
      ctx.arc(lm.x * W, lm.y * H, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
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
      leftWristY:   lm[15]?.y ?? 1,
      rightWristY:  lm[16]?.y ?? 1,
      leftShoulderY:lm[11]?.y ?? 0.5,
      rightShoulderY:lm[12]?.y ?? 0.5,
      noseY:        lm[0]?.y ?? 0.5,
      leftHipY:     lm[23]?.y ?? 0.7,
      rightHipY:    lm[24]?.y ?? 0.7,
    };
  }
}
const PoseDetector = new PoseDetectorEngine();

// ─── GESTURE DETECTOR (ported from ZIP ai/gestureDetector.js) ─────────────────
const GestureDetector = (() => {
  const HISTORY_SIZE = 8;
  const histories = {};
  const push = (id, val) => {
    if (!histories[id]) histories[id] = [];
    histories[id].push(val);
    if (histories[id].length > HISTORY_SIZE) histories[id].shift();
  };
  const avg = (id) => {
    const h = histories[id] || [];
    return h.length ? h.reduce((a,b)=>a+b,0)/h.length : 0;
  };
  const detect = (angles, personId = 0) => {
    if (!angles) return {};
    const pid = `p${personId}`;
    const leftRaised  = angles.leftWristY  < angles.leftShoulderY  - 0.05;
    const rightRaised = angles.rightWristY < angles.rightShoulderY - 0.05;
    push(`${pid}_raised`, (leftRaised && rightRaised) ? 1 : 0);
    push(`${pid}_leftHand`, leftRaised ? 1 : 0);
    push(`${pid}_rightHand`, rightRaised ? 1 : 0);
    const kneeAvg = (angles.leftKnee + angles.rightKnee) / 2;
    const hipAvg  = (angles.leftHip  + angles.rightHip)  / 2;
    push(`${pid}_squat`, (kneeAvg < 120 && hipAvg < 120) ? 1 : 0);
    const noseY = angles.noseY;
    push(`${pid}_noseY`, noseY);
    const noseHist = histories[`${pid}_noseY`] || [];
    let jumping = false;
    if (noseHist.length >= 4) {
      const diff = noseHist[0] - noseHist[noseHist.length - 1];
      jumping = diff > 0.04;
    }
    const leftKneeLift  = angles.leftKnee  < 140;
    const rightKneeLift = angles.rightKnee < 140;
    push(`${pid}_runL`, leftKneeLift  ? 1 : 0);
    push(`${pid}_runR`, rightKneeLift ? 1 : 0);
    const runActivity = (avg(`${pid}_runL`) + avg(`${pid}_runR`)) / 2;
    return {
      raisedHands: avg(`${pid}_raised`) > 0.6,
      handLeft:    avg(`${pid}_leftHand`) > 0.6,
      handRight:   avg(`${pid}_rightHand`) > 0.6,
      squat:       avg(`${pid}_squat`) > 0.5,
      jumping,
      running:     runActivity > 0.3,
    };
  };
  const checkMove = (moveName, angles, personId = 0) => {
    const g = detect(angles, personId);
    switch (moveName) {
      case "raise_both":  return g.raisedHands;
      case "raise_right": return g.handRight;
      case "raise_left":  return g.handLeft;
      case "squat":       return g.squat;
      case "jump":        return g.jumping;
      case "run":         return g.running;
      default: return false;
    }
  };
  const resetAll = () => Object.keys(histories).forEach(k => delete histories[k]);
  return { detect, checkMove, resetAll };
})();

// ─── EMOTION DETECTOR (ported from ZIP ai/emotionDetector.js) ─────────────────
const EmotionDetector = (() => {
  const MSGS = {
    happy:   ["Semangat terus! 🎉","Kamu hebat! 🌟","Luar biasa! ⭐"],
    tired:   ["Istirahat sebentar ya!","Tetap semangat! 💪","Kamu bisa!"],
    great:   ["Gerakan sempurna! 🏆","Mantap sekali! 🔥","Terus begitu!"],
    neutral: ["Ayo bergerak! 🏃","Fokus ya!","Kita bisa!"],
  };
  const detect = (angles) => {
    if (!angles) return "neutral";
    const bothUp = angles.leftWristY < angles.leftShoulderY - 0.1 &&
                   angles.rightWristY < angles.rightShoulderY - 0.1;
    if (bothUp) return "happy";
    const deepSquat = (angles.leftKnee + angles.rightKnee) / 2 < 100;
    if (deepSquat) return "great";
    const shoulderAvg = (angles.leftShoulder + angles.rightShoulder) / 2;
    if (shoulderAvg < 20) return "tired";
    return "neutral";
  };
  const getMessage = (emotion) => {
    const msgs = MSGS[emotion] || MSGS.neutral;
    return msgs[Math.floor(Math.random() * msgs.length)];
  };
  return { detect, getMessage };
})();

// ─── CAMERA HOOK ──────────────────────────────────────────────────────────────
// Reusable hook: starts webcam, inits PoseDetector, runs animation loop.
// Returns { videoRef, canvasRef, cameraReady, cameraError, poseReady,
//           startCamera, stopCamera, lastAngles, lastGesture, poseDetected }
function useCameraTracking({ enabled = true, onGestureDetected } = {}) {
  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const streamRef   = useRef(null);
  const rafRef      = useRef(null);
  const lastGestRef = useRef(false);
  const [cameraReady, setCameraReady]   = useState(false);
  const [cameraError, setCameraError]   = useState(null);
  const [poseReady,   setPoseReady]     = useState(false);
  const [lastAngles,  setLastAngles]    = useState(null);
  const [lastGesture, setLastGesture]   = useState({});
  const [poseDetected, setPoseDetected] = useState(false);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch (e) {
      setCameraError(e.message || "Kamera tidak dapat diakses");
    }
    // Init PoseDetector in parallel
    try {
      await PoseDetector.init();
      setPoseReady(true);
    } catch (e) {
      console.warn("[Camera] PoseDetector init failed:", e);
    }
  }, []);

  const startLoop = useCallback((moveTarget, onDetect) => {
    const loop = () => {
      const video  = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !PoseDetector.ready) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      canvas.width  = video.videoWidth  || video.clientWidth;
      canvas.height = video.videoHeight || video.clientHeight;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const ts = performance.now();
      const allLandmarks = PoseDetector.detect(video, ts);
      const lm = allLandmarks[0] ?? null;

      if (lm) {
        setPoseDetected(true);
        PoseDetector.drawSkeleton(ctx, canvas, lm);
        const angles  = PoseDetector.extractAngles(lm);
        setLastAngles(angles);
        const gesture = GestureDetector.detect(angles, 0);
        setLastGesture(gesture);

        if (moveTarget && angles) {
          const detected = GestureDetector.checkMove(moveTarget, angles, 0);
          // Rising edge — fire only once per gesture
          if (detected && !lastGestRef.current) {
            onDetect && onDetect(angles, gesture);
          }
          lastGestRef.current = detected;
        }
      } else {
        setPoseDetected(false);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const stopCamera = useCallback(() => {
    if (rafRef.current)  { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
    setPoseDetected(false);
    GestureDetector.resetAll();
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  return {
    videoRef, canvasRef,
    cameraReady, cameraError, poseReady,
    startCamera, stopCamera, startLoop,
    lastAngles, lastGesture, poseDetected,
  };
}

// ─── CAMERA VIEW COMPONENT ────────────────────────────────────────────────────
// Drop-in camera panel — overlays skeleton canvas on the video feed.
function CameraView({ videoRef, canvasRef, cameraReady, cameraError, poseDetected, poseReady, height = 220, style = {} }) {
  return (
    <div style={{
      position: "relative", width: "100%", height,
      background: "rgba(0,0,0,0.6)", borderRadius: 18,
      overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)",
      ...style,
    }}>
      {/* Video feed (mirrored) */}
      <video
        ref={videoRef}
        autoPlay playsInline muted
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: "cover",
          transform: "scaleX(-1)",
          opacity: cameraReady ? 1 : 0,
          transition: "opacity 0.4s",
        }}
      />
      {/* Skeleton overlay */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          transform: "scaleX(-1)",
          pointerEvents: "none",
        }}
      />
      {/* Status badges */}
      {cameraReady && (
        <div style={{
          position: "absolute", top: 10, left: 10,
          display: "flex", gap: 6, flexDirection: "column",
        }}>
          <div style={{
            background: "rgba(0,0,0,0.6)", borderRadius: 50,
            padding: "3px 10px", fontSize: 10, fontWeight: 800,
            color: poseDetected ? "#22c55e" : "#94a3b8",
            display: "flex", alignItems: "center", gap: 5,
            backdropFilter: "blur(8px)",
          }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: poseDetected ? "#22c55e" : "#64748b",
              animation: poseDetected ? "pulse 1s ease-in-out infinite" : "none",
            }} />
            {poseDetected ? "POSE TERDETEKSI" : poseReady ? "Tunggu gerakan…" : "Loading AI…"}
          </div>
          {poseDetected && (
            <div style={{
              background: "rgba(124,58,237,0.7)", borderRadius: 50,
              padding: "3px 10px", fontSize: 10, fontWeight: 800, color: "#fff",
              backdropFilter: "blur(8px)",
            }}>
              📡 MediaPipe Active
            </div>
          )}
        </div>
      )}
      {/* Placeholder when camera is off */}
      {!cameraReady && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <div style={{ fontSize: 36 }}>📷</div>
          <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700, textAlign: "center", padding: "0 16px" }}>
            {cameraError ? `❌ ${cameraError}` : "Kamera belum aktif"}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SVG MASCOT ──────────────────────────────────────────────────────────────
const MascotSVG = ({ size = 120, mood = "happy", glow = false }) => (
  <svg width={size} height={size} viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"
    style={{ filter: glow ? "drop-shadow(0 0 16px #a78bfa) drop-shadow(0 0 32px #7c3aed)" : "drop-shadow(0 4px 12px rgba(124,58,237,0.4))" }}>
    <ellipse cx="60" cy="80" rx="28" ry="32" fill="url(#bodyGrad)" />
    <circle cx="60" cy="45" r="30" fill="url(#headGrad)" />
    <rect x="34" y="33" width="52" height="26" rx="10" fill="url(#visorGrad)" opacity="0.9" />
    <ellipse cx="48" cy="46" rx="7" ry="8" fill="#fff" />
    <ellipse cx="72" cy="46" rx="7" ry="8" fill="#fff" />
    <circle cx={mood === "happy" ? 50 : 48} cy="46" r="4" fill="#1e1b4b" />
    <circle cx={mood === "happy" ? 74 : 72} cy="46" r="4" fill="#1e1b4b" />
    <circle cx={mood === "happy" ? 51 : 49} cy="44" r="1.5" fill="#fff" />
    <circle cx={mood === "happy" ? 75 : 73} cy="44" r="1.5" fill="#fff" />
    {mood === "happy"
      ? <path d="M50 58 Q60 66 70 58" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      : <path d="M50 60 Q60 55 70 60" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" fill="none" />}
    <line x1="60" y1="15" x2="60" y2="0" stroke="#c4b5fd" strokeWidth="3" strokeLinecap="round" />
    <circle cx="60" cy="0" r="5" fill="#a78bfa">
      <animate attributeName="r" values="5;7;5" dur="1.5s" repeatCount="indefinite" />
    </circle>
    <rect x="18" y="70" width="12" height="28" rx="6" fill="url(#bodyGrad)" transform="rotate(-15 18 70)" />
    <rect x="90" y="70" width="12" height="28" rx="6" fill="url(#bodyGrad)" transform="rotate(15 90 70)" />
    <rect x="44" y="106" width="12" height="14" rx="6" fill="#6d28d9" />
    <rect x="64" y="106" width="12" height="14" rx="6" fill="#6d28d9" />
    <ellipse cx="50" cy="119" rx="10" ry="5" fill="#4c1d95" />
    <ellipse cx="70" cy="119" rx="10" ry="5" fill="#4c1d95" />
    <text x="96" y="28" fontSize="12" fill="#fbbf24">✦</text>
    <text x="10" y="35" fontSize="10" fill="#34d399">✦</text>
    <defs>
      <radialGradient id="headGrad" cx="40%" cy="35%">
        <stop stopColor="#c4b5fd" /><stop offset="1" stopColor="#7c3aed" />
      </radialGradient>
      <radialGradient id="bodyGrad" cx="40%" cy="30%">
        <stop stopColor="#a78bfa" /><stop offset="1" stopColor="#5b21b6" />
      </radialGradient>
      <linearGradient id="visorGrad" x1="0" y1="0" x2="0" y2="1">
        <stop stopColor="#e0f2fe" stopOpacity="0.9" /><stop offset="1" stopColor="#bae6fd" stopOpacity="0.6" />
      </linearGradient>
    </defs>
  </svg>
);

// ─── STAR SVG ─────────────────────────────────────────────────────────────────
const StarIcon = ({ filled, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "#fbbf24" : "none"} stroke={filled ? "#fbbf24" : "#94a3b8"} strokeWidth="2">
    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
  </svg>
);

// ─── CONFETTI ────────────────────────────────────────────────────────────────
const Confetti = ({ active }) => {
  const pieces = useRef([...Array(32)].map((_, i) => ({
    id: i,
    x: Math.random() * 100,
    color: ["#fbbf24","#f472b6","#34d399","#60a5fa","#c084fc","#fb923c"][i % 6],
    delay: Math.random() * 0.8,
    size: 6 + Math.random() * 8,
    rotate: Math.random() * 360,
  })));
  if (!active) return null;
  return (
    <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:999, overflow:"hidden" }}>
      {pieces.current.map(p => (
        <div key={p.id} style={{
          position:"absolute", left:`${p.x}%`, top:"-20px",
          width:p.size, height:p.size, background:p.color,
          borderRadius: p.id % 3 === 0 ? "50%" : "2px",
          transform:`rotate(${p.rotate}deg)`,
          animation:`confettiFall 2.5s ${p.delay}s ease-in forwards`,
        }} />
      ))}
      <style>{`
        @keyframes confettiFall {
          0% { top:-20px; opacity:1; transform:rotate(0deg) translateX(0); }
          100% { top:110vh; opacity:0; transform:rotate(720deg) translateX(${Math.random() > 0.5 ? 80 : -80}px); }
        }
      `}</style>
    </div>
  );
};

// ─── FLOATING PARTICLES ───────────────────────────────────────────────────────
const FloatingParticles = () => {
  const particles = useRef([...Array(18)].map((_, i) => ({
    id: i,
    x: Math.random() * 100,
    size: 4 + Math.random() * 8,
    dur: 8 + Math.random() * 12,
    delay: Math.random() * 8,
    color: ["rgba(167,139,250,0.4)","rgba(52,211,153,0.3)","rgba(251,191,36,0.3)","rgba(96,165,250,0.3)"][i % 4],
  })));
  return (
    <div style={{ position:"absolute", inset:0, overflow:"hidden", pointerEvents:"none" }}>
      {particles.current.map(p => (
        <div key={p.id} style={{
          position:"absolute",
          left:`${p.x}%`, bottom:"-20px",
          width:p.size, height:p.size,
          borderRadius:"50%",
          background:p.color,
          animation:`floatUp ${p.dur}s ${p.delay}s ease-in-out infinite`,
        }} />
      ))}
    </div>
  );
};

// ─── AUDIO SYSTEM ──────────────────────────────────────────────────────────────
const AudioSystem = (() => {
  let ctx = null;
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function beep(freq, duration, type = "sine", vol = 0.3) {
    try {
      const ac = getCtx();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.connect(gain); gain.connect(ac.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ac.currentTime);
      gain.gain.setValueAtTime(vol, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
      osc.start(ac.currentTime); osc.stop(ac.currentTime + duration);
    } catch(e) {}
  }
  return {
    click:    () => beep(800, 0.08, "square", 0.15),
    success:  () => { beep(523, 0.15); setTimeout(() => beep(659, 0.15), 100); setTimeout(() => beep(784, 0.25), 200); },
    fail:     () => { beep(300, 0.2, "sawtooth"); setTimeout(() => beep(220, 0.3, "sawtooth"), 150); },
    rep:      () => beep(660, 0.1, "sine", 0.2),
    combo:    () => { beep(880, 0.08); setTimeout(() => beep(1100, 0.12), 80); },
    levelup:  () => { [523,587,659,698,784].forEach((f, i) => setTimeout(() => beep(f, 0.15), i * 80)); },
    countdown:(n) => beep(n === 0 ? 880 : 440, 0.15),
    win:      () => { [523,659,784,1047].forEach((f,i) => setTimeout(() => beep(f,0.2), i*120)); },
    badge:    () => { [523,659,784].forEach(f=>beep(f,0.2)); setTimeout(()=>[659,784,1047].forEach(f=>beep(f,0.35)),200); },
    energy:   () => beep(440, 0.1, "sine", 0.15),
  };
})();

// ─── GAME STATE ────────────────────────────────────────────────────────────────
const DEFAULT_STATE = {
  playerName: "Atlet Cilik",
  level: 7,
  exp: 1240,
  energy: 60,
  totalStars: 6,
  totalMoves: 48,
  streak: 5,
  lastPlayDate: null,
  levelStars: { 1:3, 2:2, 3:1, 4:0, 5:0 },
  levelUnlocked: { 1:true, 2:true, 3:true, 4:false, 5:false },
  badges: {
    warmup_king: { unlocked: true, date: new Date().toISOString() },
    sporty_kid:  { unlocked: true, date: new Date().toISOString() },
    active_kid:  { unlocked: true, date: new Date().toISOString() },
  },
  activityLog: [
    { type:"mission", name:"Latihan Dasar", score:150, icon:"🌱", date:"Hari ini" },
    { type:"challenge", name:"Motion Challenge", score:320, icon:"⚡", date:"Hari ini" },
    { type:"mission", name:"Lompatan Ceria", score:200, icon:"⬆️", date:"Kemarin" },
  ],
  weeklyActivity: [12, 35, 28, 48, 55, 42, 38],
  totalCalories: 186,
  warmupCount: 3,
  challengeHighScore: 320,
  miniGameHighScores: {},
  redTeamWins: 0,
  blueTeamWins: 0,
  settings: { sound: true, music: true, tracking: true },
};

function useGameState() {
  const [state, setStateRaw] = useState(() => {
    try {
      const saved = localStorage.getItem("gerakCeriaState");
      if (saved) return { ...DEFAULT_STATE, ...JSON.parse(saved) };
    } catch(e) {}
    return { ...DEFAULT_STATE };
  });

  const setState = useCallback((updater) => {
    setStateRaw(prev => {
      const next = typeof updater === "function" ? updater(prev) : { ...prev, ...updater };
      try { localStorage.setItem("gerakCeriaState", JSON.stringify(next)); } catch(e) {}
      return next;
    });
  }, []);

  const addXP = useCallback((amount) => {
    setState(prev => {
      let newExp = prev.exp + amount;
      let newLevel = prev.level;
      while (newExp >= 2000) { newExp -= 2000; newLevel++; }
      return { ...prev, exp: newExp, level: newLevel };
    });
  }, [setState]);

  const addActivity = useCallback((entry) => {
    setState(prev => {
      const today = new Date().toLocaleDateString("id-ID");
      const full = { ...entry, date: today, timestamp: Date.now() };
      const newLog = [full, ...prev.activityLog].slice(0, 20);
      const dayIdx = new Date().getDay();
      const newWeekly = [...prev.weeklyActivity];
      newWeekly[dayIdx] = (newWeekly[dayIdx] || 0) + 1;
      const isNewDay = prev.lastPlayDate !== new Date().toDateString();
      return {
        ...prev,
        activityLog: newLog,
        weeklyActivity: newWeekly,
        totalMoves: prev.totalMoves + 1,
        totalCalories: prev.totalCalories + Math.floor(Math.random() * 8) + 3,
        streak: isNewDay ? prev.streak + 1 : prev.streak,
        lastPlayDate: isNewDay ? new Date().toDateString() : prev.lastPlayDate,
      };
    });
  }, [setState]);

  const unlockBadge = useCallback((badgeId) => {
    setState(prev => {
      if (prev.badges[badgeId]?.unlocked) return prev;
      return { ...prev, badges: { ...prev.badges, [badgeId]: { unlocked: true, date: new Date().toISOString() } } };
    });
    return true;
  }, [setState]);

  const setLevelStars = useCallback((levelId, stars) => {
    setState(prev => {
      const prevStars = prev.levelStars[levelId] || 0;
      const newStars = Math.max(prevStars, stars);
      const newLevelStars = { ...prev.levelStars, [levelId]: newStars };
      const newUnlocked = { ...prev.levelUnlocked };
      if (stars >= 1 && levelId < 5) newUnlocked[levelId + 1] = true;
      const total = Object.values(newLevelStars).reduce((a, b) => a + b, 0);
      return { ...prev, levelStars: newLevelStars, levelUnlocked: newUnlocked, totalStars: total };
    });
  }, [setState]);

  const resetState = useCallback(() => {
    try { localStorage.removeItem("gerakCeriaState"); } catch(e) {}
    setStateRaw({ ...DEFAULT_STATE });
  }, []);

  return { state, setState, addXP, addActivity, unlockBadge, setLevelStars, resetState };
}

// ─── BADGE DEFINITIONS ────────────────────────────────────────────────────────
const BADGE_DEFS = [
  { id:"warmup_king",    icon:"🔥", name:"Raja Pemanasan",     desc:"Selesaikan AI Warm-Up pertamamu!",        trigger:"warmup_complete" },
  { id:"sporty_kid",     icon:"🏃", name:"Atlet Sportif",      desc:"Main 5 sesi game apapun.",                trigger:"play_5" },
  { id:"jump_master",    icon:"🏆", name:"Master Lompat",      desc:"Lakukan 20 lompatan dalam satu sesi.",    trigger:"jump_20" },
  { id:"team_player",    icon:"🤝", name:"Atlet Gotong Royong", desc:"Menangkan estafet tim.",                  trigger:"relay_win" },
  { id:"active_kid",     icon:"⚡", name:"Anak Aktif",         desc:"Bermain 3 hari berturut-turut.",          trigger:"streak_3" },
  { id:"star_collector", icon:"⭐", name:"Kolektor Bintang",   desc:"Kumpulkan 10 bintang dari mission.",      trigger:"stars_10" },
  { id:"challenge_hero", icon:"⚔️", name:"Hero Challenge",     desc:"Capai combo x5 di Motion Challenge.",     trigger:"combo_5" },
  { id:"perfect_mover",  icon:"💎", name:"Gerak Sempurna",     desc:"Raih skor 100% di salah satu mini game.", trigger:"perfect_score" },
];

// ─── MISSION DATA ──────────────────────────────────────────────────────────────
const MISSIONS_DATA = [
  { id:1, name:"Latihan Dasar",   icon:"🌱", desc:"Gerakan dasar olahraga",  color:"#22c55e", glow:"rgba(34,197,94,0.4)",   moves:["raise_both","squat"], target:5 },
  { id:2, name:"Lompatan Ceria",  icon:"⬆️", desc:"Tantangan melompat seru", color:"#3b82f6", glow:"rgba(59,130,246,0.4)",  moves:["jump","raise_both"],  target:8 },
  { id:3, name:"Sprint Mini",     icon:"🏃", desc:"Lari kencang di tempat",  color:"#f97316", glow:"rgba(249,115,22,0.4)",  moves:["run","squat"],        target:10 },
  { id:4, name:"Combo Gerak",     icon:"⚡", desc:"Kombinasi gerakan ajaib", color:"#a855f7", glow:"rgba(168,85,247,0.4)",  moves:["raise_both","squat","jump"], target:8 },
  { id:5, name:"Master Olahraga", icon:"🏆", desc:"Tantangan akhir BOSS!",  color:"#ef4444", glow:"rgba(239,68,68,0.4)",   moves:["raise_both","squat","jump","run"], target:12 },
];

const DAILY_CHALLENGES = [
  { id:1, title:"Lompat 10x Berturut", icon:"⬆️", reward:"+30 XP", progress:60, color:"#f472b6", done:false },
  { id:2, title:"Squat 15x Hari Ini",  icon:"🦵", reward:"+25 XP", progress:100, color:"#34d399", done:true },
  { id:3, title:"Streak 3 Hari",        icon:"🔥", reward:"+50 XP", progress:33,  color:"#fb923c", done:false },
];

const WARMUP_MOVES = [
  { id:"raise_both", name:"Angkat Kedua Tangan", icon:"🙌", reps:5, instruction:"Angkat kedua tangan ke atas kepala!" },
  { id:"squat",      name:"Squat",               icon:"🦵", reps:5, instruction:"Tekuk lutut seperti mau duduk, lalu berdiri lagi!" },
  { id:"jump",       name:"Lompat Kecil",         icon:"⬆️", reps:5, instruction:"Lompat-lompat kecil di tempat!" },
  { id:"run",        name:"Lari di Tempat",       icon:"🏃", reps:8, instruction:"Angkat kaki bergantian seperti lari!" },
];

const COACH_MSGS = [
  "Ayo bergerak! Kamu bisa jadi juara! 💪",
  "Bagus sekali! Terus semangat! 🔥",
  "Gerakan kamu keren banget hari ini! ⚡",
  "Level up menanti! Kamu hampir sampai! 🌟",
  "Streak-mu makin panjang, luar biasa! 🏆",
];

const MOTION_CHALLENGES = [
  { text:"Angkat kedua tangan! 🙌", move:"raise_both", icon:"🙌" },
  { text:"Squat sekarang! 🦵",       move:"squat",      icon:"🦵" },
  { text:"Lompat 1x! ⬆️",            move:"jump",       icon:"⬆️" },
  { text:"Lari di tempat! 🏃",       move:"run",        icon:"🏃" },
  { text:"Angkat tangan kanan! ✋",  move:"raise_right",icon:"✋" },
  { text:"Angkat tangan kiri! 🤚",  move:"raise_left", icon:"🤚" },
];

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function GerakCeria() {
  const [screen, setScreen] = useState("home");
  const [confetti, setConfetti] = useState(false);
  const [coachIdx, setCoachIdx] = useState(0);
  const [hoveredNav, setHoveredNav] = useState(null);
  const [pressedPlay, setPressedPlay] = useState(false);
  const [toast, setToast] = useState(null);
  const { state, setState, addXP, addActivity, unlockBadge, setLevelStars, resetState } = useGameState();

  useEffect(() => {
    const t = setInterval(() => setCoachIdx(i => (i + 1) % COACH_MSGS.length), 4000);
    return () => clearInterval(t);
  }, []);

  const triggerConfetti = () => {
    setConfetti(true);
    setTimeout(() => setConfetti(false), 3000);
  };

  const showToast = useCallback((msg, duration = 3000) => {
    setToast(msg);
    setTimeout(() => setToast(null), duration);
  }, []);

  const tryAwardBadge = useCallback((trigger) => {
    const badge = BADGE_DEFS.find(b => b.trigger === trigger);
    if (!badge) return;
    if (!state.badges[badge.id]?.unlocked) {
      unlockBadge(badge.id);
      showToast(`🏅 Badge baru: ${badge.name} ${badge.icon}`, 3500);
      triggerConfetti();
      AudioSystem.badge();
    }
  }, [state.badges, unlockBadge, showToast]);

  const nav = [
    { id:"home",      icon: <HomeIcon />,     label:"Home" },
    { id:"mission",   icon: <MapIcon />,      label:"Misi" },
    { id:"challenge", icon: <ZapIcon />,      label:"Challenge" },
    { id:"warmup",    icon: <FireIcon />,     label:"Warmup" },
    { id:"minibattle",icon: <SwordIcon />,    label:"Battle" },
    { id:"badges",    icon: <TrophyIcon />,   label:"Badge" },
    { id:"stats",     icon: <ChartIcon />,    label:"Statistik" },
    { id:"settings",  icon: <SettingsIcon />, label:"Setting" },
  ];

  return (
    <div style={{ fontFamily:"'Nunito', sans-serif", minHeight:"100vh", background:"linear-gradient(135deg, #0f0c29 0%, #1a0533 40%, #0d2137 100%)", display:"flex", position:"relative", overflow:"hidden" }}>
      <style>{CSS}</style>
      <Confetti active={confetti} />
      <FloatingParticles />

      {/* ── TOAST ─── */}
      {toast && (
        <div style={{
          position:"fixed", top:20, left:"50%", transform:"translateX(-50%)",
          background:"rgba(20,20,40,0.95)", border:"1px solid rgba(167,139,250,0.4)",
          borderRadius:14, padding:"12px 24px", color:"#fff", fontSize:14, fontWeight:800,
          zIndex:1000, backdropFilter:"blur(20px)", boxShadow:"0 8px 32px rgba(0,0,0,0.4)",
          animation:"coachFadeIn 0.3s ease",
        }}>{toast}</div>
      )}

      {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
      <aside style={{
        width: 88, minHeight:"100vh", background:"rgba(255,255,255,0.04)",
        backdropFilter:"blur(20px)", borderRight:"1px solid rgba(255,255,255,0.08)",
        display:"flex", flexDirection:"column", alignItems:"center",
        padding:"20px 0", gap:4, position:"relative", zIndex:10, flexShrink:0,
      }}>
        <div style={{ marginBottom:16, textAlign:"center" }}>
          <div style={{
            width:52, height:52, borderRadius:16, background:"linear-gradient(135deg,#7c3aed,#2563eb)",
            display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:26, boxShadow:"0 4px 20px rgba(124,58,237,0.5)",
            animation:"logoFloat 3s ease-in-out infinite",
          }}>🏃</div>
        </div>

        {nav.map(n => (
          <button key={n.id}
            onMouseEnter={() => setHoveredNav(n.id)}
            onMouseLeave={() => setHoveredNav(null)}
            onClick={() => { AudioSystem.click(); setScreen(n.id); }}
            style={{
              width:64, height:56, borderRadius:18, border:"none",
              background: screen === n.id
                ? "linear-gradient(135deg,#7c3aed,#2563eb)"
                : hoveredNav === n.id
                  ? "rgba(124,58,237,0.2)"
                  : "transparent",
              cursor:"pointer", display:"flex", flexDirection:"column",
              alignItems:"center", justifyContent:"center", gap:3,
              transition:"all 0.25s cubic-bezier(0.34,1.56,0.64,1)",
              transform: screen === n.id ? "scale(1.08)" : hoveredNav === n.id ? "scale(1.04)" : "scale(1)",
              boxShadow: screen === n.id ? "0 4px 20px rgba(124,58,237,0.5)" : "none",
              color: screen === n.id ? "#fff" : hoveredNav === n.id ? "#c4b5fd" : "#64748b",
              position:"relative",
            }}>
            <div style={{ fontSize:20 }}>{n.icon}</div>
            <div style={{ fontSize:8, fontWeight:800, letterSpacing:0.5 }}>{n.label}</div>
            {screen === n.id && (
              <div style={{
                position:"absolute", right:-2, top:"50%", transform:"translateY(-50%)",
                width:4, height:28, borderRadius:4, background:"linear-gradient(#7c3aed,#2563eb)",
              }} />
            )}
          </button>
        ))}

        <div style={{ marginTop:"auto", cursor:"pointer" }} onClick={() => setScreen("home")}>
          <MascotSVG size={60} mood="happy" />
        </div>
      </aside>

      {/* ── MAIN CONTENT ──────────────────────────────────────────────── */}
      <main style={{ flex:1, overflow:"auto", position:"relative", zIndex:5 }}>
        {screen === "home" && (
          <HomeScreen
            state={state}
            coachMsg={COACH_MSGS[coachIdx]}
            onPlay={() => { setPressedPlay(true); setTimeout(() => { setPressedPlay(false); setScreen("warmup"); }, 200); }}
            pressedPlay={pressedPlay}
            triggerConfetti={triggerConfetti}
            setScreen={setScreen}
          />
        )}
        {screen === "mission" && (
          <MissionScreen
            state={state}
            setLevelStars={setLevelStars}
            addXP={addXP}
            addActivity={addActivity}
            tryAwardBadge={tryAwardBadge}
            triggerConfetti={triggerConfetti}
            showToast={showToast}
          />
        )}
        {screen === "challenge" && (
          <ChallengeScreen
            challenges={DAILY_CHALLENGES}
            triggerConfetti={triggerConfetti}
            addXP={addXP}
            addActivity={addActivity}
          />
        )}
        {screen === "warmup" && (
          <WarmupScreen
            state={state}
            setState={setState}
            addXP={addXP}
            addActivity={addActivity}
            tryAwardBadge={tryAwardBadge}
            triggerConfetti={triggerConfetti}
            showToast={showToast}
          />
        )}
        {screen === "minibattle" && (
          <MiniBattleScreen
            state={state}
            setState={setState}
            addActivity={addActivity}
            tryAwardBadge={tryAwardBadge}
            triggerConfetti={triggerConfetti}
            showToast={showToast}
          />
        )}
        {screen === "badges" && (
          <BadgesScreen
            state={state}
            triggerConfetti={triggerConfetti}
          />
        )}
        {screen === "stats" && (
          <StatsScreen state={state} addActivity={addActivity} />
        )}
        {screen === "settings" && (
          <SettingsScreen
            state={state}
            setState={setState}
            resetState={resetState}
            showToast={showToast}
          />
        )}
      </main>
    </div>
  );
}

// ─── HOME SCREEN ──────────────────────────────────────────────────────────────
function HomeScreen({ state, coachMsg, onPlay, pressedPlay, triggerConfetti, setScreen }) {
  const xpToNext = 2000;
  const xpPercent = Math.round((state.exp / xpToNext) * 100);

  return (
    <div style={{ padding:"28px 32px", display:"flex", flexDirection:"column", gap:24, minHeight:"100vh" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <div style={{ fontSize:13, color:"#94a3b8", fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Selamat Datang!</div>
          <div style={{ fontSize:28, fontWeight:900, color:"#fff", lineHeight:1.2 }}>Hai, {state.playerName}! 👋</div>
        </div>
        <div style={{ display:"flex", gap:10 }}>
          <div style={{ background:"linear-gradient(135deg,#fb923c,#ef4444)", borderRadius:14, padding:"8px 16px", display:"flex", alignItems:"center", gap:6, boxShadow:"0 4px 16px rgba(239,68,68,0.4)" }}>
            <span style={{ fontSize:18 }}>🔥</span>
            <div>
              <div style={{ fontSize:18, fontWeight:900, color:"#fff", lineHeight:1 }}>{state.streak}</div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.8)", fontWeight:700 }}>STREAK</div>
            </div>
          </div>
          <div style={{ background:"linear-gradient(135deg,#7c3aed,#2563eb)", borderRadius:14, padding:"8px 16px", display:"flex", alignItems:"center", gap:6, boxShadow:"0 4px 16px rgba(124,58,237,0.4)" }}>
            <span style={{ fontSize:18 }}>⭐</span>
            <div>
              <div style={{ fontSize:18, fontWeight:900, color:"#fff", lineHeight:1 }}>{state.exp}</div>
              <div style={{ fontSize:10, color:"rgba(255,255,255,0.8)", fontWeight:700 }}>XP TOTAL</div>
            </div>
          </div>
        </div>
      </div>

      {/* HERO: Mascot + AI Coach */}
      <div style={{
        background:"linear-gradient(135deg, rgba(124,58,237,0.3) 0%, rgba(37,99,235,0.2) 50%, rgba(16,185,129,0.15) 100%)",
        border:"1px solid rgba(167,139,250,0.25)",
        borderRadius:28, padding:"28px 32px",
        display:"flex", alignItems:"center", gap:28,
        position:"relative", overflow:"hidden",
        backdropFilter:"blur(10px)",
      }}>
        <div style={{ position:"absolute", top:-60, right:-60, width:200, height:200, borderRadius:"50%", background:"radial-gradient(circle, rgba(124,58,237,0.3) 0%, transparent 70%)", pointerEvents:"none" }} />
        <div style={{ animation:"mascotBob 3s ease-in-out infinite", flexShrink:0 }}>
          <MascotSVG size={140} mood="happy" glow />
        </div>
        <div style={{ flex:1 }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:8, background:"rgba(52,211,153,0.15)", border:"1px solid rgba(52,211,153,0.3)", borderRadius:50, padding:"4px 14px", marginBottom:12 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:"#34d399", animation:"pulse 1.5s ease-in-out infinite" }} />
            <span style={{ fontSize:11, color:"#34d399", fontWeight:800, letterSpacing:1 }}>AI COACH AKTIF</span>
          </div>
          <div style={{
            background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)",
            borderRadius:18, padding:"16px 20px", marginBottom:16,
            backdropFilter:"blur(8px)", minHeight:64,
            animation:"coachFadeIn 0.5s ease",
          }}>
            <p style={{ color:"#e2e8f0", fontSize:16, fontWeight:700, lineHeight:1.5, margin:0 }}>{coachMsg}</p>
          </div>
          <div style={{ marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
              <span style={{ fontSize:12, color:"#94a3b8", fontWeight:700 }}>Level {state.level}</span>
              <span style={{ fontSize:12, color:"#a78bfa", fontWeight:700 }}>{state.exp} / {2000} XP</span>
            </div>
            <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:50, height:10, overflow:"hidden" }}>
              <div style={{
                height:"100%", width:`${xpPercent}%`,
                background:"linear-gradient(90deg, #7c3aed, #2563eb, #34d399)",
                borderRadius:50, boxShadow:"0 0 10px rgba(124,58,237,0.6)",
                transition:"width 1s ease",
              }} />
            </div>
          </div>
          <div style={{ fontSize:12, color:"#64748b", fontWeight:600 }}>{2000 - state.exp} XP lagi menuju Level {state.level + 1} 🚀</div>
        </div>
      </div>

      {/* STATS CARDS */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
        {[
          { label:"Gerakan Hari Ini", val:state.totalMoves, unit:"rep",   color:"#22c55e", glow:"rgba(34,197,94,0.3)",    icon:"💪" },
          { label:"Kalori Terbakar",  val:state.totalCalories, unit:"kkal", color:"#f97316", glow:"rgba(249,115,22,0.3)", icon:"🔥" },
          { label:"Total Bintang",    val:state.totalStars, unit:"bintang",color:"#3b82f6", glow:"rgba(59,130,246,0.3)",  icon:"⭐" },
          { label:"Badge Diraih",     val:Object.values(state.badges).filter(b=>b.unlocked).length, unit:"badge", color:"#a855f7", glow:"rgba(168,85,247,0.3)", icon:"🏅" },
        ].map((s, i) => (
          <div key={i} className="stat-card" style={{
            background:`linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))`,
            border:`1px solid ${s.color}33`,
            borderRadius:20, padding:"18px 16px",
            backdropFilter:"blur(10px)",
            boxShadow:`0 4px 24px ${s.glow}`,
            animation:`cardEntrance 0.5s ${i * 0.1}s both ease`,
            cursor:"default",
          }}>
            <div style={{ fontSize:28, marginBottom:8 }}>{s.icon}</div>
            <div style={{ fontSize:26, fontWeight:900, color:s.color, lineHeight:1 }}>{s.val}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.5)", fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>{s.unit}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontWeight:600, marginTop:4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* QUICK FEATURES GRID */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14 }}>
        {[
          { label:"AI Warm Up",   desc:"Pemanasan cerdas",    icon:"🤸", color:"#fb923c", glow:"rgba(251,146,60,0.35)",  screen:"warmup" },
          { label:"Mission Map",  desc:"Petualangan misi",    icon:"🗺️", color:"#3b82f6", glow:"rgba(59,130,246,0.35)", screen:"mission" },
          { label:"Mini Battle",  desc:"Lawan temanmu",       icon:"⚔️", color:"#ef4444", glow:"rgba(239,68,68,0.35)",  screen:"minibattle" },
        ].map((f, i) => (
          <button key={i} className="feature-btn" onClick={() => { AudioSystem.click(); setScreen(f.screen); }} style={{
            background:`linear-gradient(135deg, ${f.color}22, ${f.color}11)`,
            border:`1px solid ${f.color}44`,
            borderRadius:20, padding:"20px 16px",
            display:"flex", flexDirection:"column", alignItems:"flex-start", gap:8,
            cursor:"pointer", textAlign:"left",
            boxShadow:`0 4px 20px ${f.glow}`,
            transition:"all 0.25s cubic-bezier(0.34,1.56,0.64,1)",
          }}>
            <div style={{ fontSize:32 }}>{f.icon}</div>
            <div style={{ fontSize:15, fontWeight:900, color:"#fff" }}>{f.label}</div>
            <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", fontWeight:600 }}>{f.desc}</div>
          </button>
        ))}
      </div>

      {/* PLAY BUTTON */}
      <button
        onClick={onPlay}
        style={{
          width:"100%", padding:"20px",
          background: pressedPlay
            ? "linear-gradient(135deg,#16a34a,#1d4ed8)"
            : "linear-gradient(135deg,#22c55e 0%,#16a34a 40%,#2563eb 100%)",
          border:"none", borderRadius:24, cursor:"pointer",
          fontSize:22, fontWeight:900, color:"#fff",
          letterSpacing:2, textTransform:"uppercase",
          boxShadow: pressedPlay ? "0 2px 10px rgba(34,197,94,0.3)" : "0 8px 40px rgba(34,197,94,0.5), 0 4px 12px rgba(37,99,235,0.3)",
          transform: pressedPlay ? "scale(0.97)" : "scale(1)",
          transition:"all 0.15s ease",
          animation:"playPulse 2.5s ease-in-out infinite",
          display:"flex", alignItems:"center", justifyContent:"center", gap:12,
          fontFamily:"'Nunito', sans-serif",
        }}>
        <span style={{ fontSize:28 }}>▶</span>
        MULAI BERMAIN SEKARANG!
        <span style={{ fontSize:28 }}>🚀</span>
      </button>
    </div>
  );
}

// ─── MISSION SCREEN ───────────────────────────────────────────────────────────
function MissionScreen({ state, setLevelStars, addXP, addActivity, tryAwardBadge, triggerConfetti, showToast }) {
  const [selected, setSelected] = useState(null);
  const [activeMission, setActiveMission] = useState(null);
  const [gameState, setGameState] = useState(null);
  const timerRef = useRef(null);

  const startMissionGame = (m) => {
    setActiveMission(m);
    setGameState({ reps:0, score:0, combo:1, timeLeft:30, phase:"countdown", count:3, currentMoveIdx:0 });
    AudioSystem.click();
    let c = 3;
    const cd = setInterval(() => {
      c--;
      AudioSystem.countdown(c === 0 ? 0 : c);
      setGameState(prev => ({ ...prev, count: c }));
      if (c <= 0) {
        clearInterval(cd);
        setGameState(prev => ({ ...prev, phase:"playing" }));
        startTimer();
      }
    }, 900);
  };

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setGameState(prev => {
        if (!prev || prev.phase !== "playing") { clearInterval(timerRef.current); return prev; }
        if (prev.timeLeft <= 1) {
          clearInterval(timerRef.current);
          return { ...prev, timeLeft:0, phase:"result" };
        }
        return { ...prev, timeLeft: prev.timeLeft - 1 };
      });
    }, 1000);
  };

  const doRep = () => {
    if (!gameState || gameState.phase !== "playing" || !activeMission) return;
    AudioSystem.rep();
    setGameState(prev => {
      const newReps = prev.reps + 1;
      const newCombo = newReps % 3 === 0 ? Math.min(5, prev.combo + 1) : prev.combo;
      const pts = 10 * newCombo;
      const newScore = prev.score + pts;
      if (newCombo > prev.combo) AudioSystem.combo();
      if (newReps >= activeMission.target) {
        clearInterval(timerRef.current);
        return { ...prev, reps: newReps, score: newScore, combo: newCombo, phase:"result" };
      }
      const nextMoveIdx = (prev.currentMoveIdx + 1) % activeMission.moves.length;
      return { ...prev, reps: newReps, score: newScore, combo: newCombo, currentMoveIdx: nextMoveIdx };
    });
  };

  useEffect(() => {
    if (gameState?.phase === "result" && activeMission) {
      const completed = gameState.reps >= activeMission.target;
      const stars = completed
        ? (gameState.score >= activeMission.target * 25 ? 3 : gameState.score >= activeMission.target * 15 ? 2 : 1)
        : (gameState.reps > 0 ? 1 : 0);
      setLevelStars(activeMission.id, stars);
      addXP(stars * 15 + Math.floor(gameState.score / 2));
      addActivity({ type:"mission", name: activeMission.name, score: gameState.score, icon: activeMission.icon });
      if (stars === 3) tryAwardBadge("perfect_score");
      if (completed) { triggerConfetti(); AudioSystem.win(); }
      else { AudioSystem.fail(); }
    }
  }, [gameState?.phase]);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  if (activeMission && gameState) {
    return (
      <MiniGameView
        mission={activeMission}
        gameState={gameState}
        onRep={doRep}
        onBack={() => { clearInterval(timerRef.current); setActiveMission(null); setGameState(null); }}
        onReplay={() => startMissionGame(activeMission)}
      />
    );
  }

  return (
    <div style={{ padding:"28px 32px" }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:13, color:"#94a3b8", fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Petualangan</div>
        <div style={{ fontSize:28, fontWeight:900, color:"#fff" }}>Mission Map 🗺️</div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", marginTop:4 }}>
          ⭐ Total Bintang: {state.totalStars} / 15
        </div>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:0, position:"relative" }}>
        {MISSIONS_DATA.map((m, i) => {
          const isLeft = i % 2 === 0;
          const unlocked = i === 0 ? true : (state.levelUnlocked[m.id] ?? false);
          const stars = state.levelStars[m.id] ?? 0;
          const isSelected = selected === m.id;
          return (
            <div key={m.id} style={{ display:"flex", flexDirection:"column", alignItems: isLeft ? "flex-start" : "flex-end", marginBottom:8 }}>
              {i > 0 && (
                <div style={{
                  width:4, height:40, background:`linear-gradient(${MISSIONS_DATA[i-1].color}, ${m.color})`,
                  borderRadius:4, marginLeft: isLeft ? 68 : "auto",
                  marginRight: isLeft ? "auto" : 68,
                  opacity: unlocked ? 1 : 0.3,
                }} />
              )}
              <button
                disabled={!unlocked}
                onClick={() => { if (unlocked) { setSelected(isSelected ? null : m.id); AudioSystem.click(); } }}
                className="mission-node"
                style={{
                  display:"flex", alignItems:"center", gap:16,
                  background:`linear-gradient(135deg, ${m.color}22, ${m.color}11)`,
                  border: isSelected ? `2px solid ${m.color}` : `1px solid ${m.color}44`,
                  borderRadius:24, padding:"14px 20px",
                  cursor: unlocked ? "pointer" : "not-allowed",
                  opacity: unlocked ? 1 : 0.5,
                  boxShadow: isSelected ? `0 0 30px ${m.glow}` : `0 4px 16px ${m.glow}`,
                  width:"85%",
                  transition:"all 0.25s cubic-bezier(0.34,1.56,0.64,1)",
                  transform: isSelected ? "scale(1.03)" : "scale(1)",
                }}>
                <div style={{
                  width:64, height:64, borderRadius:18, flexShrink:0,
                  background:`linear-gradient(135deg, ${m.color}, ${m.color}aa)`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:28, boxShadow:`0 4px 16px ${m.glow}`,
                }}>
                  {unlocked ? m.icon : "🔒"}
                </div>
                <div style={{ flex:1, textAlign:"left" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                    <span style={{ fontSize:16, fontWeight:900, color:"#fff" }}>{m.name}</span>
                    {i === MISSIONS_DATA.length - 1 && <span style={{ fontSize:10, background:"#ef4444", color:"#fff", borderRadius:50, padding:"2px 8px", fontWeight:800 }}>BOSS</span>}
                  </div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", fontWeight:600, marginBottom:6 }}>{m.desc}</div>
                  <div style={{ display:"flex", gap:4 }}>
                    {[0,1,2].map(s => <StarIcon key={s} filled={s < stars} size={16} />)}
                  </div>
                </div>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <div style={{ fontSize:18, fontWeight:900, color:m.color }}>+{m.target * 15}</div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", fontWeight:700 }}>XP</div>
                </div>
              </button>

              {isSelected && (
                <div style={{
                  width:"85%", background:"rgba(255,255,255,0.05)",
                  border:`1px solid ${m.color}33`, borderRadius:20, padding:20, marginTop:8,
                  backdropFilter:"blur(10px)", animation:"expandIn 0.3s ease",
                }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                    <div style={{ fontSize:14, fontWeight:700, color:"rgba(255,255,255,0.7)" }}>Target: {m.target} gerakan</div>
                    <div style={{ fontSize:14, fontWeight:700, color:m.color }}>🎯 Reward: {m.target * 15} XP</div>
                  </div>
                  <div style={{ fontSize:12, color:"rgba(255,255,255,0.5)", marginBottom:12 }}>
                    Gerakan: {m.moves.map(mv => ({ raise_both:"🙌", squat:"🦵", jump:"⬆️", run:"🏃", raise_right:"✋", raise_left:"🤚" })[mv]).join(" → ")}
                  </div>
                  <button
                    onClick={() => { setSelected(null); startMissionGame(m); }}
                    style={{
                      width:"100%", padding:"14px",
                      background:`linear-gradient(135deg, ${m.color}, ${m.color}bb)`,
                      border:"none", borderRadius:14, cursor:"pointer",
                      fontSize:15, fontWeight:900, color:"#fff",
                      boxShadow:`0 4px 20px ${m.glow}`,
                      fontFamily:"'Nunito', sans-serif",
                      transition:"transform 0.2s",
                    }}>
                    ▶ Mulai {m.name}!
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── MINI GAME VIEW ──────────────────────────────────────────────────────────
function MiniGameView({ mission, gameState, onRep, onBack, onReplay }) {
  const MOVE_LABELS = { raise_both:"🙌 Angkat Kedua Tangan!", raise_right:"✋ Angkat Tangan Kanan!", raise_left:"🤚 Angkat Tangan Kiri!", squat:"🦵 Squat!", jump:"⬆️ Lompat!", run:"🏃 Lari di Tempat!" };
  const currentMove = mission.moves[gameState.currentMoveIdx % mission.moves.length];
  const completed = gameState.reps >= mission.target;
  const stars = gameState.phase === "result"
    ? (completed ? (gameState.score >= mission.target * 25 ? 3 : gameState.score >= mission.target * 15 ? 2 : 1) : (gameState.reps > 0 ? 1 : 0))
    : 0;

  // ── Camera integration for MiniGame ──
  const cam = useCameraTracking();
  const [cameraOn, setCameraOn] = useState(false);
  const [aiRep, setAiRep] = useState(false);

  const toggleCamera = async () => {
    if (cameraOn) { cam.stopCamera(); setCameraOn(false); }
    else { await cam.startCamera(); setCameraOn(true); }
  };

  // When camera is on, AI detects the current move and auto-counts reps
  useEffect(() => {
    if (!cameraOn || !cam.poseReady || gameState.phase !== "playing") return;
    cam.startLoop(currentMove, () => {
      setAiRep(true);
      setTimeout(() => setAiRep(false), 400);
      onRep();
    });
  }, [cameraOn, cam.poseReady, gameState.phase, currentMove]);

  if (gameState.phase === "countdown") {
    return (
      <div style={{ padding:"40px 32px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh" }}>
        <div style={{ fontSize:120, fontWeight:900, color:"#a78bfa", animation:"mascotBob 0.5s ease-in-out infinite" }}>
          {gameState.count > 0 ? gameState.count : "GO!"}
        </div>
        <div style={{ fontSize:20, color:"#fff", fontWeight:800, marginTop:24 }}>{mission.icon} {mission.name}</div>
      </div>
    );
  }

  if (gameState.phase === "result") {
    return (
      <div style={{ padding:"28px 32px", display:"flex", flexDirection:"column", alignItems:"center", gap:24, minHeight:"100vh" }}>
        <div style={{ fontSize:80 }}>{completed ? "🎉" : "😅"}</div>
        <div style={{ fontSize:32, fontWeight:900, color:"#fff" }}>{completed ? "Berhasil! 🏆" : "Waktu Habis!"}</div>
        <div style={{ fontSize:24, fontWeight:700, color:"#fbbf24" }}>{[...Array(3)].map((_,i) => i < stars ? "⭐" : "☆").join("")}</div>
        <div style={{ fontSize:48, fontWeight:900, color:"#22c55e" }}>{gameState.score} pts</div>
        <div style={{ display:"flex", gap:14 }}>
          <button onClick={onReplay} style={{ padding:"14px 28px", background:"linear-gradient(135deg,#22c55e,#16a34a)", border:"none", borderRadius:16, color:"#fff", fontWeight:900, fontSize:16, cursor:"pointer", fontFamily:"'Nunito', sans-serif" }}>
            🔄 Main Lagi
          </button>
          <button onClick={onBack} style={{ padding:"14px 28px", background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:16, color:"#fff", fontWeight:800, fontSize:16, cursor:"pointer", fontFamily:"'Nunito', sans-serif" }}>
            🗺️ Kembali
          </button>
        </div>
      </div>
    );
  }

  const MOVE_ICON_MAP = { raise_both:"🙌", squat:"🦵", jump:"⬆️", run:"🏃", raise_right:"✋", raise_left:"🤚" };

  return (
    <div style={{ padding:"28px 32px", display:"flex", flexDirection:"column", gap:20, minHeight:"100vh" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ fontSize:18, fontWeight:900, color:"#fff" }}>{mission.icon} {mission.name}</div>
        <div style={{ display:"flex", gap:8 }}>
          {/* AI Camera toggle button */}
          <button
            onClick={toggleCamera}
            style={{
              background: cameraOn ? "linear-gradient(135deg,#22c55e,#16a34a)" : "rgba(255,255,255,0.08)",
              border: cameraOn ? "none" : "1px solid rgba(255,255,255,0.15)",
              borderRadius:12, padding:"8px 14px", color:"#fff", fontSize:12, fontWeight:800,
              cursor:"pointer", fontFamily:"'Nunito', sans-serif",
              display:"flex", alignItems:"center", gap:6,
            }}>
            📷 {cameraOn ? "AI ON" : "Aktifkan AI"}
          </button>
          <button onClick={onBack} style={{ background:"rgba(255,255,255,0.1)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:12, padding:"8px 16px", color:"#94a3b8", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"'Nunito', sans-serif" }}>← Keluar</button>
        </div>
      </div>

      {/* Camera panel (only when on) */}
      {cameraOn && (
        <CameraView
          videoRef={cam.videoRef}
          canvasRef={cam.canvasRef}
          cameraReady={cam.cameraReady}
          cameraError={cam.cameraError}
          poseDetected={cam.poseDetected}
          poseReady={cam.poseReady}
          height={200}
        />
      )}

      {/* AI rep flash */}
      {aiRep && (
        <div style={{
          background:"linear-gradient(135deg,#22c55e,#16a34a)", borderRadius:14,
          padding:"10px 20px", textAlign:"center", fontSize:16, fontWeight:900, color:"#fff",
          animation:"coachFadeIn 0.2s ease",
        }}>
          🤖 AI Mendeteksi Gerakan! +1 Rep
        </div>
      )}

      {/* Timer + Score */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
        {[
          { label:"Waktu",  val:gameState.timeLeft, icon:"⏱️", color: gameState.timeLeft < 10 ? "#ef4444" : "#22c55e" },
          { label:"Skor",   val:gameState.score,    icon:"⭐",  color:"#fbbf24" },
          { label:"Combo",  val:`x${gameState.combo}`, icon:"🔥", color:"#f97316" },
        ].map((s,i) => (
          <div key={i} style={{
            background:"rgba(255,255,255,0.05)", border:`1px solid ${s.color}33`,
            borderRadius:18, padding:"16px", textAlign:"center",
          }}>
            <div style={{ fontSize:20, marginBottom:4 }}>{s.icon}</div>
            <div style={{ fontSize:28, fontWeight:900, color:s.color }}>{s.val}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontWeight:700 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Current move instruction */}
      <div style={{
        background:`linear-gradient(135deg, ${mission.color}22, ${mission.color}11)`,
        border:`1px solid ${mission.color}44`, borderRadius:24, padding:"28px 24px", textAlign:"center",
        animation:"coachFadeIn 0.3s ease",
      }}>
        <div style={{ fontSize:48, marginBottom:12 }}>{MOVE_ICON_MAP[currentMove] || "✋"}</div>
        <div style={{ fontSize:22, fontWeight:900, color:"#fff", marginBottom:8 }}>{MOVE_LABELS[currentMove] || currentMove}</div>
        <div style={{ fontSize:14, color:"rgba(255,255,255,0.5)", fontWeight:600 }}>{gameState.reps} / {mission.target} gerakan selesai</div>
        <div style={{ marginTop:16, background:"rgba(255,255,255,0.08)", borderRadius:50, height:10 }}>
          <div style={{ height:"100%", width:`${(gameState.reps/mission.target)*100}%`, background:`linear-gradient(90deg, ${mission.color}, ${mission.color}aa)`, borderRadius:50, transition:"width 0.3s" }} />
        </div>
        {cameraOn && (
          <div style={{ marginTop:10, fontSize:12, color:"#34d399", fontWeight:700 }}>
            📡 Gerakan terdeteksi otomatis via AI Camera
          </div>
        )}
      </div>

      {/* TAP button — manual fallback */}
      {!cameraOn && (
        <button
          onClick={onRep}
          style={{
            width:"100%", padding:"28px",
            background:`linear-gradient(135deg, ${mission.color}, ${mission.color}bb)`,
            border:"none", borderRadius:24, cursor:"pointer",
            fontSize:24, fontWeight:900, color:"#fff",
            boxShadow:`0 8px 40px ${mission.glow}`,
            animation:"playPulse 1.5s ease-in-out infinite",
            fontFamily:"'Nunito', sans-serif",
            transition:"transform 0.1s",
          }}
          onMouseDown={e => e.currentTarget.style.transform = "scale(0.97)"}
          onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
        >
          👆 TAP = 1 Gerakan Selesai!
        </button>
      )}

      <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", textAlign:"center", fontWeight:600 }}>
        {cameraOn ? "AI Camera aktif — lakukan gerakan di depan kamera!" : "Tap tombol di atas setiap kali kamu menyelesaikan satu gerakan"}
      </div>
    </div>
  );
}

// ─── CHALLENGE SCREEN ─────────────────────────────────────────────────────────
function ChallengeScreen({ challenges, triggerConfetti, addXP, addActivity }) {
  const [done, setDone] = useState(challenges.filter(c => c.done).map(c => c.id));
  const [timeStr, setTimeStr] = useState("08:24:15");

  useEffect(() => {
    const t = setInterval(() => {
      setTimeStr(prev => {
        const [h,m,s] = prev.split(":").map(Number);
        let total = h*3600+m*60+s-1;
        if (total < 0) total = 86399;
        return `${String(Math.floor(total/3600)).padStart(2,"0")}:${String(Math.floor((total%3600)/60)).padStart(2,"0")}:${String(total%60).padStart(2,"0")}`;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const [challengeActive, setChallengeActive] = useState(false);
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(1);
  const [currentChallenge, setCurrentChallenge] = useState(null);
  const [timeLeft, setTimeLeft] = useState(5);
  const [feedback, setFeedback] = useState("Siap-siap!");
  const [history, setHistory] = useState([]);
  const [gameOver, setGameOver] = useState(false);
  const timerRef = useRef(null);
  const TOTAL_ROUNDS = 10;

  // Camera for challenge screen
  const cam = useCameraTracking();
  const [cameraOn, setCameraOn] = useState(false);
  const [emotionMsg, setEmotionMsg] = useState("");

  const toggleCamera = async () => {
    if (cameraOn) { cam.stopCamera(); setCameraOn(false); setEmotionMsg(""); }
    else { await cam.startCamera(); setCameraOn(true); }
  };

  // Emotion feedback loop — runs independently of game
  useEffect(() => {
    if (!cameraOn || !cam.poseReady) return;
    const emotionInterval = setInterval(() => {
      if (cam.lastAngles) {
        const emotion = EmotionDetector.detect(cam.lastAngles);
        setEmotionMsg(EmotionDetector.getMessage(emotion));
      }
    }, 3000);
    return () => clearInterval(emotionInterval);
  }, [cameraOn, cam.poseReady, cam.lastAngles]);

  // Auto-detect gesture for current challenge
  useEffect(() => {
    if (!cameraOn || !cam.poseReady || !challengeActive || !currentChallenge || gameOver) return;
    cam.startLoop(currentChallenge.move, () => handleCorrect());
  }, [cameraOn, cam.poseReady, challengeActive, currentChallenge?.move, gameOver]);

  const startMotionChallenge = () => {
    setScore(0); setCombo(1); setRound(0); setHistory([]); setGameOver(false);
    setChallengeActive(true);
    AudioSystem.click();
    nextRound(0, 0, 1, []);
  };

  const nextRound = (currentRound, currentScore, currentCombo, currentHistory) => {
    const nr = currentRound + 1;
    if (nr > TOTAL_ROUNDS) { endGame(currentScore, currentHistory); return; }
    const c = MOTION_CHALLENGES[Math.floor(Math.random() * MOTION_CHALLENGES.length)];
    setRound(nr);
    setCurrentChallenge(c);
    setTimeLeft(5);
    setFeedback("Siap?");
    AudioSystem.countdown(3);

    let tl = 5;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      tl--;
      setTimeLeft(tl);
      AudioSystem.countdown(tl);
      if (tl <= 0) {
        clearInterval(timerRef.current);
        setCombo(1);
        setFeedback("😢 Waktu habis!");
        setHistory(prev => [{ challenge: c, correct: false }, ...prev].slice(0, 8));
        setTimeout(() => nextRound(nr, currentScore, 1, [{ challenge: c, correct: false }, ...currentHistory].slice(0, 8)), 1200);
      }
    }, 1000);
  };

  const handleCorrect = useCallback(() => {
    if (!currentChallenge || gameOver) return;
    clearInterval(timerRef.current);
    const pts = Math.max(10, timeLeft * 20) * combo;
    const newScore = score + pts;
    const newCombo = combo + 1;
    const newHistory = [{ challenge: currentChallenge, correct: true }, ...history].slice(0, 8);
    setScore(newScore);
    setCombo(newCombo);
    setHistory(newHistory);
    setFeedback(newCombo > 3 ? `🔥 COMBO x${newCombo}! +${pts}pts!` : `✅ Bagus! +${pts}pts!`);
    if (newCombo > 3) AudioSystem.combo(); else AudioSystem.rep();
    triggerConfetti();
    setTimeout(() => nextRound(round, newScore, newCombo, newHistory), 900);
  }, [currentChallenge, gameOver, timeLeft, combo, score, history, round]);

  const endGame = (finalScore, finalHistory) => {
    clearInterval(timerRef.current);
    setGameOver(true);
    setFeedback(`🎉 Selesai! Skor: ${finalScore}`);
    addXP(Math.floor(finalScore / 10));
    addActivity({ type:"challenge", name:"Motion Challenge", score: finalScore, icon:"⚡" });
    AudioSystem.win();
    triggerConfetti();
  };

  const timerRatio = timeLeft / 5;
  const timerColor = timerRatio > 0.5 ? "#4ade80" : timerRatio > 0.25 ? "#eab308" : "#ef4444";

  return (
    <div style={{ padding:"28px 32px" }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:13, color:"#94a3b8", fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Harian</div>
        <div style={{ fontSize:28, fontWeight:900, color:"#fff" }}>Daily Challenges ⚡</div>
      </div>

      {/* Timer banner */}
      <div style={{
        background:"linear-gradient(135deg, rgba(239,68,68,0.2), rgba(249,115,22,0.1))",
        border:"1px solid rgba(239,68,68,0.3)", borderRadius:20, padding:"14px 20px",
        display:"flex", alignItems:"center", gap:12, marginBottom:24,
      }}>
        <span style={{ fontSize:24 }}>⏰</span>
        <div>
          <div style={{ fontSize:14, fontWeight:900, color:"#fca5a5" }}>Reset dalam {timeStr}</div>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontWeight:600 }}>Selesaikan sebelum waktu habis!</div>
        </div>
      </div>

      {/* Daily challenges list */}
      <div style={{ display:"flex", flexDirection:"column", gap:16, marginBottom:32 }}>
        {challenges.map((c, i) => {
          const isDone = done.includes(c.id);
          return (
            <div key={c.id} className="challenge-card" style={{
              background:`linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))`,
              border:`1px solid ${isDone ? c.color + "66" : c.color + "22"}`,
              borderRadius:24, padding:"20px 24px",
              backdropFilter:"blur(10px)",
              boxShadow: isDone ? `0 4px 24px ${c.color}44` : "none",
              animation:`cardEntrance 0.4s ${i * 0.1}s both ease`,
              opacity: isDone ? 1 : 0.85,
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:14 }}>
                <div style={{
                  width:52, height:52, borderRadius:16, flexShrink:0,
                  background:`linear-gradient(135deg, ${c.color}44, ${c.color}22)`,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  fontSize:24, border:`1px solid ${c.color}44`,
                }}>
                  {isDone ? "✅" : c.icon}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:16, fontWeight:900, color:isDone ? "#34d399" : "#fff", marginBottom:2 }}>{c.title}</div>
                  <div style={{ background:`${c.color}22`, border:`1px solid ${c.color}44`, borderRadius:50, padding:"2px 10px", display:"inline-block" }}>
                    <span style={{ fontSize:11, color:c.color, fontWeight:800 }}>{c.reward}</span>
                  </div>
                </div>
                {!isDone && (
                  <button
                    onClick={() => { setDone(d => [...d, c.id]); addXP(30); triggerConfetti(); AudioSystem.success(); }}
                    style={{
                      padding:"8px 16px", borderRadius:12, border:"none",
                      background:`linear-gradient(135deg, ${c.color}, ${c.color}aa)`,
                      color:"#fff", fontWeight:800, fontSize:12, cursor:"pointer",
                      fontFamily:"'Nunito', sans-serif",
                      boxShadow:`0 4px 12px ${c.color}44`,
                    }}>KLAIM</button>
                )}
              </div>
              <div>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                  <span style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontWeight:700 }}>Progress</span>
                  <span style={{ fontSize:11, color:c.color, fontWeight:800 }}>{isDone ? 100 : c.progress}%</span>
                </div>
                <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:50, height:8, overflow:"hidden" }}>
                  <div style={{
                    height:"100%", width:`${isDone ? 100 : c.progress}%`,
                    background:`linear-gradient(90deg, ${c.color}, ${c.color}aa)`,
                    borderRadius:50, transition:"width 1s ease",
                    boxShadow:`0 0 8px ${c.color}66`,
                  }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── MOTION CHALLENGE MINI GAME ── */}
      <div style={{
        background:"linear-gradient(135deg, rgba(124,58,237,0.25), rgba(37,99,235,0.15))",
        border:"1px solid rgba(167,139,250,0.3)", borderRadius:24, padding:"24px",
        position:"relative", overflow:"hidden",
      }}>
        <div style={{ position:"absolute", top:-30, right:-30, width:120, height:120, borderRadius:"50%", background:"radial-gradient(rgba(124,58,237,0.3), transparent)" }} />
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
          <div>
            <div style={{ fontSize:13, color:"#a78bfa", fontWeight:800, letterSpacing:1, textTransform:"uppercase" }}>⚡ MOTION CHALLENGE</div>
            <div style={{ fontSize:20, fontWeight:900, color:"#fff", marginTop:4 }}>Tebak Gerakan!</div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", marginTop:2 }}>10 ronde, ikuti perintah gerakan sebelum waktu habis!</div>
          </div>
          {/* Camera toggle for challenge */}
          <button
            onClick={toggleCamera}
            style={{
              background: cameraOn ? "linear-gradient(135deg,#22c55e,#16a34a)" : "rgba(255,255,255,0.08)",
              border: cameraOn ? "none" : "1px solid rgba(255,255,255,0.15)",
              borderRadius:12, padding:"8px 14px", color:"#fff", fontSize:11, fontWeight:800,
              cursor:"pointer", fontFamily:"'Nunito', sans-serif",
              display:"flex", alignItems:"center", gap:6, flexShrink:0,
            }}>
            📷 {cameraOn ? "AI ON" : "AI Camera"}
          </button>
        </div>

        {/* Camera panel */}
        {cameraOn && (
          <div style={{ marginBottom:16 }}>
            <CameraView
              videoRef={cam.videoRef}
              canvasRef={cam.canvasRef}
              cameraReady={cam.cameraReady}
              cameraError={cam.cameraError}
              poseDetected={cam.poseDetected}
              poseReady={cam.poseReady}
              height={160}
            />
            {emotionMsg && (
              <div style={{
                background:"rgba(124,58,237,0.2)", border:"1px solid rgba(167,139,250,0.3)",
                borderRadius:10, padding:"8px 14px", marginTop:8,
                fontSize:12, color:"#c4b5fd", fontWeight:700, textAlign:"center",
              }}>
                🤖 AI Coach: {emotionMsg}
              </div>
            )}
          </div>
        )}

        {!challengeActive ? (
          <button
            onClick={startMotionChallenge}
            style={{ padding:"14px 28px", background:"linear-gradient(135deg,#7c3aed,#2563eb)", border:"none", borderRadius:16, color:"#fff", fontWeight:900, fontSize:16, cursor:"pointer", fontFamily:"'Nunito', sans-serif" }}>
            ▶ Mulai Motion Challenge
          </button>
        ) : (
          <div>
            <div style={{ display:"flex", gap:12, marginBottom:16 }}>
              {[
                { l:"Ronde", v:`${round}/${TOTAL_ROUNDS}`, c:"#a78bfa" },
                { l:"Skor",  v:score,                      c:"#fbbf24" },
                { l:"Combo", v:`x${combo}`,                c:"#f97316" },
              ].map((s,i) => (
                <div key={i} style={{ flex:1, background:"rgba(255,255,255,0.05)", borderRadius:14, padding:"10px", textAlign:"center" }}>
                  <div style={{ fontSize:18, fontWeight:900, color:s.c }}>{s.v}</div>
                  <div style={{ fontSize:10, color:"rgba(255,255,255,0.4)", fontWeight:700 }}>{s.l}</div>
                </div>
              ))}
            </div>

            {gameOver ? (
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:24, fontWeight:900, color:"#fff", marginBottom:8 }}>🎉 Selesai! Skor: {score}</div>
                <button onClick={startMotionChallenge} style={{ padding:"12px 24px", background:"linear-gradient(135deg,#7c3aed,#2563eb)", border:"none", borderRadius:14, color:"#fff", fontWeight:900, fontSize:15, cursor:"pointer", fontFamily:"'Nunito', sans-serif" }}>
                  🔄 Main Lagi
                </button>
              </div>
            ) : currentChallenge && (
              <div>
                <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:16 }}>
                  <svg width="80" height="80" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
                    <circle cx="40" cy="40" r="34" fill="none" stroke={timerColor} strokeWidth="8"
                      strokeDasharray={`${2*Math.PI*34}`}
                      strokeDashoffset={`${2*Math.PI*34*(1-timerRatio)}`}
                      strokeLinecap="round" transform="rotate(-90 40 40)"
                      style={{ transition:"stroke-dashoffset 0.3s, stroke 0.3s" }} />
                    <text x="40" y="46" textAnchor="middle" fill={timerColor} fontSize="22" fontWeight="900">{timeLeft}</text>
                  </svg>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:20, fontWeight:900, color:"#fff", marginBottom:4 }}>{currentChallenge.text}</div>
                    <div style={{ fontSize:14, color:"rgba(255,255,255,0.5)" }}>{feedback}</div>
                    {cameraOn && <div style={{ fontSize:11, color:"#34d399", fontWeight:700, marginTop:4 }}>📡 AI mendeteksi gerakan otomatis</div>}
                  </div>
                </div>
                {!cameraOn && (
                  <button onClick={handleCorrect} style={{
                    width:"100%", padding:"18px", background:"linear-gradient(135deg,#22c55e,#16a34a)",
                    border:"none", borderRadius:16, color:"#fff", fontWeight:900, fontSize:18, cursor:"pointer",
                    fontFamily:"'Nunito', sans-serif", animation:"playPulse 1s ease-in-out infinite",
                    boxShadow:"0 4px 20px rgba(34,197,94,0.4)",
                  }}>
                    {currentChallenge.icon} Saya Sudah Lakukan!
                  </button>
                )}
                {history.length > 0 && (
                  <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:4 }}>
                    {history.slice(0,4).map((h,i) => (
                      <div key={i} style={{ display:"flex", alignItems:"center", gap:8, fontSize:11, color: h.correct ? "#34d399" : "#f87171", fontWeight:700 }}>
                        {h.correct ? "✅" : "❌"} {h.challenge.icon} {h.challenge.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Weekly boss */}
      <div style={{
        marginTop:24, background:"linear-gradient(135deg, rgba(124,58,237,0.25), rgba(37,99,235,0.15))",
        border:"1px solid rgba(167,139,250,0.3)", borderRadius:24, padding:"24px",
        position:"relative", overflow:"hidden",
      }}>
        <div style={{ fontSize:13, color:"#a78bfa", fontWeight:800, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>🌟 WEEKLY BOSS</div>
        <div style={{ fontSize:20, fontWeight:900, color:"#fff", marginBottom:8 }}>100 Gerakan Minggu Ini</div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", fontWeight:600, marginBottom:16 }}>Selesaikan untuk dapat badge eksklusif Diamond!</div>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
          <span style={{ fontSize:12, color:"rgba(255,255,255,0.5)", fontWeight:700 }}>48 / 100</span>
          <span style={{ fontSize:12, color:"#a78bfa", fontWeight:800 }}>48%</span>
        </div>
        <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:50, height:12, overflow:"hidden" }}>
          <div style={{ height:"100%", width:"48%", background:"linear-gradient(90deg, #7c3aed, #2563eb)", borderRadius:50, boxShadow:"0 0 12px rgba(124,58,237,0.6)" }} />
        </div>
      </div>
    </div>
  );
}

// ─── WARMUP SCREEN — with MediaPipe Camera Integration ────────────────────────
function WarmupScreen({ state, setState, addXP, addActivity, tryAwardBadge, triggerConfetti, showToast }) {
  const [phase, setPhase] = useState("idle");
  const [countdown, setCountdown] = useState(3);
  const [moveIdx, setMoveIdx] = useState(0);
  const [reps, setReps] = useState(0);
  const [energy, setEnergy] = useState(0);
  const [feedback, setFeedback] = useState("Tekan tombol untuk mulai pemanasan!");
  const timerRef = useRef(null);
  const phaseRef = useRef("idle");
  phaseRef.current = phase;

  // Camera tracking
  const cam = useCameraTracking();
  const [cameraOn, setCameraOn] = useState(false);
  const [emotionMsg, setEmotionMsg] = useState("");
  const moveIdxRef = useRef(0);
  moveIdxRef.current = moveIdx;

  const toggleCamera = async () => {
    if (cameraOn) { cam.stopCamera(); setCameraOn(false); setEmotionMsg(""); }
    else { await cam.startCamera(); setCameraOn(true); }
  };

  // Emotion detection loop
  useEffect(() => {
    if (!cameraOn || !cam.poseReady) return;
    const interval = setInterval(() => {
      if (cam.lastAngles) {
        const emotion = EmotionDetector.detect(cam.lastAngles);
        const msg = EmotionDetector.getMessage(emotion);
        setEmotionMsg(msg);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [cameraOn, cam.poseReady, cam.lastAngles]);

  // AI gesture loop during play
  useEffect(() => {
    if (!cameraOn || !cam.poseReady || phase !== "playing") return;
    const move = WARMUP_MOVES[moveIdxRef.current];
    if (!move) return;
    cam.startLoop(move.id, () => doRep());
  }, [cameraOn, cam.poseReady, phase, moveIdx]);

  const startWarmup = () => {
    setPhase("countdown"); setCountdown(3); setMoveIdx(0); setReps(0); setEnergy(0);
    AudioSystem.click();
    let c = 3;
    const cd = setInterval(() => {
      c--;
      AudioSystem.countdown(c === 0 ? 0 : c);
      setCountdown(c);
      if (c <= 0) { clearInterval(cd); setPhase("playing"); setFeedback(WARMUP_MOVES[0].instruction); }
    }, 900);
  };

  const doRep = useCallback(() => {
    if (phaseRef.current !== "playing") return;
    const move = WARMUP_MOVES[moveIdxRef.current];
    AudioSystem.energy();
    setReps(prev => {
      const newReps = prev + 1;
      const totalTarget = WARMUP_MOVES.reduce((a, m) => a + m.reps, 0);
      setEnergy(e => Math.min(100, e + (100 / totalTarget)));
      setFeedback(`${move.icon} Bagus! Rep ke-${newReps}!`);
      if (newReps >= move.reps) {
        const nextIdx = moveIdxRef.current + 1;
        if (nextIdx >= WARMUP_MOVES.length) {
          setPhase("done"); setEnergy(100);
          AudioSystem.win(); triggerConfetti();
          addXP(20);
          addActivity({ type:"warmup", name:"AI Warm-Up", score:100, icon:"🔥" });
          const warmupCount = (state.warmupCount || 0) + 1;
          setState(p => ({ ...p, warmupCount, energy: 100 }));
          tryAwardBadge("warmup_complete");
          if (warmupCount >= 5) tryAwardBadge("play_5");
          setFeedback("🎉 Pemanasan selesai! Energy penuh!");
        } else {
          AudioSystem.success();
          setMoveIdx(nextIdx);
          setFeedback(`✅ ${move.name} selesai! Lanjut: ${WARMUP_MOVES[nextIdx].name}`);
          return 0;
        }
      }
      return newReps;
    });
  }, []);

  const currentMove = WARMUP_MOVES[moveIdx];
  const totalTarget = WARMUP_MOVES.reduce((a, m) => a + m.reps, 0);

  return (
    <div style={{ padding:"28px 32px" }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:13, color:"#94a3b8", fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Pemanasan</div>
        <div style={{ fontSize:28, fontWeight:900, color:"#fff" }}>AI Warm Up 🤸</div>
      </div>

      {/* Camera panel */}
      <div style={{ marginBottom:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <div style={{ fontSize:13, color:"#94a3b8", fontWeight:700 }}>📷 AI Camera Tracking</div>
          <button
            onClick={toggleCamera}
            style={{
              background: cameraOn ? "linear-gradient(135deg,#22c55e,#16a34a)" : "rgba(255,255,255,0.08)",
              border: cameraOn ? "none" : "1px solid rgba(255,255,255,0.15)",
              borderRadius:12, padding:"8px 16px", color:"#fff", fontSize:13, fontWeight:800,
              cursor:"pointer", fontFamily:"'Nunito', sans-serif",
              display:"flex", alignItems:"center", gap:8,
            }}>
            {cameraOn ? "📡 AI ON — Klik Nonaktif" : "🎥 Aktifkan Kamera AI"}
          </button>
        </div>
        <CameraView
          videoRef={cam.videoRef}
          canvasRef={cam.canvasRef}
          cameraReady={cam.cameraReady}
          cameraError={cam.cameraError}
          poseDetected={cam.poseDetected}
          poseReady={cam.poseReady}
          height={cameraOn ? 240 : 80}
          style={{ opacity: cameraOn ? 1 : 0.4 }}
        />
        {cameraOn && emotionMsg && (
          <div style={{
            background:"rgba(124,58,237,0.2)", border:"1px solid rgba(167,139,250,0.3)",
            borderRadius:10, padding:"10px 16px", marginTop:10,
            fontSize:13, color:"#c4b5fd", fontWeight:700, textAlign:"center",
            animation:"coachFadeIn 0.4s ease",
          }}>
            🤖 AI Coach: {emotionMsg}
          </div>
        )}
      </div>

      {/* Energy bar */}
      <div style={{
        background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)",
        borderRadius:20, padding:"20px 24px", marginBottom:20,
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
          <span style={{ fontSize:14, fontWeight:800, color:"#fb923c" }}>⚡ Energy</span>
          <span style={{ fontSize:16, fontWeight:900, color:"#fb923c" }}>{Math.round(energy)}%</span>
        </div>
        <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:50, height:16, overflow:"hidden" }}>
          <div style={{
            height:"100%", width:`${energy}%`,
            background:"linear-gradient(90deg, #fb923c, #ef4444)",
            borderRadius:50, transition:"width 0.5s ease",
            boxShadow:"0 0 12px rgba(251,146,60,0.5)",
          }} />
        </div>
      </div>

      {/* Move list */}
      <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:24 }}>
        {WARMUP_MOVES.map((m, i) => {
          let status = "pending";
          if (i < moveIdx) status = "done";
          if (i === moveIdx && phase === "playing") status = "active";
          return (
            <div key={m.id} style={{
              display:"flex", alignItems:"center", gap:14, padding:"14px 20px",
              background: status === "active" ? `rgba(251,146,60,0.15)` : status === "done" ? "rgba(34,197,94,0.1)" : "rgba(255,255,255,0.04)",
              border: status === "active" ? "1px solid rgba(251,146,60,0.4)" : status === "done" ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(255,255,255,0.06)",
              borderRadius:16, transition:"all 0.3s ease",
            }}>
              <div style={{ fontSize:28, width:40, textAlign:"center" }}>
                {status === "done" ? "✅" : status === "active" ? "👉" : m.icon}
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:800, color: status === "done" ? "#34d399" : status === "active" ? "#fb923c" : "#94a3b8" }}>{m.name}</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontWeight:600 }}>{m.reps}x gerakan</div>
              </div>
              {status === "active" && (
                <div style={{ fontSize:20, fontWeight:900, color:"#fb923c" }}>{reps}/{m.reps}</div>
              )}
              {status === "done" && (
                <div style={{ fontSize:13, color:"#34d399", fontWeight:800 }}>Selesai!</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Feedback */}
      <div style={{
        background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)",
        borderRadius:18, padding:"16px 20px", marginBottom:20, textAlign:"center",
        animation:"coachFadeIn 0.5s ease",
      }}>
        <p style={{ color:"#e2e8f0", fontSize:16, fontWeight:700, lineHeight:1.5, margin:0 }}>{feedback}</p>
        {cameraOn && phase === "playing" && (
          <p style={{ color:"#34d399", fontSize:12, fontWeight:700, marginTop:6, marginBottom:0 }}>
            📡 MediaPipe mendeteksi gerakan secara otomatis
          </p>
        )}
      </div>

      {/* Countdown overlay */}
      {phase === "countdown" && (
        <div style={{ textAlign:"center", marginBottom:20 }}>
          <div style={{ fontSize:80, fontWeight:900, color:"#a78bfa", animation:"mascotBob 0.5s ease-in-out infinite" }}>
            {countdown > 0 ? countdown : "GO!"}
          </div>
        </div>
      )}

      {/* Action button */}
      {phase === "idle" && (
        <button onClick={startWarmup} style={{
          width:"100%", padding:"20px", background:"linear-gradient(135deg,#fb923c,#ef4444)",
          border:"none", borderRadius:20, color:"#fff", fontWeight:900, fontSize:20,
          cursor:"pointer", fontFamily:"'Nunito', sans-serif", boxShadow:"0 8px 32px rgba(251,146,60,0.4)",
          animation:"playPulse 2s ease-in-out infinite",
        }}>
          🔥 Mulai Pemanasan!
        </button>
      )}
      {phase === "playing" && !cameraOn && (
        <button onClick={doRep} style={{
          width:"100%", padding:"24px",
          background:`linear-gradient(135deg, #fb923c, #ef4444)`,
          border:"none", borderRadius:20, color:"#fff", fontWeight:900, fontSize:22,
          cursor:"pointer", fontFamily:"'Nunito', sans-serif",
          boxShadow:"0 8px 32px rgba(251,146,60,0.5)",
          animation:"playPulse 1.5s ease-in-out infinite",
          transition:"transform 0.1s",
        }}
          onMouseDown={e => e.currentTarget.style.transform = "scale(0.97)"}
          onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
        >
          👆 TAP = 1 {currentMove?.name}!
        </button>
      )}
      {phase === "playing" && cameraOn && (
        <div style={{
          background:"linear-gradient(135deg,rgba(34,197,94,0.15),rgba(16,185,129,0.1))",
          border:"1px solid rgba(34,197,94,0.3)", borderRadius:20, padding:"18px",
          textAlign:"center", fontSize:16, fontWeight:800, color:"#34d399",
        }}>
          📡 AI Camera Aktif — Lakukan gerakan di depan kamera!
        </div>
      )}
      {phase === "done" && (
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:60, marginBottom:12 }}>🎉</div>
          <div style={{ fontSize:24, fontWeight:900, color:"#34d399", marginBottom:16 }}>Pemanasan Selesai!</div>
          <button onClick={() => { setPhase("idle"); setEnergy(0); setMoveIdx(0); setReps(0); setFeedback("Tekan tombol untuk mulai pemanasan!"); }} style={{
            padding:"14px 32px", background:"linear-gradient(135deg,#fb923c,#ef4444)",
            border:"none", borderRadius:16, color:"#fff", fontWeight:900, fontSize:16,
            cursor:"pointer", fontFamily:"'Nunito', sans-serif",
          }}>
            🔄 Ulangi Pemanasan
          </button>
        </div>
      )}
    </div>
  );
}

// ─── MINI BATTLE SCREEN ───────────────────────────────────────────────────────
const RELAY_CHALLENGES = [
  { text:"Angkat kedua tangan 3x!", move:"raise_both", target:3, icon:"🙌" },
  { text:"Squat 3x!",               move:"squat",      target:3, icon:"🦵" },
  { text:"Lompat 3x!",              move:"jump",       target:3, icon:"⬆️" },
  { text:"Lari 5 langkah!",         move:"run",        target:5, icon:"🏃" },
  { text:"Tangan kanan 3x!",        move:"raise_right",target:3, icon:"✋" },
];

function MiniBattleScreen({ state, setState, addActivity, tryAwardBadge, triggerConfetti, showToast }) {
  const [phase, setPhase] = useState("idle");
  const [redScore, setRedScore] = useState(0);
  const [blueScore, setBlueScore] = useState(0);
  const [activeTeam, setActiveTeam] = useState("red");
  const [round, setRound] = useState(0);
  const [timeLeft, setTimeLeft] = useState(12);
  const [reps, setReps] = useState(0);
  const [currentChallenge, setCurrentChallenge] = useState(null);
  const [winner, setWinner] = useState(null);
  const timerRef = useRef(null);
  const MAX_ROUNDS = 5;

  // Camera for battle screen
  const cam = useCameraTracking();
  const [cameraOn, setCameraOn] = useState(false);
  const activeTeamRef = useRef("red");
  activeTeamRef.current = activeTeam;
  const roundRef = useRef(0);
  roundRef.current = round;

  const toggleCamera = async () => {
    if (cameraOn) { cam.stopCamera(); setCameraOn(false); }
    else { await cam.startCamera(); setCameraOn(true); }
  };

  // AI gesture detection for relay
  useEffect(() => {
    if (!cameraOn || !cam.poseReady || phase !== "playing" || !currentChallenge) return;
    cam.startLoop(currentChallenge.move, () => doRep());
  }, [cameraOn, cam.poseReady, phase, currentChallenge?.move]);

  const startRelay = () => {
    setRedScore(0); setBlueScore(0); setActiveTeam("red"); setRound(0);
    setWinner(null); setPhase("playing"); AudioSystem.click();
    nextRound(0, 0, 0, "red");
  };

  const nextRound = (currentRound, currentRed, currentBlue, team) => {
    const nr = currentRound + 1;
    if (nr > MAX_ROUNDS) { endRelay(currentRed, currentBlue); return; }
    const c = RELAY_CHALLENGES[Math.floor(Math.random() * RELAY_CHALLENGES.length)];
    setRound(nr); setReps(0); setCurrentChallenge(c); setTimeLeft(12);
    clearInterval(timerRef.current);
    let tl = 12;
    timerRef.current = setInterval(() => {
      tl--;
      setTimeLeft(tl);
      if (tl <= 0) {
        clearInterval(timerRef.current);
        const nextTeam = team === "red" ? "blue" : "red";
        setActiveTeam(nextTeam);
        setTimeout(() => nextRound(nr, currentRed, currentBlue, nextTeam), 800);
      }
    }, 1000);
  };

  const doRep = useCallback(() => {
    if (phase !== "playing" || !currentChallenge) return;
    AudioSystem.energy();
    setReps(prev => {
      const newReps = prev + 1;
      if (newReps >= currentChallenge.target) {
        clearInterval(timerRef.current);
        const pts = Math.max(10, timeLeft * 5);
        if (activeTeamRef.current === "red") setRedScore(r => { const nv = r + pts; return nv; });
        else setBlueScore(b => { const nv = b + pts; return nv; });
        AudioSystem.rep(); triggerConfetti();
        const nextTeam = activeTeamRef.current === "red" ? "blue" : "red";
        setActiveTeam(nextTeam);
        setTimeout(() => nextRound(roundRef.current, redScore, blueScore, nextTeam), 1200);
      }
      return newReps;
    });
  }, [phase, currentChallenge, timeLeft, redScore, blueScore]);

  const endRelay = (finalRed, finalBlue) => {
    clearInterval(timerRef.current);
    setPhase("result");
    let w = finalRed > finalBlue ? "red" : finalBlue > finalRed ? "blue" : "draw";
    setWinner(w);
    AudioSystem.win(); triggerConfetti();
    addActivity({ type:"relay", name:"Estafet Tim", score: Math.max(finalRed, finalBlue), icon:"👥" });
    if (w !== "draw") tryAwardBadge("relay_win");
    if (w === "red") setState(prev => ({ ...prev, redTeamWins: (prev.redTeamWins||0)+1 }));
    else if (w === "blue") setState(prev => ({ ...prev, blueTeamWins: (prev.blueTeamWins||0)+1 }));
  };

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const teamColor = activeTeam === "red" ? "#ef4444" : "#3b82f6";
  const teamName = activeTeam === "red" ? "🔴 Tim Merah" : "🔵 Tim Biru";

  return (
    <div style={{ padding:"28px 32px" }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:13, color:"#94a3b8", fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Multiplayer</div>
        <div style={{ fontSize:28, fontWeight:900, color:"#fff" }}>Mini Battle ⚔️</div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.4)", marginTop:4 }}>
          🔴 {state.redTeamWins||0} menang vs 🔵 {state.blueTeamWins||0} menang (all-time)
        </div>
      </div>

      {/* Scoreboard */}
      <div style={{
        background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)",
        borderRadius:24, padding:"20px", marginBottom:20,
        display:"grid", gridTemplateColumns:"1fr auto 1fr", gap:12, alignItems:"center",
      }}>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:40, marginBottom:4 }}>🔴</div>
          <div style={{ fontSize:32, fontWeight:900, color:"#ef4444" }}>{redScore}</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", fontWeight:700 }}>TIM MERAH</div>
        </div>
        <div style={{ fontSize:20, fontWeight:900, color:"rgba(255,255,255,0.3)" }}>VS</div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:40, marginBottom:4 }}>🔵</div>
          <div style={{ fontSize:32, fontWeight:900, color:"#3b82f6" }}>{blueScore}</div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", fontWeight:700 }}>TIM BIRU</div>
        </div>
      </div>

      {phase !== "idle" && (
        <div style={{ marginBottom:20 }}>
          <div style={{ display:"flex", height:12, borderRadius:50, overflow:"hidden", marginBottom:8 }}>
            <div style={{ background:"#ef4444", width:`${redScore/(redScore+blueScore+1)*100}%`, transition:"width 0.5s" }} />
            <div style={{ flex:1, background:"#3b82f6", transition:"width 0.5s" }} />
          </div>
          <div style={{ fontSize:12, color:"rgba(255,255,255,0.4)", textAlign:"center" }}>Ronde {round}/{MAX_ROUNDS}</div>
        </div>
      )}

      {/* Camera toggle for battle */}
      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:16 }}>
        <button
          onClick={toggleCamera}
          style={{
            background: cameraOn ? "linear-gradient(135deg,#22c55e,#16a34a)" : "rgba(255,255,255,0.08)",
            border: cameraOn ? "none" : "1px solid rgba(255,255,255,0.15)",
            borderRadius:12, padding:"8px 16px", color:"#fff", fontSize:13, fontWeight:800,
            cursor:"pointer", fontFamily:"'Nunito', sans-serif",
            display:"flex", alignItems:"center", gap:8,
          }}>
          📷 {cameraOn ? "AI Tracking ON" : "Aktifkan AI Camera"}
        </button>
      </div>

      {/* Camera panel for battle */}
      {cameraOn && (
        <div style={{ marginBottom:16 }}>
          <CameraView
            videoRef={cam.videoRef}
            canvasRef={cam.canvasRef}
            cameraReady={cam.cameraReady}
            cameraError={cam.cameraError}
            poseDetected={cam.poseDetected}
            poseReady={cam.poseReady}
            height={180}
          />
        </div>
      )}

      {phase === "idle" && (
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ fontSize:16, color:"rgba(255,255,255,0.6)", fontWeight:700, marginBottom:20 }}>
            Dua pemain bergiliran melakukan gerakan! Tim yang paling banyak poin menang!
          </div>
          <button onClick={startRelay} style={{
            padding:"18px 40px", background:"linear-gradient(135deg,#ef4444,#b91c1c)",
            border:"none", borderRadius:20, color:"#fff", fontWeight:900, fontSize:20,
            cursor:"pointer", fontFamily:"'Nunito', sans-serif",
            boxShadow:"0 8px 32px rgba(239,68,68,0.4)", animation:"playPulse 2s ease-in-out infinite",
          }}>
            ⚔️ Mulai Pertandingan!
          </button>
        </div>
      )}

      {phase === "playing" && currentChallenge && (
        <div>
          <div style={{
            background:`${teamColor}22`, border:`1px solid ${teamColor}44`,
            borderRadius:14, padding:"10px 20px", display:"inline-flex", alignItems:"center", gap:8, marginBottom:16,
          }}>
            <div style={{ width:12, height:12, borderRadius:"50%", background:teamColor, animation:"pulse 1s ease-in-out infinite" }} />
            <span style={{ fontSize:14, fontWeight:900, color:teamColor }}>{teamName} Giliran!</span>
          </div>

          <div style={{
            background:`linear-gradient(135deg, ${teamColor}22, ${teamColor}11)`,
            border:`1px solid ${teamColor}44`, borderRadius:24, padding:"24px", marginBottom:16, textAlign:"center",
          }}>
            <div style={{ fontSize:48, marginBottom:8 }}>{currentChallenge.icon}</div>
            <div style={{ fontSize:22, fontWeight:900, color:"#fff", marginBottom:8 }}>{currentChallenge.text}</div>
            <div style={{ fontSize:16, color:teamColor, fontWeight:800 }}>
              {reps}/{currentChallenge.target} selesai
            </div>
            <div style={{ marginTop:12, background:"rgba(255,255,255,0.08)", borderRadius:50, height:10 }}>
              <div style={{ height:"100%", width:`${(reps/currentChallenge.target)*100}%`, background:`linear-gradient(90deg, ${teamColor}, ${teamColor}aa)`, borderRadius:50, transition:"width 0.3s" }} />
            </div>
            <div style={{ marginTop:12, fontSize:24, fontWeight:900, color: timeLeft <= 5 ? "#ef4444" : "#fbbf24" }}>⏱️ {timeLeft}s</div>
            {cameraOn && <div style={{ marginTop:8, fontSize:12, color:"#34d399", fontWeight:700 }}>📡 AI mendeteksi gerakan otomatis</div>}
          </div>

          {!cameraOn && (
            <button onClick={doRep} style={{
              width:"100%", padding:"22px",
              background:`linear-gradient(135deg, ${teamColor}, ${teamColor}bb)`,
              border:"none", borderRadius:20, color:"#fff", fontWeight:900, fontSize:22,
              cursor:"pointer", fontFamily:"'Nunito', sans-serif",
              boxShadow:`0 8px 32px ${teamColor}44`, animation:"playPulse 1.5s ease-in-out infinite",
            }}
              onMouseDown={e => e.currentTarget.style.transform="scale(0.97)"}
              onMouseUp={e => e.currentTarget.style.transform="scale(1)"}
            >
              {currentChallenge.icon} TAP = 1 Gerakan!
            </button>
          )}
        </div>
      )}

      {phase === "result" && (
        <div style={{ textAlign:"center", padding:"32px 0" }}>
          <div style={{ fontSize:80, marginBottom:16 }}>{winner === "draw" ? "🤝" : "🏆"}</div>
          <div style={{ fontSize:28, fontWeight:900, color: winner === "red" ? "#ef4444" : winner === "blue" ? "#3b82f6" : "#fbbf24", marginBottom:8 }}>
            {winner === "red" ? "🔴 TIM MERAH MENANG!" : winner === "blue" ? "🔵 TIM BIRU MENANG!" : "🤝 SERI!"}
          </div>
          <div style={{ fontSize:16, color:"rgba(255,255,255,0.5)", marginBottom:24 }}>
            Merah: {redScore} pts | Biru: {blueScore} pts
          </div>
          <button onClick={() => { setPhase("idle"); setRedScore(0); setBlueScore(0); setRound(0); setWinner(null); }} style={{
            padding:"14px 32px", background:"linear-gradient(135deg,#ef4444,#b91c1c)",
            border:"none", borderRadius:16, color:"#fff", fontWeight:900, fontSize:16,
            cursor:"pointer", fontFamily:"'Nunito', sans-serif",
          }}>
            🔄 Main Lagi
          </button>
        </div>
      )}
    </div>
  );
}

// ─── BADGES SCREEN ────────────────────────────────────────────────────────────
function BadgesScreen({ state, triggerConfetti }) {
  const [selected, setSelected] = useState(null);
  const allBadges = BADGE_DEFS.map(b => ({
    ...b,
    owned: state.badges[b.id]?.unlocked ?? false,
    date: state.badges[b.id]?.date,
  }));

  return (
    <div style={{ padding:"28px 32px" }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:13, color:"#94a3b8", fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Koleksi</div>
        <div style={{ fontSize:28, fontWeight:900, color:"#fff" }}>Badge Collection 🏅</div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:24 }}>
        {allBadges.map((b, i) => (
          <div key={b.id} className="badge-card" style={{
            background: b.owned
              ? "linear-gradient(135deg, rgba(251,191,36,0.2), rgba(245,158,11,0.1))"
              : "rgba(255,255,255,0.04)",
            border: b.owned ? "1px solid rgba(251,191,36,0.4)" : "1px solid rgba(255,255,255,0.06)",
            borderRadius:20, padding:"20px 12px",
            display:"flex", flexDirection:"column", alignItems:"center", gap:8,
            textAlign:"center", cursor:"pointer",
            boxShadow: b.owned ? "0 4px 24px rgba(251,191,36,0.2)" : "none",
            animation:`cardEntrance 0.4s ${i * 0.06}s both ease`,
            transition:"all 0.25s cubic-bezier(0.34,1.56,0.64,1)",
          }}
          onClick={() => { setSelected(b.id === selected ? null : b.id); if (b.owned) triggerConfetti(); }}>
            <div style={{
              width:60, height:60, borderRadius:"50%",
              background: b.owned ? "linear-gradient(135deg, #fbbf24, #f59e0b)" : "rgba(255,255,255,0.06)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:28,
              boxShadow: b.owned ? "0 4px 20px rgba(251,191,36,0.4)" : "none",
              filter: b.owned ? "none" : "grayscale(1) opacity(0.3)",
              animation: b.owned ? "badgeShimmer 3s ease-in-out infinite" : "none",
            }}>
              {b.icon}
            </div>
            <div style={{ fontSize:11, fontWeight:800, color: b.owned ? "#fbbf24" : "#475569" }}>{b.name}</div>
            <div style={{ fontSize:9, fontWeight:700, color: b.owned ? "rgba(251,191,36,0.7)" : "#334155", textTransform:"uppercase", letterSpacing:0.5 }}>
              {b.owned ? "✓ DIRAIH" : "🔒 TERKUNCI"}
            </div>
          </div>
        ))}
      </div>

      {selected && (() => {
        const b = allBadges.find(b => b.id === selected);
        if (!b) return null;
        return (
          <div style={{
            background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)",
            borderRadius:24, padding:"24px", marginBottom:20, animation:"expandIn 0.3s ease",
            display:"flex", gap:20, alignItems:"center",
          }}>
            <div style={{ fontSize:48 }}>{b.icon}</div>
            <div>
              <div style={{ fontSize:18, fontWeight:900, color:"#fff", marginBottom:4 }}>{b.name}</div>
              <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", marginBottom:8 }}>{b.desc}</div>
              {b.owned && b.date && (
                <div style={{ fontSize:12, color:"#fbbf24", fontWeight:700 }}>✅ Didapat: {new Date(b.date).toLocaleDateString("id-ID")}</div>
              )}
              {!b.owned && <div style={{ fontSize:12, color:"#94a3b8", fontWeight:700 }}>🔒 Belum didapat. Selesaikan tantangan untuk membuka!</div>}
            </div>
          </div>
        );
      })()}

      <div style={{
        background:"linear-gradient(135deg, rgba(251,191,36,0.1), rgba(245,158,11,0.05))",
        border:"1px solid rgba(251,191,36,0.2)", borderRadius:24, padding:"20px 24px",
      }}>
        <div style={{ fontSize:14, fontWeight:800, color:"#fbbf24", marginBottom:8 }}>🏆 Progress Koleksi</div>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
          <span style={{ fontSize:13, color:"rgba(255,255,255,0.6)", fontWeight:600 }}>{allBadges.filter(b=>b.owned).length} / {allBadges.length} Badge</span>
          <span style={{ fontSize:13, color:"#fbbf24", fontWeight:800 }}>{Math.round(allBadges.filter(b=>b.owned).length/allBadges.length*100)}%</span>
        </div>
        <div style={{ background:"rgba(255,255,255,0.08)", borderRadius:50, height:10 }}>
          <div style={{ height:"100%", width:`${allBadges.filter(b=>b.owned).length/allBadges.length*100}%`, background:"linear-gradient(90deg,#fbbf24,#f59e0b)", borderRadius:50 }} />
        </div>
      </div>
    </div>
  );
}

// ─── STATS SCREEN ─────────────────────────────────────────────────────────────
function StatsScreen({ state, addActivity }) {
  const days = ["Min","Sen","Sel","Rab","Kam","Jum","Sab"];
  const weekly = state.weeklyActivity || [0,0,0,0,0,0,0];
  const maxR = Math.max(...weekly, 1);

  return (
    <div style={{ padding:"28px 32px" }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:13, color:"#94a3b8", fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Progres</div>
        <div style={{ fontSize:28, fontWeight:900, color:"#fff" }}>Statistik Kamu 📊</div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:24 }}>
        {[
          { label:"Level Saat Ini", val:state.level, color:"#7c3aed", icon:"⚡" },
          { label:"Total XP",       val:state.exp,   color:"#2563eb", icon:"⭐" },
          { label:"Day Streak",     val:state.streak, color:"#ef4444", icon:"🔥" },
        ].map((s, i) => (
          <div key={i} style={{
            background:`linear-gradient(135deg, ${s.color}22, ${s.color}11)`,
            border:`1px solid ${s.color}33`, borderRadius:20, padding:"18px",
            textAlign:"center", animation:`cardEntrance 0.4s ${i*0.1}s both`,
          }}>
            <div style={{ fontSize:24, marginBottom:6 }}>{s.icon}</div>
            <div style={{ fontSize:28, fontWeight:900, color:s.color }}>{s.val}</div>
            <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontWeight:700 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:24 }}>
        {[
          { label:"Total Gerakan", val:state.totalMoves, color:"#22c55e", icon:"💪" },
          { label:"Kalori Dibakar", val:`${state.totalCalories} kkal`, color:"#f97316", icon:"🔥" },
          { label:"Pemanasan Selesai", val:state.warmupCount||0, color:"#fb923c", icon:"🤸" },
          { label:"Skor Challenge",  val:state.challengeHighScore||0, color:"#a855f7", icon:"⚡" },
        ].map((s, i) => (
          <div key={i} style={{
            background:"rgba(255,255,255,0.04)", border:`1px solid ${s.color}33`,
            borderRadius:18, padding:"16px", display:"flex", alignItems:"center", gap:14,
          }}>
            <div style={{ fontSize:28 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize:20, fontWeight:900, color:s.color }}>{s.val}</div>
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontWeight:700 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{
        background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)",
        borderRadius:24, padding:"24px", marginBottom:16,
      }}>
        <div style={{ fontSize:14, fontWeight:900, color:"#fff", marginBottom:20 }}>Aktivitas 7 Hari Terakhir</div>
        <div style={{ display:"flex", alignItems:"flex-end", gap:10, height:120 }}>
          {weekly.map((val, i) => (
            <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:8 }}>
              <div style={{ fontSize:11, fontWeight:800, color:"#a78bfa" }}>{val}</div>
              <div style={{
                width:"100%", borderRadius:"8px 8px 0 0",
                height:`${(val/maxR)*80}px`,
                background: i === new Date().getDay()
                  ? "linear-gradient(180deg,#7c3aed,#2563eb)"
                  : "linear-gradient(180deg,rgba(124,58,237,0.6),rgba(37,99,235,0.3))",
                boxShadow: i === new Date().getDay() ? "0 0 16px rgba(124,58,237,0.5)" : "none",
                transition:"height 1s ease",
                animation:`barGrow 0.6s ${i*0.1}s both ease`,
              }} />
              <div style={{ fontSize:11, color:"rgba(255,255,255,0.4)", fontWeight:700 }}>{days[i]}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{
        background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)",
        borderRadius:24, padding:"24px", marginBottom:16,
      }}>
        <div style={{ fontSize:14, fontWeight:900, color:"#fff", marginBottom:16 }}>Riwayat Aktivitas</div>
        {state.activityLog && state.activityLog.length > 0 ? (
          state.activityLog.slice(0,8).map((a, i) => (
            <div key={i} style={{
              display:"flex", alignItems:"center", gap:14, padding:"10px 0",
              borderBottom: i < Math.min(state.activityLog.length,8)-1 ? "1px solid rgba(255,255,255,0.06)" : "none",
            }}>
              <div style={{
                width:42, height:42, borderRadius:14, flexShrink:0,
                background:`rgba(124,58,237,0.2)`, border:`1px solid rgba(124,58,237,0.3)`,
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:18,
              }}>{a.icon || "🏃"}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:800, color:"#fff" }}>{a.name}</div>
                <div style={{ fontSize:11, color:"rgba(255,255,255,0.35)", fontWeight:600 }}>{a.date}</div>
              </div>
              <div style={{ fontSize:11, color:"#a78bfa", fontWeight:800 }}>{a.score} pts</div>
            </div>
          ))
        ) : (
          <div style={{ fontSize:13, color:"rgba(255,255,255,0.3)", textAlign:"center", fontWeight:600 }}>
            Belum ada aktivitas. Ayo mulai bermain!
          </div>
        )}
      </div>

      <div style={{
        background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)",
        borderRadius:24, padding:"24px",
      }}>
        <div style={{ fontSize:14, fontWeight:900, color:"#fff", marginBottom:16 }}>💬 AI Coach Feedback</div>
        {[
          { label:"Yang Bagus",       val: state.totalMoves >= 10 ? "Konsistensi bagus! Kamu rajin berolahraga." : "Sudah mulai bergerak, pertahankan ya!", color:"#34d399" },
          { label:"Perlu Ditingkatkan", val: state.totalMoves < 5 ? "Coba tambah frekuensi bermain setiap hari." : state.streak < 3 ? "Coba main 3 hari berturut-turut!" : "Tingkatkan tantangan ke level berikutnya!", color:"#fb923c" },
        ].map((f,i) => (
          <div key={i} style={{ padding:"12px 0", borderBottom: i < 1 ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
            <div style={{ fontSize:11, color:f.color, fontWeight:800, textTransform:"uppercase", letterSpacing:1, marginBottom:4 }}>{f.label}</div>
            <div style={{ fontSize:13, color:"rgba(255,255,255,0.7)", fontWeight:600 }}>{f.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SETTINGS SCREEN ──────────────────────────────────────────────────────────
function SettingsScreen({ state, setState, resetState, showToast }) {
  const [name, setName] = useState(state.playerName || "");
  const [sound, setSound] = useState(state.settings?.sound !== false);
  const [music, setMusic] = useState(state.settings?.music !== false);
  const [tracking, setTracking] = useState(state.settings?.tracking !== false);

  const saveSettings = () => {
    setState(prev => ({
      ...prev,
      playerName: name.trim() || prev.playerName,
      settings: { sound, music, tracking },
    }));
    AudioSystem.success();
    showToast("✅ Pengaturan disimpan!");
  };

  const handleReset = () => {
    if (window.confirm("Hapus semua data? Ini tidak bisa dibatalkan!")) {
      resetState();
      showToast("🗑️ Data dihapus. Mulai dari awal!");
    }
  };

  const Toggle = ({ value, onChange, label, icon }) => (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 0", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <span style={{ fontSize:20 }}>{icon}</span>
        <span style={{ fontSize:14, fontWeight:700, color:"#e2e8f0" }}>{label}</span>
      </div>
      <div
        onClick={() => onChange(!value)}
        style={{
          width:52, height:28, borderRadius:50, cursor:"pointer",
          background: value ? "linear-gradient(135deg,#7c3aed,#2563eb)" : "rgba(255,255,255,0.1)",
          position:"relative", transition:"all 0.3s ease",
          boxShadow: value ? "0 4px 12px rgba(124,58,237,0.4)" : "none",
        }}>
        <div style={{
          width:20, height:20, borderRadius:"50%", background:"#fff",
          position:"absolute", top:4, left: value ? 28 : 4,
          transition:"left 0.3s ease", boxShadow:"0 2px 4px rgba(0,0,0,0.3)",
        }} />
      </div>
    </div>
  );

  return (
    <div style={{ padding:"28px 32px" }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:13, color:"#94a3b8", fontWeight:700, letterSpacing:1, textTransform:"uppercase" }}>Pengaturan</div>
        <div style={{ fontSize:28, fontWeight:900, color:"#fff" }}>Settings ⚙️</div>
      </div>

      {/* AI Camera info card */}
      <div style={{
        background:"linear-gradient(135deg, rgba(34,197,94,0.15), rgba(16,185,129,0.08))",
        border:"1px solid rgba(34,197,94,0.3)", borderRadius:24, padding:"20px 24px", marginBottom:20,
      }}>
        <div style={{ fontSize:14, fontWeight:900, color:"#34d399", marginBottom:8 }}>📡 AI Tracking Info</div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.6)", fontWeight:600, lineHeight:1.6 }}>
          Gerak Ceria menggunakan <strong style={{ color:"#a78bfa" }}>MediaPipe PoseLandmarker</strong> (MoveNet-class model) untuk mendeteksi gerakan badanmu secara real-time melalui kamera. Aktifkan di layar Warmup, Challenge, atau Mission untuk pengalaman terbaik.
        </div>
        <div style={{ marginTop:12, display:"flex", gap:8, flexWrap:"wrap" }}>
          {["MediaPipe Tasks Vision","PoseLandmarker Lite","GestureDetector","EmotionDetector","Real-time Skeleton"].map(tag => (
            <span key={tag} style={{
              fontSize:10, fontWeight:800, color:"#a78bfa",
              background:"rgba(124,58,237,0.2)", border:"1px solid rgba(124,58,237,0.3)",
              borderRadius:50, padding:"2px 10px",
            }}>{tag}</span>
          ))}
        </div>
      </div>

      {/* Profile */}
      <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:24, padding:"24px", marginBottom:20 }}>
        <div style={{ fontSize:14, fontWeight:900, color:"#fff", marginBottom:16 }}>👤 Profil Pemain</div>
        <div style={{ marginBottom:8 }}>
          <label style={{ fontSize:12, color:"#94a3b8", fontWeight:700, display:"block", marginBottom:8 }}>NAMA PEMAIN</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Masukkan nama..."
            style={{
              width:"100%", padding:"12px 16px", borderRadius:14,
              background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.12)",
              color:"#fff", fontSize:16, fontWeight:700, fontFamily:"'Nunito', sans-serif",
              outline:"none", boxSizing:"border-box",
            }}
          />
        </div>
        <div style={{ fontSize:12, color:"rgba(255,255,255,0.3)", fontWeight:600 }}>
          Level {state.level} · {state.exp} XP · Streak {state.streak} hari
        </div>
      </div>

      {/* Sound settings */}
      <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:24, padding:"24px", marginBottom:20 }}>
        <div style={{ fontSize:14, fontWeight:900, color:"#fff", marginBottom:4 }}>🔊 Suara & Musik</div>
        <Toggle value={sound} onChange={setSound} label="Efek Suara" icon="🔔" />
        <Toggle value={music} onChange={setMusic} label="Musik Latar" icon="🎵" />
        <Toggle value={tracking} onChange={setTracking} label="Body Tracking (AI Camera)" icon="📡" />
      </div>

      {/* Mascot preview */}
      <div style={{ background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:24, padding:"24px", marginBottom:20, textAlign:"center" }}>
        <div style={{ fontSize:14, fontWeight:900, color:"#fff", marginBottom:12 }}>🤖 Maskot AI Coach</div>
        <div style={{ display:"flex", justifyContent:"center", animation:"mascotBob 3s ease-in-out infinite" }}>
          <MascotSVG size={100} mood="happy" glow />
        </div>
        <div style={{ fontSize:13, color:"rgba(255,255,255,0.5)", marginTop:12, fontWeight:600 }}>
          AI Coach siap menemanimu berolahraga! 💪
        </div>
      </div>

      <button
        onClick={saveSettings}
        style={{
          width:"100%", padding:"18px", background:"linear-gradient(135deg,#7c3aed,#2563eb)",
          border:"none", borderRadius:20, color:"#fff", fontWeight:900, fontSize:18,
          cursor:"pointer", fontFamily:"'Nunito', sans-serif",
          boxShadow:"0 8px 32px rgba(124,58,237,0.4)", marginBottom:12,
        }}>
        💾 Simpan Pengaturan
      </button>

      <button
        onClick={handleReset}
        style={{
          width:"100%", padding:"14px",
          background:"rgba(239,68,68,0.15)", border:"1px solid rgba(239,68,68,0.3)",
          borderRadius:16, color:"#ef4444", fontWeight:800, fontSize:14,
          cursor:"pointer", fontFamily:"'Nunito', sans-serif",
        }}>
        🗑️ Reset Semua Data
      </button>
    </div>
  );
}

// ─── NAV ICONS ───────────────────────────────────────────────────────────────
const HomeIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);
const MapIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
    <line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>
  </svg>
);
const ZapIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
);
const FireIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>
  </svg>
);
const SwordIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/>
    <line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/>
  </svg>
);
const TrophyIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="8 19 12 23 16 19"/><line x1="12" y1="23" x2="12" y2="17"/>
    <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
  </svg>
);
const ChartIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>
  </svg>
);
const SettingsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');
  * { box-sizing: border-box; }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(167,139,250,0.3); border-radius: 4px; }

  @keyframes logoFloat {
    0%,100% { transform: translateY(0) rotate(0deg); }
    50% { transform: translateY(-6px) rotate(3deg); }
  }
  @keyframes mascotBob {
    0%,100% { transform: translateY(0); }
    50% { transform: translateY(-8px); }
  }
  @keyframes pulse {
    0%,100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(1.3); }
  }
  @keyframes playPulse {
    0%,100% { box-shadow: 0 8px 40px rgba(34,197,94,0.5), 0 4px 12px rgba(37,99,235,0.3); }
    50% { box-shadow: 0 8px 60px rgba(34,197,94,0.7), 0 0 0 12px rgba(34,197,94,0.1), 0 4px 12px rgba(37,99,235,0.4); }
  }
  @keyframes coachFadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes cardEntrance {
    from { opacity: 0; transform: translateY(20px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes expandIn {
    from { opacity: 0; max-height: 0; }
    to { opacity: 1; max-height: 300px; }
  }
  @keyframes barGrow {
    from { transform: scaleY(0); transform-origin: bottom; }
    to { transform: scaleY(1); transform-origin: bottom; }
  }
  @keyframes badgeShimmer {
    0%,100% { box-shadow: 0 4px 20px rgba(251,191,36,0.4); }
    50% { box-shadow: 0 4px 30px rgba(251,191,36,0.7), 0 0 0 8px rgba(251,191,36,0.1); }
  }
  @keyframes floatUp {
    0% { bottom: -20px; opacity: 0; }
    10% { opacity: 1; }
    90% { opacity: 0.3; }
    100% { bottom: 110vh; opacity: 0; transform: translateX(30px); }
  }

  .stat-card:hover { transform: translateY(-4px) scale(1.02); box-shadow: 0 8px 32px rgba(124,58,237,0.3) !important; }
  .feature-btn:hover { transform: translateY(-4px) scale(1.03) !important; }
  .feature-btn:active { transform: scale(0.97) !important; }
  .mission-node:hover:not(:disabled) { transform: scale(1.02); }
  .challenge-card:hover { transform: translateY(-2px); }
  .badge-card:hover { transform: translateY(-4px) scale(1.04) !important; }
`;
