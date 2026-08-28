/* =====================================================================
   ARGO REVEAL — 화면 전환 와이프
   ref. pnpm dlx shadcn add @skiper-ui/skiper26 · skiper-ui.com/v1/skiper26

   원본은 next-themes 테마 토글이지만 연출의 알맹이는 테마와 무관하다:
     새 화면을 clip-path 로 잘라 들여보내고, 옛 화면은 가만히 밑에 깔아 둔다.

   ── 왜 문서 간 View Transition 을 쓰지 않는가 ─────────────────────────
   처음엔 양쪽 문서에 @view-transition{navigation:auto} 를 걸어 브라우저에
   맡겼다. 그런데 실제로 재 보니 pageswap 이벤트의 viewTransition 이 계속
   null 이었다 — 문서 간 전환은 다음 경우에 '조용히' 건너뛴다.
     · 문서가 보이지 않는 상태(백그라운드 탭)
     · prefers-reduced-motion: reduce
     · 스냅샷을 제때 못 잡는 무거운 페이지
   건너뛰면 아무 예고 없이 화면이 툭 바뀐다(사용자가 본 그 증상).
   그래서 여기서는 내가 직접 그리는 커튼으로 바꿨다. 같은 clip-path 연출을
   쓰되, 어떤 환경에서도 반드시 돈다.

   ── 동작 ─────────────────────────────────────────────────────────────
   leave(url, variant) : 커튼이 닫히며 화면을 덮는다 → 이동
   (도착 문서에서 자동)  : 커튼이 같은 방향으로 이어서 열리며 새 화면을 드러낸다
   두 문서에 걸쳐 하나의 연속된 와이프로 읽힌다.

   to(swap, opt)       : 같은 문서 안 전환. View Transitions API 를 쓴다
                         (같은 문서 전환은 건너뛰어도 즉시 반영이라 안전하다).
   ===================================================================== */
(function (global) {
  'use strict';

  var KEY = 'argoRevealIn';
  var STYLE_ID = 'argo-reveal-styles';
  var BG = '#050406';

  /* variant → [닫힐 때 clip-path from→to, 열릴 때 from→to]
     닫힘의 끝(전체 덮음)과 열림의 시작(전체 덮음)이 같아야 이어져 보인다. */
  var FULL = 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
  var VAR = {
    /* 아래에서 위로 훑고 올라간다 */
    'wipe-up': {
      close: ['polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%)', FULL],
      open:  [FULL, 'polygon(0% 0%, 100% 0%, 100% 0%, 0% 0%)']
    },
    /* 위에서 아래로 */
    'wipe-down': {
      close: ['polygon(0% 0%, 100% 0%, 100% 0%, 0% 0%)', FULL],
      open:  [FULL, 'polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%)']
    },
    /* 가운데에서 원이 자라며 덮고, 다시 원이 줄며 걷힌다 */
    'iris': {
      close: ['circle(0% at 50% 50%)', 'circle(150% at 50% 50%)'],
      open:  ['circle(150% at 50% 50%)', 'circle(0% at 50% 50%)']
    }
  };

  /* skiper26 registry 의 getClipPath() 표 — 원본 값 그대로. */
  var RECT26 = {
    'bottom-up':    ['polygon(0% 100%, 100% 100%, 100% 100%, 0% 100%)', FULL],
    'top-down':     ['polygon(0% 0%, 100% 0%, 100% 0%, 0% 0%)',         FULL],
    'left-right':   ['polygon(0% 0%, 0% 0%, 0% 100%, 0% 100%)',         FULL],
    'right-left':   ['polygon(100% 0%, 100% 0%, 100% 100%, 100% 100%)', FULL],
    'top-left':     ['polygon(0% 0%, 0% 0%, 0% 0%, 0% 0%)',             FULL],
    'top-right':    ['polygon(100% 0%, 100% 0%, 100% 0%, 100% 0%)',     FULL],
    'bottom-left':  ['polygon(0% 100%, 0% 100%, 0% 100%, 0% 100%)',     FULL],
    'bottom-right': ['polygon(100% 100%, 100% 100%, 100% 100%, 100% 100%)', FULL]
  };

  function curtain() {
    var el = document.getElementById('argo-curtain');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'argo-curtain';
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText =
      'position:fixed;inset:0;z-index:2147483646;pointer-events:none;' +
      'background:' + BG + ';will-change:clip-path;';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function animate(el, from, to, ms, done) {
    /* [중요] 커튼에 filter:blur() 를 걸지 않는다.
       화면 전체를 덮는 요소에 필터를 걸면 그 아래 내용이 통째로 필터 레이어로
       래스터라이즈된다. 이 페이지는 WebGL 캔버스가 9개라 그 순간 GPU 가 프레임을
       떨구고, 메인 성운이 툭 사라진 것처럼 보였다(사용자가 본 그 증상).
       skiper26 의 blur 는 View Transition 스냅샷(정지 이미지)에 걸리는 것이라
       살아 있는 캔버스 위에 그대로 옮길 수 없다. 부드러운 가장자리는 mask 로 낸다 —
       mask 는 합성 단계에서 처리돼 아래 내용을 다시 그리지 않는다. */
    el.style.clipPath = from;
    el.style.transition = 'none';
    void el.offsetWidth;                       /* reflow — from 을 확정시킨다 */
    el.style.transition = 'clip-path ' + ms + 'ms cubic-bezier(0.16,1,0.3,1)';
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.style.clipPath = to; });
    });
    /* transitionend 는 탭이 숨으면 오지 않는다 → 타이머로 반드시 마무리한다 */
    setTimeout(function () { el.style.willChange = 'auto'; done(); }, ms + 40);
  }

  /* 나갈 때 : 커튼이 닫히고 나서 이동한다 */
  function leave(url, variant, ms) {
    if (!url) return;
    variant = VAR[variant] ? variant : 'wipe-up';
    ms = ms || 620;

    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { location.href = url; return; }

    try {
      sessionStorage.setItem(KEY, variant);
      sessionStorage.setItem('argoSkipLoader', '1');   /* 메타볼 로더는 뜨지 않게 */
    } catch (e) {}

    var el = curtain();
    var v = VAR[variant];
    animate(el, v.close[0], v.close[1], ms, function () { location.href = url; });
  }

  /* 도착했을 때 : 저장된 variant 로 커튼을 이어서 연다 */
  function arrive() {
    var variant = null;
    try { variant = sessionStorage.getItem(KEY); sessionStorage.removeItem(KEY); } catch (e) {}
    if (!variant || !VAR[variant]) return;

    var el = curtain();
    var v = VAR[variant];
    /* 도착 즉시 '이미 덮인' 상태로 두어 새 페이지가 번쩍 비치지 않게 한다 */
    el.style.clipPath = v.open[0];
    function play() {
      animate(el, v.open[0], v.open[1], 720, function () { el.remove(); });
    }
    if (document.readyState === 'complete') play();
    else addEventListener('load', play, { once: true });
  }

  /* ── 같은 문서 안 전환 (View Transitions API) ───────────────────────
     swap 은 반드시 동기적으로 DOM 을 최종 상태로 바꿔야 한다. rAF 안에서
     클래스를 붙이면 스냅샷이 변경 전 상태로 찍혀 아무 일도 안 일어난다. */
  function css(opt) {
    var ease = 'cubic-bezier(0.16, 1, 0.3, 1)';
    var dur = (opt.duration || 700) + 'ms';

    var from, to;
    if (opt.variant === 'circle') {
      from = 'circle(0% at 50% 50%)'; to = 'circle(150% at 50% 50%)';
    } else {
      /* skiper26 getClipPath() 의 표를 그대로 쓴다 */
      var pair = (RECT26[opt.start] || RECT26['bottom-up']);
      from = pair[0]; to = pair[1];
    }
    var bf = opt.blur ? 'filter:blur(9px);' : '';
    var bt = opt.blur ? 'filter:blur(0px);' : '';
    return [
      '::view-transition-group(root){animation-duration:' + dur + ';animation-timing-function:' + ease + ';}',
      '::view-transition-old(root){animation:none;z-index:-1;}',
      '::view-transition-new(root){animation-name:argoReveal;' + (opt.blur ? 'filter:blur(2px);' : '') + '}',
      '@keyframes argoReveal{',
      '  from{clip-path:' + from + ';' + bf + '}',
      opt.blur ? '  50%{filter:blur(4px);}' : '',
      '  to{clip-path:' + to + ';' + bt + '}',
      '}'
    ].join('\n');
  }

  function inject(text) {
    var el = document.getElementById(STYLE_ID);
    if (!el) { el = document.createElement('style'); el.id = STYLE_ID; document.head.appendChild(el); }
    el.textContent = text;
  }

  function to(swap, opt) {
    opt = opt || {};
    if (typeof swap !== 'function') return;

    /* 콜백은 반드시 한 번만. 아래 안전장치와 겹쳐 두 번 도는 걸 막는다. */
    var ran = false;
    function once() { if (ran) return; ran = true; swap(); }

    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !document.startViewTransition) { once(); return; }

    inject(css(opt));
    try { document.startViewTransition(once); } catch (e) { once(); }

    /* [안전장치] startViewTransition 의 업데이트 콜백은 '렌더 기회' 에 묶여 있다.
       탭이 백그라운드거나 렌더가 눌린 상태에서는 그 기회가 오지 않아 콜백이
       영영 실행되지 않는다 → 버튼을 눌러도 화면이 바뀌지 않는다.
       일정 시간 안에 안 돌면 연출을 포기하고 전환만이라도 반드시 수행한다. */
    setTimeout(once, 400);
  }

  global.ArgoReveal = { to: to, leave: leave, arrive: arrive };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrive);
  else arrive();
})(window);
