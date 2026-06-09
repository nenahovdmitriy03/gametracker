/* ═══════════════════════════════════════════════════
   UI Polish — additive enhancements
   Loaded after app.js. Purely additive, никогда не ломает
   существующую логику: count-up статистики, конфетти при
   завершении игры, доступность (focus-visible / reduced-motion).
   ═══════════════════════════════════════════════════ */
(function () {
  'use strict';

  var REDUCED = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ── Count-up animation for stat numbers ──────────────
  function formatNum(v, decimals) {
    if (decimals > 0) return (+v).toFixed(decimals);
    return Math.round(v).toLocaleString('ru-RU');
  }

  function animateCount(el, to, decimals, duration) {
    duration = duration || 700;
    if (REDUCED || !isFinite(to)) {
      el.textContent = formatNum(to, decimals);
      return;
    }
    var start = performance.now();
    function tick(now) {
      var p = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = formatNum(to * eased, decimals);
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = formatNum(to, decimals);
    }
    requestAnimationFrame(tick);
  }

  function parseStat(el) {
    var raw = (el.textContent || '')
      .replace(/\s|\u00a0/g, '')
      .replace(/[^\d.,]/g, '')
      .replace(',', '.');
    return { num: parseFloat(raw), decimals: /\./.test(raw) ? 1 : 0 };
  }

  function runStatCountUp() {
    ['ssc-games', 'ssc-ach', 'ssc-completed'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var s = parseStat(el);
      if (isFinite(s.num)) animateCount(el, s.num, 0, 650);
    });
    var hEl = document.getElementById('ssc-hours');
    if (hEl) {
      var s = parseStat(hEl);
      if (isFinite(s.num)) animateCount(hEl, s.num, s.decimals, 720);
    }
  }

  // Trigger count-up whenever the user opens the Statistics view.
  document.addEventListener('click', function (e) {
    var nav = e.target.closest && e.target.closest('.nav-item[data-view="stats"]');
    if (nav) setTimeout(runStatCountUp, 90);
  });
  // Also run once if app boots straight into stats.
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      var app = document.getElementById('app');
      if (app && app.getAttribute('data-view') === 'stats') runStatCountUp();
    }, 400);
  });

  // ── Confetti burst ───────────────────────────────────
  function burstConfetti(x, y) {
    if (REDUCED) return;
    var colors = ['#818cf8', '#34d399', '#fbbf24', '#f87171', '#2dd4bf', '#a78bfa'];
    var layer = document.createElement('div');
    layer.className = 'confetti-layer';
    document.body.appendChild(layer);
    var N = 90;
    for (var i = 0; i < N; i++) {
      var piece = document.createElement('i');
      piece.className = 'confetti-piece';
      var angle = Math.random() * Math.PI * 2;
      var dist = 120 + Math.random() * 240;
      var dx = Math.cos(angle) * dist;
      var dy = Math.sin(angle) * dist - (140 + Math.random() * 180);
      piece.style.left = x + 'px';
      piece.style.top = y + 'px';
      piece.style.background = colors[i % colors.length];
      piece.style.setProperty('--dx', dx.toFixed(0) + 'px');
      piece.style.setProperty('--dy', dy.toFixed(0) + 'px');
      piece.style.setProperty('--rot', (Math.random() * 720 - 360).toFixed(0) + 'deg');
      piece.style.animationDelay = (Math.random() * 70).toFixed(0) + 'ms';
      if (Math.random() > 0.5) piece.style.borderRadius = '50%';
      layer.appendChild(piece);
    }
    setTimeout(function () { layer.remove(); }, 1900);
  }
  window.burstConfetti = burstConfetti;

  // Celebrate when a game is marked "completed" from the hero status pills.
  // This is an extra listener — the app's own handler still runs unchanged.
  var heroStatus = document.getElementById('sl-hero-status');
  if (heroStatus) {
    heroStatus.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.sl-status-pill');
      if (!btn || btn.dataset.status !== 'completed') return;
      setTimeout(function () {
        if (btn.classList.contains('active')) {
          var r = btn.getBoundingClientRect();
          burstConfetti(r.left + r.width / 2, r.top + r.height / 2);
        }
      }, 90);
    });
  }
})();
