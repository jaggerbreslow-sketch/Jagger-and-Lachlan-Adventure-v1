/* SEC Filing Analyzer — shared effects: starfield + meteors + custom cursor (v2.1) */
(function () {
  'use strict';

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- Starfield + shooting stars ---------- */
  var canvas = document.getElementById('stars');
  if (canvas) {
    var ctx = canvas.getContext('2d');
    // data-density="calm" on the canvas gives subpages a quieter sky
    var calm = canvas.getAttribute('data-density') === 'calm';
    var stars = [];
    var meteors = [];
    var nextMeteor = 0;
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

    function spawnMeteor() {
      var fromLeft = Math.random() < 0.5;
      meteors.push({
        x: fromLeft ? -20 : window.innerWidth * (0.3 + Math.random() * 0.7),
        y: Math.random() * window.innerHeight * 0.35,
        vx: (fromLeft ? 1 : -1) * (5 + Math.random() * 4),
        vy: 2 + Math.random() * 2.5,
        life: 0,
        maxLife: 50 + Math.random() * 40
      });
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

      if (!reducedMotion) {
        if (!nextMeteor) {
          nextMeteor = t + 3000 + Math.random() * 6000;
        }
        if (t > nextMeteor) {
          spawnMeteor();
          nextMeteor = t + (calm ? 18000 : 9000) + Math.random() * 14000;
        }
        for (var m = meteors.length - 1; m >= 0; m--) {
          var mt = meteors[m];
          mt.x += mt.vx;
          mt.y += mt.vy;
          mt.life++;
          var fade = 1 - mt.life / mt.maxLife;
          if (fade <= 0 || mt.y > window.innerHeight + 30 ||
              mt.x < -60 || mt.x > window.innerWidth + 60) {
            meteors.splice(m, 1);
            continue;
          }
          ctx.globalAlpha = 0.75 * fade;
          ctx.strokeStyle = '#bfdcff';
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          ctx.moveTo(mt.x, mt.y);
          ctx.lineTo(mt.x - mt.vx * 6, mt.y - mt.vy * 6);
          ctx.stroke();
          ctx.globalAlpha = 0.9 * fade;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(mt.x, mt.y, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
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
    var scale = 1, targetScale = 1;

    document.addEventListener('mousemove', function (e) {
      mx = e.clientX;
      my = e.clientY;
    });

    // ring grows over anything clickable
    var HOT = 'a, button, input, select, textarea, summary, label';
    document.addEventListener('mouseover', function (e) {
      var hot = e.target.closest && e.target.closest(HOT);
      targetScale = hot ? 1.6 : 1;
      ring.classList.toggle('hot', !!hot);
    });

    function cursorLoop() {
      rx += (mx - rx) * 0.10;
      ry += (my - ry) * 0.10;
      scale += (targetScale - scale) * 0.18;
      dot.style.transform = 'translate(' + (mx - 3) + 'px,' + (my - 3) + 'px)';
      ring.style.transform = 'translate(' + (rx - 15) + 'px,' + (ry - 15) + 'px) scale(' + scale.toFixed(3) + ')';
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
