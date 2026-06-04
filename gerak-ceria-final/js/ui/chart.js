// ══════════════════════════════════════════
// ui/chart.js — Simple Activity Bar Chart
// ══════════════════════════════════════════

(function() {
  const DAYS = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
  const COLORS = ['#22c55e','#3b82f6','#f97316','#eab308','#a855f7','#ef4444','#14b8a6'];

  function renderActivityChart(data) {
    const canvas = document.getElementById('activityChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement;
    canvas.width  = parent.clientWidth  || 400;
    canvas.height = parent.clientHeight || 150;

    const W = canvas.width;
    const H = canvas.height;
    const PAD = { top:16, bottom:28, left:10, right:10 };
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top  - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    const max = Math.max(...data, 1);
    const barW = (innerW / data.length) * 0.6;
    const gap   = (innerW / data.length) * 0.4;

    // Today highlight
    const today = new Date().getDay();

    data.forEach((val, i) => {
      const barH = (val / max) * innerH;
      const x = PAD.left + i * (barW + gap) + gap / 2;
      const y = PAD.top + innerH - barH;

      // Bar
      const radius = 6;
      ctx.fillStyle = i === today ? '#f97316' : '#e2e8f0';
      // Rounded top bar
      ctx.beginPath();
      ctx.moveTo(x, y + radius);
      ctx.arcTo(x, y, x + barW, y, radius);
      ctx.arcTo(x + barW, y, x + barW, y + barH, radius);
      ctx.lineTo(x + barW, y + barH);
      ctx.lineTo(x, y + barH);
      ctx.closePath();
      ctx.fill();

      // Fill with color
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(x, y + radius);
      ctx.arcTo(x, y, x + barW, y, radius);
      ctx.arcTo(x + barW, y, x + barW, y + barH, radius);
      ctx.lineTo(x + barW, y + barH);
      ctx.lineTo(x, y + barH);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // Value label
      if (val > 0) {
        ctx.fillStyle = '#1e293b';
        ctx.font = 'bold 11px Nunito, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(val, x + barW / 2, y - 4);
      }

      // Day label
      ctx.fillStyle = i === today ? '#f97316' : '#94a3b8';
      ctx.font = `${i === today ? 'bold' : ''} 11px Nunito, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(DAYS[i], x + barW / 2, H - 8);
    });
  }

  window.ChartUI = { renderActivityChart };
})();
