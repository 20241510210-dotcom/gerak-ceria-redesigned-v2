// ══════════════════════════════════════════
// CONFETTI.JS — Confetti & Particle System
// ══════════════════════════════════════════

(function() {
  const canvas = document.getElementById('confettiCanvas');
  const ctx = canvas.getContext('2d');
  let particles = [];
  let animId = null;

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const COLORS = ['#22c55e','#3b82f6','#f97316','#eab308','#a855f7','#ef4444','#14b8a6','#ec4899'];
  const SHAPES = ['circle','rect','star'];

  function createParticle(x, y) {
    return {
      x: x ?? Math.random() * canvas.width,
      y: y ?? -10,
      vx: (Math.random() - 0.5) * 8,
      vy: Math.random() * 4 + 2,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
      size: Math.random() * 10 + 6,
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 8,
      life: 1,
      decay: Math.random() * 0.015 + 0.008,
    };
  }

  function drawParticle(p) {
    ctx.save();
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.translate(p.x, p.y);
    ctx.rotate((p.rotation * Math.PI) / 180);
    if (p.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.shape === 'rect') {
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    } else {
      // star
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
        const r = i % 2 === 0 ? p.size / 2 : p.size / 4;
        ctx.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1; // gravity
      p.rotation += p.rotSpeed;
      p.life -= p.decay;
      drawParticle(p);
    });
    particles = particles.filter(p => p.life > 0 && p.y < canvas.height + 20);
    if (particles.length > 0) {
      animId = requestAnimationFrame(loop);
    } else {
      animId = null;
    }
  }

  /** Burst confetti from a point or random top */
  function burst(count = 60, x, y) {
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        particles.push(createParticle(x, y));
      }, Math.random() * 300);
    }
    if (!animId) animId = requestAnimationFrame(loop);
  }

  /** Continuous rain of confetti */
  let rainInterval = null;
  function rain(duration = 3000) {
    if (rainInterval) clearInterval(rainInterval);
    rainInterval = setInterval(() => {
      particles.push(createParticle());
    }, 50);
    setTimeout(() => {
      clearInterval(rainInterval);
      rainInterval = null;
    }, duration);
    if (!animId) animId = requestAnimationFrame(loop);
  }

  window.Confetti = { burst, rain };
})();
