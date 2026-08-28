/* ============================================================================
   DriftWall — React Bits <DriftWall /> 바닐라 이식.
   원본: npx shadcn@latest add @react-bits/DriftWall-JS-CSS  (React, 무의존)
   "An endless perspective wall of tiles drifting past, lifting on hover."

   이 프로젝트는 React 를 쓰지 않아 MetaBalls·WavePath·FoldText·OptionWheel·
   RippleDistortion 과 같은 방식으로 옮겼다. DOM 구조·클래스명·CSS 변수·
   수식(columnFactor 황금비 분산, copies 계산, 지수 감쇠 보간)은 원본 그대로고
   useRef/useState/useMemo 만 클로저 변수로 바꿨다.

   사용:
     var wall = ArgoDriftWall.create(el, { items:[{image,title,href}], pauseOnHover:true });
     wall.setItems(newItems);   // 타일 교체 (스크롤 위치는 유지)
   ============================================================================ */
(function (global) {
  'use strict';

  function reducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* 원본 columnFactor : 황금비 무리수로 열마다 속도를 흩는다 */
  function columnFactor(index, variance) {
    var pseudo = ((index * 0.6180339887 + 0.35) % 1) * 2 - 1;
    return 1 + variance * pseudo;
  }

  function create(root, opts) {
    if (!root) return null;
    opts = opts || {};

    /* ---- props (원본 기본값 그대로) ---- */
    var columns      = opts.columns      != null ? opts.columns      : 5;
    var tileWidth    = opts.tileWidth    != null ? opts.tileWidth    : 200;
    var tileHeight   = opts.tileHeight   != null ? opts.tileHeight   : 132;
    var gap          = opts.gap          != null ? opts.gap          : 18;
    var radius       = opts.radius       != null ? opts.radius       : 14;
    var tilt         = opts.tilt         != null ? opts.tilt         : 16;
    var turn         = opts.turn         != null ? opts.turn         : -14;
    var roll         = opts.roll         != null ? opts.roll         : 0;
    var perspective  = opts.perspective  != null ? opts.perspective  : 1200;
    var depth        = opts.depth        != null ? opts.depth        : 120;
    var speed        = opts.speed        != null ? opts.speed        : 42;
    var direction    = opts.direction    || 'up';
    var variance     = opts.variance     != null ? opts.variance     : 0.45;
    var parallax     = opts.parallax     != null ? opts.parallax     : 0.6;
    var pauseOnHover = !!opts.pauseOnHover;
    var lift         = opts.lift         != null ? opts.lift         : 64;
    var fade         = opts.fade         != null ? opts.fade         : 0.6;
    var dim          = opts.dim          != null ? opts.dim          : 0.55;
    var grayscale    = !!opts.grayscale;
    var overlayColor = opts.overlayColor || '#060010';
    var onTile       = opts.onTile;
    var eagerImages  = opts.eagerImages !== false;   /* [ARGO] 기본 eager */
    var onHover      = opts.onHover;   /* [ARGO] 활성 타일이 바뀔 때 알려준다 (RippleDistortion 용) */

    var items = (opts.items && opts.items.length) ? opts.items.slice() : [];

    var reduced = reducedMotion();

    /* ---- 상태 ---- */
    var columnItems = [], columnMeta = [], baseVelocities = [];
    var offsets = [], velocities = [], trackEls = [];
    var hoveredCol = -1, wallHovered = false, activeId = null, activeEl = null;
    var pointer = { x: 0, y: 0 }, pointerDamped = { x: 0, y: 0 };
    var lastTs = null, raf = 0;
    var containerHeight = root.clientHeight || 600;

    /* ---- 셸 ---- */
    root.classList.add('drift-wall');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Drifting wall of tiles');
    var plane = document.createElement('div');
    plane.className = 'drift-wall__plane';
    root.appendChild(plane);

    function applyVars() {
      var s = root.style;
      s.setProperty('--dw-tile-w', tileWidth + 'px');
      s.setProperty('--dw-tile-h', tileHeight + 'px');
      s.setProperty('--dw-gap', gap + 'px');
      s.setProperty('--dw-radius', radius + 'px');
      s.setProperty('--dw-perspective', perspective + 'px');
      s.setProperty('--dw-lift', lift + 'px');
      s.setProperty('--dw-dim', String(dim));
      s.setProperty('--dw-gray', grayscale ? '1' : '0');
      s.setProperty('--dw-overlay', overlayColor);
      s.setProperty('--dw-edge', Math.max(0, (1 - fade) * 100) + '%');
    }
    applyVars();
    if (reduced) root.classList.add('drift-wall--reduced');

    /* ---- 열 분배 : 원본 items.forEach((item,i)=>cols[i%columns].push(item)) ---- */
    function computeColumns() {
      var cols = [];
      for (var c = 0; c < columns; c++) cols.push([]);
      items.forEach(function (it, i) { cols[i % columns].push(it); });
      columnItems = cols.map(function (col) { return col.length ? col : items.slice(0, 1); });

      var unit = tileHeight + gap;
      columnMeta = columnItems.map(function (col) {
        var copyHeight = Math.max(unit, col.length * unit);
        /* 원본 공식. 한 벌이 뷰포트보다 한참 짧을 때를 가정한 식이다. */
        var copies = Math.max(2, Math.ceil((containerHeight * 1.6) / copyHeight) + 1);
        /* [ARGO] 한 벌이 뷰포트보다 길면(열당 타일이 많고 타일이 클 때) 위 식이 2벌을
           내놓는데, 트랙은 가운데 정렬이라 최대 copyHeight 만큼 밀리면 아래쪽이 비어
           버린다. 밀린 뒤에도 아래를 덮으려면 copies ≥ 2 + 뷰포트/한벌 이어야 한다.
             트랙 = [-T/2-off, T/2-off], off 최대 copyHeight
             → T/2 - copyHeight ≥ 뷰포트/2 */
        copies = Math.max(copies, Math.ceil(containerHeight / copyHeight) + 2);
        return { copyHeight: copyHeight, copies: copies };
      });

      var dirSign = direction === 'up' ? 1 : -1;
      baseVelocities = columnItems.map(function (_, c) {
        var altSign = c % 2 === 0 ? 1 : -1;
        return speed * columnFactor(c, variance) * dirSign * altSign;
      });
    }

    /* ---- 타일 ---- */
    function makeTile(item, id, colIndex) {
      var el = document.createElement(item.href ? 'a' : 'div');
      el.className = 'drift-wall__tile';
      el.setAttribute('data-tile-id', id);
      el.setAttribute('data-col', String(colIndex));
      if (item.href) {
        el.href = item.href; el.target = '_blank'; el.rel = 'noreferrer noopener';
      } else {
        el.tabIndex = 0; el.setAttribute('role', 'button');
        el.setAttribute('aria-label', item.title || 'tile');
      }
      var inner = document.createElement('span');
      inner.className = 'drift-wall__inner';
      var img = document.createElement('img');
      img.src = item.image; img.alt = item.title || '';
      /* [ARGO] 원본은 loading:'lazy' 인데, 벽은 3D 변환된 평면이라 브라우저가
         뷰포트 교차를 보수적으로 잡아 화면 안 타일까지 늦게 채운다.
         이미지가 로컬이고 장수도 고정이라 eager 가 낫다. */
      img.loading = eagerImages ? 'eager' : 'lazy';
      img.decoding = 'async'; img.draggable = false;
      img.fetchPriority = eagerImages ? 'high' : 'auto';
      var ov = document.createElement('span');
      ov.className = 'drift-wall__overlay'; ov.setAttribute('aria-hidden', 'true');
      inner.appendChild(img); inner.appendChild(ov);
      /* [ARGO] 촬영 일시 캡션 — 사진 하단에 얹는다. item.caption 이 있을 때만 만든다
         (우주 아카이브 컷에는 찍힌 시각이 없으므로 붙이지 않는다). */
      if (item.caption) {
        var cap = document.createElement('span');
        cap.className = 'drift-wall__caption';
        cap.textContent = item.caption;
        inner.appendChild(cap);
      }
      if (item.mine) el.classList.add('is-mine');
      el.appendChild(inner);

      el.addEventListener('focus', function () { activate(id, colIndex, el); });
      el.addEventListener('blur', release);
      if (onTile) el.addEventListener('click', function () { onTile(item, id); });
      return el;
    }

    function build() {
      computeColumns();
      plane.innerHTML = '';
      trackEls = [];
      columnItems.forEach(function (col, c) {
        var meta = columnMeta[c];
        var colEl = document.createElement('div');
        colEl.className = 'drift-wall__col';
        var track = document.createElement('div');
        track.className = 'drift-wall__track';
        for (var copy = 0; copy < meta.copies; copy++) {
          col.forEach(function (item, i) {
            track.appendChild(makeTile(item, c + '-' + copy + '-' + i, c));
          });
        }
        colEl.appendChild(track);
        plane.appendChild(colEl);
        trackEls[c] = track;
      });
      /* 오프셋은 원본과 같은 초기 분산. 재빌드 시엔 흐름이 튀지 않게 이어받는다. */
      columnMeta.forEach(function (meta, c) {
        if (offsets[c] == null) offsets[c] = meta.copyHeight * ((c * 0.37) % 1);
        else offsets[c] = ((offsets[c] % meta.copyHeight) + meta.copyHeight) % meta.copyHeight;
        if (velocities[c] == null) velocities[c] = 0;
      });
      activeId = null; activeEl = null; hoveredCol = -1;
    }

    /* ---- 활성 타일 ---- */
    function activate(id, colIndex, el) {
      if (activeEl) activeEl.classList.remove('is-active');
      activeId = id; hoveredCol = colIndex; activeEl = el || null;
      if (activeEl) activeEl.classList.add('is-active');
      if (onHover) onHover(activeEl, id);
    }
    function release() {
      if (activeEl) activeEl.classList.remove('is-active');
      activeId = null; activeEl = null; hoveredCol = -1;
      if (onHover) onHover(null, null);
    }

    /* ---- 평면 변환 ---- */
    function applyPlaneTransform(px, py) {
      plane.style.transform =
        'translate(-50%, -50%) scale(1.18) ' +
        'rotateX(' + (tilt + py) + 'deg) rotateY(' + (turn + px) + 'deg) rotateZ(' + roll + 'deg) ' +
        'translateZ(' + (-depth) + 'px)';
    }

    /* ---- 루프 (원본 animate 그대로) ---- */
    function animate(ts) {
      if (lastTs === null) lastTs = ts;
      var dt = Math.min(0.05, Math.max(0, ts - lastTs) / 1000);
      lastTs = ts;

      var maxTilt = parallax * 8;
      var targetX = pointer.x * maxTilt;
      var targetY = -pointer.y * maxTilt;
      var damp = 1 - Math.exp(-dt / 0.12);
      pointerDamped.x += (targetX - pointerDamped.x) * damp;
      pointerDamped.y += (targetY - pointerDamped.y) * damp;
      applyPlaneTransform(pointerDamped.x, pointerDamped.y);

      if (!reduced) {
        for (var c = 0; c < trackEls.length; c++) {
          var meta = columnMeta[c];
          if (!meta) continue;
          /* pauseOnHover : 벽에 커서가 올라가면 전체 정지, 아니면 커서가 놓인 열만 정지 */
          var paused = wallHovered && pauseOnHover;
          var factor = (paused || hoveredCol === c) ? 0 : 1;
          var target = baseVelocities[c] * factor;

          var ease = 1 - Math.exp(-dt / (target === 0 ? 0.16 : 0.28));
          velocities[c] += (target - velocities[c]) * ease;
          var next = (offsets[c] || 0) + velocities[c] * dt;
          next = ((next % meta.copyHeight) + meta.copyHeight) % meta.copyHeight;
          offsets[c] = next;
          if (trackEls[c]) trackEls[c].style.transform = 'translate3d(0,' + (-next) + 'px,0)';
        }
      } else {
        for (var k = 0; k < trackEls.length; k++) {
          if (trackEls[k] && columnMeta[k]) {
            trackEls[k].style.transform = 'translate3d(0,' + (-(offsets[k] || 0)) + 'px,0)';
          }
        }
      }
      raf = requestAnimationFrame(animate);
    }

    /* ---- 입력 ---- */
    function onPointerMove(e) {
      var rect = root.getBoundingClientRect();
      if (!rect) return;
      if (parallax > 0 && !reduced) {
        pointer.x = (e.clientX - rect.left) / rect.width - 0.5;
        pointer.y = (e.clientY - rect.top) / rect.height - 0.5;
      }
      /* 타일은 pointer-events:none 인 .drift-wall__inner 를 갖고 있어서
         원본처럼 elementFromPoint → closest 로 집는다 (3D 변환에서도 정확하다). */
      var hit = document.elementFromPoint(e.clientX, e.clientY);
      var tile = hit && hit.closest ? hit.closest('[data-tile-id]') : null;
      if (!tile) return;
      var id = tile.getAttribute('data-tile-id');
      if (id === activeId) return;
      activate(id, Number(tile.getAttribute('data-col')), tile);
    }
    function onEnter() { wallHovered = true; }
    function onLeave() { wallHovered = false; pointer.x = 0; pointer.y = 0; release(); }

    root.addEventListener('pointermove', onPointerMove);
    root.addEventListener('pointerenter', onEnter);
    root.addEventListener('pointerleave', onLeave);

    var ro = new ResizeObserver(function (entries) {
      var h = entries[0].contentRect.height || 600;
      if (Math.abs(h - containerHeight) < 1) return;
      containerHeight = h;
      build();
    });
    ro.observe(root);

    var mq = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq && mq.addEventListener) {
      mq.addEventListener('change', function (e) {
        reduced = e.matches;
        root.classList.toggle('drift-wall--reduced', reduced);
      });
    }

    build();
    applyPlaneTransform(0, 0);
    raf = requestAnimationFrame(animate);

    return {
      /* 타일 목록 교체 — 흐름 위치(offsets)는 살려서 갱신이 튀지 않게 한다 */
      setItems: function (next) {
        items = (next && next.length) ? next.slice() : [];
        build();
      },
      getItems: function () { return items.slice(); },
      destroy: function () {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        ro.disconnect();
        root.removeEventListener('pointermove', onPointerMove);
        root.removeEventListener('pointerenter', onEnter);
        root.removeEventListener('pointerleave', onLeave);
        plane.remove();
        root.classList.remove('drift-wall');
      }
    };
  }

  global.ArgoDriftWall = { create: create };
})(window);
