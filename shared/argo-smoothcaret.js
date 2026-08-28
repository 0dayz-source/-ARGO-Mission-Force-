/* ============================================================================
   SmoothCaret — skiper-ui <skiper106 /> (SmoothInput) 바닐라 이식.
   원본: pnpm dlx shadcn add @skiper-ui/skiper106   (React + framer-motion + dialkit)
   https://skiper-ui.com/v1/skiper106

   원리는 원본 그대로다:
     · 네이티브 캐럿을 감추고(caret-color:transparent)
     · 보이지 않는 '미러' 요소로 캐럿 앞 텍스트의 실제 폭을 재서 좌표를 구하고
     · 커스텀 캐럿을 그 좌표로 스프링(stiffness 500 / damping 30 / mass 0.5) 이동시킨다.
   framer-motion 의 useSpring 대신 같은 물리식을 rAF 로 적분한다.

   원본은 <input> 전용이지만 방명록에는 textarea 도 있어서, 줄바꿈까지 재는
   미러 div 방식으로 확장했다(캐럿 위치에 마커 span 을 넣고 offsetLeft/offsetTop 을 읽는다).

   사용: <input data-smooth-caret> / <textarea data-smooth-caret>
   ============================================================================ */
(function () {
  'use strict';

  /* framer-motion 기본 스프링과 동일 */
  var STIFFNESS = 500, DAMPING = 30, MASS = 0.5;

  var MIRROR_PROPS = [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'letterSpacing', 'lineHeight', 'textTransform', 'textIndent',
    'wordSpacing', 'tabSize', 'textRendering'
  ];

  function makeMirror(el, multiline) {
    var m = document.createElement('div');
    var cs = getComputedStyle(el);
    MIRROR_PROPS.forEach(function (p) { m.style[p] = cs[p]; });
    m.style.position = 'absolute';
    m.style.top = '0';
    m.style.left = '-9999px';
    m.style.visibility = 'hidden';
    m.style.pointerEvents = 'none';
    m.style.overflow = 'hidden';
    m.style.whiteSpace = multiline ? 'pre-wrap' : 'pre';
    m.style.wordWrap = 'break-word';
    m.style.overflowWrap = 'break-word';
    if (!multiline) m.style.width = 'auto';
    document.body.appendChild(m);
    return m;
  }

  function attach(el) {
    if (el.__smoothCaret) return;
    el.__smoothCaret = true;

    var multiline = el.tagName === 'TEXTAREA';
    var mirror = null;

    var caret = document.createElement('div');
    caret.className = 'sc-caret';
    caret.setAttribute('aria-hidden', 'true');
    document.body.appendChild(caret);

    var x = 0, y = 0, vx = 0, vy = 0;      /* 현재 위치·속도 */
    var tx = 0, ty = 0, th = 16;           /* 목표 위치·캐럿 높이 */
    var focused = false, raf = 0, last = 0;

    /* 미러 측정은 값/커서가 바뀔 때만. 매 프레임 다시 재면 강제 리플로가 계속 걸린다.
       화면 위치(rect)와 스크롤만 매 프레임 다시 읽는다 — 페이지가 스크롤될 수 있으므로. */
    var cacheKey = null, offL = 0, offT = 0, cBL = 0, cBT = 0, cBR = 0, cLH = 16;

    function remeasureText() {
      var cs = getComputedStyle(el);
      if (!mirror) mirror = makeMirror(el, multiline);
      else MIRROR_PROPS.forEach(function (p) { mirror.style[p] = cs[p]; });
      if (!multiline) mirror.style.width = 'auto';
      mirror.style.whiteSpace = multiline ? 'pre-wrap' : 'pre';

      var idx = el.selectionStart != null ? el.selectionStart : el.value.length;
      var before = el.value.slice(0, idx);

      mirror.textContent = before;
      var marker = document.createElement('span');
      /* 빈 span 은 높이가 0 이라 offsetTop 이 흔들린다 → zero-width space */
      marker.textContent = '​';
      mirror.appendChild(marker);

      offL = marker.offsetLeft;
      offT = marker.offsetTop;
      cBL = parseFloat(cs.borderLeftWidth) || 0;
      cBT = parseFloat(cs.borderTopWidth) || 0;
      cBR = parseFloat(cs.borderRightWidth) || 0;
      var lh = parseFloat(cs.lineHeight);
      cLH = (!lh || isNaN(lh)) ? (parseFloat(cs.fontSize) || 14) * 1.3 : lh;
    }

    function measure() {
      var i2 = el.selectionStart != null ? el.selectionStart : el.value.length;
      var key = i2 + '|' + el.value;
      if (key !== cacheKey) { cacheKey = key; remeasureText(); }

      var r = el.getBoundingClientRect();
      tx = r.left + cBL + offL - el.scrollLeft;
      ty = r.top + cBT + offT - el.scrollTop;
      th = cLH;

      /* 필드 밖으로 새지 않게 */
      var maxX = r.right - cBR;
      if (tx > maxX) tx = maxX;
      if (tx < r.left) tx = r.left;
    }

    function frame(now) {
      var dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      measure();

      /* 스프링 적분 : a = (-k·(x-target) - c·v) / m */
      var ax = (-STIFFNESS * (x - tx) - DAMPING * vx) / MASS;
      var ay = (-STIFFNESS * (y - ty) - DAMPING * vy) / MASS;
      vx += ax * dt; vy += ay * dt;
      x += vx * dt;  y += vy * dt;

      paint();

      if (focused) raf = requestAnimationFrame(frame);
      else raf = 0;
    }

    function paint() {
      caret.style.transform = 'translate(' + x.toFixed(2) + 'px,' + y.toFixed(2) + 'px)';
      caret.style.height = th.toFixed(1) + 'px';
      /* gooey 잔상 : 이번 프레임의 이동량을 CSS 변수로 넘겨 뒤따르는 블롭이 늘어지게 한다 */
      caret.style.setProperty('--sc-lag-x', (-(tx - x) * 0.55).toFixed(1) + 'px');
      caret.style.setProperty('--sc-lag-y', (-(ty - y) * 0.55).toFixed(1) + 'px');
    }

    function start(snap) {
      measure();
      if (snap) { x = tx; y = ty; vx = vy = 0; }
      /* 첫 프레임을 기다리지 않고 바로 그린다 — 안 그러면 포커스 순간
         캐럿이 (0,0) 이나 직전 위치에서 날아오는 게 보인다. */
      paint();
      caret.classList.add('on');
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
    }

    el.addEventListener('focus', function () {
      focused = true;
      el.classList.add('sc-host');
      start(true);
    });
    el.addEventListener('blur', function () {
      focused = false;
      caret.classList.remove('on');
      el.classList.remove('sc-host');
    });
    /* 입력·이동·스크롤 어디서든 목표가 바뀐다 — 루프가 매 프레임 measure 하므로
       여기서는 포커스 중 루프가 꺼져 있지 않도록만 보장한다. */
    ['input', 'keyup', 'click', 'select', 'scroll'].forEach(function (ev) {
      el.addEventListener(ev, function () { if (focused && !raf) start(false); });
    });

    addEventListener('resize', function () { if (focused) measure(); }, { passive: true });
  }

  function init() {
    document.querySelectorAll('[data-smooth-caret]').forEach(attach);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  window.ArgoSmoothCaret = { attach: attach, refresh: init };
})();
