/* SEC Filing Analyzer — shared effects: starfield + custom cursor (v2) */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- Starfield ---------- */
  var canvas = document.getElementById('stars');
  if (canvas) {
    var ctx = canvas.getContext('2d');
    // data-density="calm" on the canvas gives subpages a quieter sky
    var calm = canvas.getAttribute('data-density') === 'calm';
    var stars = [];
    var DPR = Math.min(window.devicePixelRatio || 1, 2);

    function makeStars() {
      var count = Math.floor((window.innerWidth * window.innerHeight) / (calm ? 16000 : 9000));
      stars = [];
      for (var i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          r: 0.4 + Math.random() * 1.1,
          base: 0.25 + Math.random() * 0.55,
          phase: Math.random() * Math.PI * 2,
          speed: 0.4 + Math.random() * 1.2,
          driftX: (Math.random() - 0.5) * 0.05,
          driftY: (Math.random() - 0.5) * 0.03
        });
      }
    }

    function resize() {
      canvas.width = window.innerWidth * DPR;
      canvas.height = window.innerHeight * DPR;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      makeStars();
      if (reducedMotion) drawStars(0); // static sky, drawn once
    }

    function drawStars(t) {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        var alpha = reducedMotion
          ? s.base
          : s.base * (0.55 + 0.45 * Math.sin(s.phase + t * 0.001 * s.speed));
        if (!reducedMotion) {
          s.x += s.driftX;
          s.y += s.driftY;
          if (s.x < 0) s.x = window.innerWidth;
          if (s.x > window.innerWidth) s.x = 0;
          if (s.y < 0) s.y = window.innerHeight;
          if (s.y > window.innerHeight) s.y = 0;
        }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function loop(t) {
      drawStars(t);
      requestAnimationFrame(loop);
    }

    window.addEventListener('resize', resize);
    resize();
    if (!reducedMotion) requestAnimationFrame(loop);
  }

  /* ---------- Custom cursor (desktop only) ---------- */
  if (finePointer && !reducedMotion) {
    document.body.classList.add('custom-cursor');

    var dot = document.createElement('div');
    dot.className = 'cursor-dot';
    var ring = document.createElement('div');
    ring.className = 'cursor-ring';
    document.body.appendChild(ring);
    document.body.appendChild(dot);

    var TRAIL_COUNT = 7;
    var trail = [];
    for (var i = 0; i < TRAIL_COUNT; i++) {
      var d = document.createElement('div');
      d.className = 'cursor-trail';
      d.style.opacity = String(0.5 * (1 - i / TRAIL_COUNT));
      document.body.appendChild(d);
      trail.push({ el: d, x: -100, y: -100 });
    }

    var mx = -100, my = -100;   // real mouse
    var rx = -100, ry = -100;   // eased ring

    document.addEventListener('mousemove', function (e) {
      mx = e.clientX;
      my = e.clientY;
    });

    function cursorLoop() {
      rx += (mx - rx) * 0.10;
      ry += (my - ry) * 0.10;
      dot.style.transform = 'translate(' + (mx - 3) + 'px,' + (my - 3) + 'px)';
      ring.style.transform = 'translate(' + (rx - 15) + 'px,' + (ry - 15) + 'px)';
      var px = mx, py = my;
      for (var i = 0; i < TRAIL_COUNT; i++) {
        var t = trail[i];
        t.x += (px - t.x) * 0.35;
        t.y += (py - t.y) * 0.35;
        t.el.style.transform = 'translate(' + (t.x - 2) + 'px,' + (t.y - 2) + 'px)';
        px = t.x;
        py = t.y;
      }
      requestAnimationFrame(cursorLoop);
    }
    requestAnimationFrame(cursorLoop);
  }
})();
