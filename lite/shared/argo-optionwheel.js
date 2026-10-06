/* ============================================================================
   OptionWheel — React Bits <OptionWheel /> 바닐라 이식.
   원본: npx shadcn@latest add @react-bits/OptionWheel-JS-CSS  (React)
   이 프로젝트는 React 가 아니라 MetaBalls·WavePath·FoldText 와 같은 방식으로 옮겼다.
   클래스명/레이아웃 수식(원 위 배치, 기울기, 블러, 페이드)은 원본 그대로,
   useRef/useState 만 클로저 변수로 바꿨다.

   사용:
     var wheel = ArgoOptionWheel.create(el, {
       items: ['01 ARRIVAL', '02 EXPEDITION', ...],
       selected: 0,
       interactive: false        // 시험지에서는 표시 전용 (cq 가 주인)
     });
     wheel.setIndex(n);          // 바깥에서 선택을 옮긴다
   ============================================================================ */
(function (global) {
  'use strict';

  function create(root, opts) {
    if (!root) return null;
    opts = opts || {};

    var items       = opts.items || [];
    var side        = opts.side || 'left';
    var fontSize    = opts.fontSize != null ? opts.fontSize : 3;      /* rem */
    var spacing     = opts.spacing  != null ? opts.spacing  : 1.4;
    var curve       = opts.curve    != null ? opts.curve    : 1;
    var tilt        = opts.tilt     != null ? opts.tilt     : 6;      /* deg */
    var blur        = opts.blur     != null ? opts.blur     : 2;
    var fade        = opts.fade     != null ? opts.fade     : 0.25;
    var minOpacity  = opts.minOpacity != null ? opts.minOpacity : 0.05;
    var smoothing   = opts.smoothing  != null ? opts.smoothing  : 200; /* ms */
    var inset       = opts.inset    != null ? opts.inset    : 80;     /* px */
    var loop        = !!opts.loop;
    var interactive = opts.interactive !== false;
    var onChange    = opts.onChange;

    var remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    var rowH  = Math.max(fontSize * spacing * remPx, 1);

    var pos = opts.selected || 0, target = pos, selected = Math.round(pos);
    var raf = null, last = 0, wheelTimer = null;
    var drag = null, dragMoved = false;

    /* ---- DOM ---- */
    root.classList.add('option-wheel');
    if (side === 'right') root.classList.add('option-wheel--right');
    root.setAttribute('role', 'listbox');
    root.style.setProperty('--ow-font-size', fontSize + 'rem');
    root.style.setProperty('--ow-inset', inset + 'px');
    if (opts.textColor)   root.style.setProperty('--ow-text-color', opts.textColor);
    if (opts.activeColor) root.style.setProperty('--ow-active-color', opts.activeColor);
    if (interactive) root.tabIndex = 0; else root.style.cursor = 'default';

    root.innerHTML = '';
    var els = items.map(function (label, i) {
      var d = document.createElement('div');
      d.className = 'option-wheel__item';
      d.setAttribute('role', 'option');
      d.textContent = label;
      if (interactive) d.addEventListener('click', function () { onItemClick(i); });
      else d.style.cursor = 'inherit';
      root.appendChild(d);
      return d;
    });

    /* ---- rAF : 목표까지 지수 감쇠로 따라가며 곡선 위에 배치 ---- */
    function frame(now) {
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      var tau = Math.max(smoothing, 1) / 1000;
      var k = 1 - Math.exp(-dt / tau);

      var next = pos + (target - pos) * k;
      var settled = Math.abs(target - next) < 0.001;
      if (settled) next = target;
      pos = next;

      var n = items.length;
      var mirror = side === 'right' ? -1 : 1;
      /* 이웃 사이 호 길이가 rowH 가 되도록 반지름을 잡는다 → tilt 가 곡률을 정한다 */
      var tiltRad = (tilt * Math.PI) / 180;
      var R = tiltRad > 0.0005 ? rowH / tiltRad : 0;

      for (var i = 0; i < n; i++) {
        var el = els[i]; if (!el) continue;
        var d = i - next;
        if (loop && n > 1) { d = ((d % n) + n) % n; if (d > n / 2) d -= n; }
        var dist = Math.abs(d);
        var x = 0, y = d * rowH, rot = 0;
        if (R > 0) {
          var ang = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, d * tiltRad));
          y = R * Math.sin(ang);
          x = -mirror * R * (1 - Math.cos(ang)) * curve;
          rot = (mirror * ang * 180) / Math.PI;
        }
        el.style.transform = 'translate(' + x.toFixed(2) + 'px, calc(' + y.toFixed(2) + 'px - 50%)) rotate(' + rot.toFixed(3) + 'deg)';
        el.style.opacity = String(Math.max(minOpacity, 1 - dist * fade));
        el.style.filter = blur > 0 ? 'blur(' + (dist * blur).toFixed(2) + 'px)' : 'none';
        el.style.setProperty('--ow-p', Math.max(0, 1 - Math.min(dist, 1)).toFixed(4));
        /* --ow-p 는 한 칸만 지나면 0 이라 색 그라데이션에는 너무 급하다.
           3칸에 걸쳐 완만히 떨어지는 값을 따로 준다(가운데 1 → 세 칸 밖 0). */
        el.style.setProperty('--ow-far', Math.max(0, 1 - Math.min(dist / 3, 1)).toFixed(4));
      }
      raf = settled ? null : requestAnimationFrame(frame);
    }

    function startLoop() {
      if (raf != null) cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    function applyTarget(v, snap) {
      var n = items.length;
      if (!loop) v = Math.min(Math.max(v, 0), Math.max(n - 1, 0));
      if (snap) v = Math.round(v);
      target = v;
      var idx = ((Math.round(v) % n) + n) % n;
      if (idx !== selected) {
        selected = idx;
        els.forEach(function (el, i) {
          el.classList.toggle('option-wheel__item--selected', i === idx);
          el.setAttribute('aria-selected', i === idx ? 'true' : 'false');
        });
        if (onChange) onChange(idx, items[idx]);
      }
      startLoop();
    }

    function onItemClick(i) {
      if (dragMoved) return;
      var n = items.length;
      var cur = target;
      var d = i - (((cur % n) + n) % n);
      if (loop && n > 1) { if (d > n / 2) d -= n; else if (d < -n / 2) d += n; }
      applyTarget(cur + d, true);
    }

    /* ---- 입력 (interactive 일 때만) ---- */
    function onWheel(e) {
      e.preventDefault();
      var delta = e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY;
      var step = Math.max(-1, Math.min(1, delta / rowH));   /* 한 이벤트당 최대 1칸 */
      applyTarget(target + step, false);
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(function () { applyTarget(target, true); }, 140);
    }
    function onDown(e) {
      drag = { y: e.clientY, start: target, id: e.pointerId };
      dragMoved = false;
      root.classList.add('option-wheel--dragging');
    }
    function onMove(e) {
      if (!drag) return;
      var dy = e.clientY - drag.y;
      if (!dragMoved && Math.abs(dy) > 4) {
        dragMoved = true;
        try { root.setPointerCapture(drag.id); } catch (err) {}
      }
      if (dragMoved) applyTarget(drag.start - dy / rowH, false);
    }
    function onUp() {
      if (!drag) return;
      drag = null;
      root.classList.remove('option-wheel--dragging');
      if (dragMoved) applyTarget(target, true);
    }
    function onKey(e) {
      var d = null;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') d = -1;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') d = 1;
      if (d == null) return;
      e.preventDefault();
      applyTarget(Math.round(target) + d, true);
    }

    if (interactive) {
      root.addEventListener('wheel', onWheel, { passive: false });
      root.addEventListener('pointerdown', onDown);
      root.addEventListener('pointermove', onMove);
      root.addEventListener('pointerup', onUp);
      root.addEventListener('pointercancel', onUp);
      root.addEventListener('keydown', onKey);
    }

    /* 첫 배치 */
    els.forEach(function (el, i) {
      el.classList.toggle('option-wheel__item--selected', i === selected);
      el.setAttribute('aria-selected', i === selected ? 'true' : 'false');
    });
    applyTarget(target, false);

    return {
      setIndex: function (i) { applyTarget(i, true); },
      getIndex: function () { return selected; },
      destroy: function () {
        if (raf != null) cancelAnimationFrame(raf);
        raf = null;
        if (wheelTimer) clearTimeout(wheelTimer);
        if (interactive) {
          root.removeEventListener('wheel', onWheel);
          root.removeEventListener('pointerdown', onDown);
          root.removeEventListener('pointermove', onMove);
          root.removeEventListener('pointerup', onUp);
          root.removeEventListener('pointercancel', onUp);
          root.removeEventListener('keydown', onKey);
        }
      }
    };
  }

  global.ArgoOptionWheel = { create: create };
})(window);
