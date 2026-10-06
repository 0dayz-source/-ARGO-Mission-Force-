/* =====================================================================
   ARGO — SESSION CONTROL 무활동 경고 : OPERATOR·07 챗봇 (표시 전담)

   MARS 의 안내 챗봇(argo-operator)과 같은 말풍선·같은 꼬리·같은 캐릭터·같은
   등장 곡선으로 화면 중앙에 뜬다. 생김새는 argo-operator.css 가 유일한 출처다 —
   여기서 상자를 다시 그리지 않는다(그렇게 했다가 전혀 다른 상자가 됐다).

   [역할 경계] 이 파일은 화면만 그린다.
   · 남은 시간을 세어 보여 주고, 눌린 곳에 따라 콜백 하나를 올려 준다.
   · 세션을 만들거나 끝내지 않는다. 90초/120초 판정과 종료는 shared/argo-track.js
     의 타이머 하나가 계속 쥔다 — 타이머를 양쪽에 두면 둘이 어긋나 두 번 종료된다.

   [두 갈래] 이 물음으로 '같은 사람인지' 를 가른다.
     화면 클릭  → onKeep : 기존 후보자가 계속 본다  → 세션 연장
     하단 버튼  → onNew  : 새 관람객이다           → 지금 정리하고 처음으로

   [페이지마다 하나] 자기 문서에 자기 오버레이를 만든다. MARS 의 스크롤 안내 챗봇과는
   서로 건드리지 않는다 — 그쪽 위치·상태를 뺏지 않기 위해서다.

   [정확도] 카운트다운과 진행 바는 '1초씩 깎기'가 아니라, 매 tick 마다 절대
   마감시각에서 performance.now() 를 빼서 남은 시간을 다시 구한다. tick 이 밀려도
   누적 오차가 생기지 않는다.
   ===================================================================== */
(function (global) {
  'use strict';

  /* 캐릭터 프레임 위치 — 자기 src 기준(argo-operator 와 같은 규칙) */
  var GUIDE_BASE = (function () {
    var sc = document.currentScript;
    if (sc && sc.src) return sc.src.replace(/[?#].*$/, '').replace(/argo-warn\.js$/, 'assets/guide/');
    return 'shared/assets/guide/';
  })();

  var root = null, panelEl = null, countEl = null, barEl = null, actEl = null;
  var spec = null, tick = 0, endAt = 0, spanMs = 1, tileEls = [];
  var onKeep = null, onNew = null, outT = null, lastTxt = '';

  function build() {
    if (root) return root;
    root = document.createElement('div');
    /* op-root 를 함께 붙인다 — 말풍선/꼬리/캐릭터의 전환 규칙을 그대로 받는다.
       is-open  : 말풍선이 펴진 상태
       is-typed : 챗봇은 타자가 끝나야 버튼을 올린다. 여기는 타자 효과가 없으므로
                  처음부터 붙여 둔다(안 붙이면 .op-actions 가 opacity:0 이라 버튼이 안 보인다). */
    root.className = 'aw-root op-root is-open is-typed';
    root.id = 'argo-session-warn';
    root.setAttribute('role', 'alertdialog');
    root.setAttribute('aria-live', 'assertive');
    root.setAttribute('aria-label', 'SESSION LINK UNSTABLE');
    root.innerHTML =
      '<div class="aw-stack">' +
        /* 채팅창 — 마크업 구조도 챗봇과 같다(op-panel > op-spec + op-panel-in + op-tail) */
        '<div class="op-panel">' +
          '<span class="op-spec" aria-hidden="true"></span>' +
          '<div class="op-panel-in">' +
            '<p class="aw-label"><i class="aw-dot" aria-hidden="true"></i>TFSC · SESSION CONTROL</p>' +
            /* 다이얼 타이머 — 남은 시간을 링 하나로 읽는다.
               큰 숫자 + 별도 진행 바 두 벌이던 것을 하나로 합쳤다(요소는 자리값을 해야 한다). */
            '<div class="aw-row">' +
              /* 자릿수 타일 카운트다운 — 숫자가 바뀔 때만 그 자리가 굴러간다.
                 ref. 21st.dev/r/nexus-ui/animated-countdown 의 타일+라벨 구조. */
              '<div class="aw-clock" aria-hidden="true">' +
                '<div class="aw-tiles">' +
                  '<div class="aw-tile"><span class="aw-d">3</span></div>' +
                  '<div class="aw-tile"><span class="aw-d">0</span></div>' +
                '</div>' +
                '<span class="aw-unit">SECONDS</span>' +
              '</div>' +
              '<div class="aw-row-txt">' +
                '<p class="aw-title">SESSION LINK UNSTABLE</p>' +
                '<p class="aw-help">기존 후보자라면 <b>화면을 클릭</b>하세요.<br>' +
                  '새로 오셨다면 아래 버튼을 눌러 주세요.</p>' +
              '</div>' +
            '</div>' +
            '<div class="op-actions">' +
              '<button class="op-btn op-btn-ghost aw-act" type="button">새 후보자로 시작</button>' +
            '</div>' +
          '</div>' +
          '<i class="op-tail op-tail-1" aria-hidden="true"></i>' +
          '<i class="op-tail op-tail-2" aria-hidden="true"></i>' +
        '</div>' +
        /* OPERATOR·07 — MARS 챗봇과 같은 픽셀아트 3프레임 */
        '<button class="op-guide" type="button" tabindex="-1" aria-hidden="true">' +
          '<span class="op-guide-stage">' +
            '<img class="op-f op-f1" src="' + GUIDE_BASE + 'operator-07-v3-01-idle.svg" alt="" draggable="false">' +
            '<img class="op-f op-f2" src="' + GUIDE_BASE + 'operator-07-v3-02-transmit.svg" alt="" draggable="false">' +
            '<img class="op-f op-f3" src="' + GUIDE_BASE + 'operator-07-v3-03-authorize.svg" alt="" draggable="false">' +
          '</span>' +
          '<span class="op-guide-tag">OPERATOR·07</span>' +
        '</button>' +
      '</div>';
    document.body.appendChild(root);
    panelEl = root.querySelector('.op-panel');
    tileEls = [].slice.call(root.querySelectorAll('.aw-tile'));
    actEl   = root.querySelector('.aw-act');

    /* 테두리 빛 — 챗봇과 같은 SpecularButton. argo-operator.js 가 있는 페이지에서만
       붙고, 없으면 유리면만 남는다(테두리를 따로 그리지 않는다). */
    try {
      if (typeof global.ArgoOperatorSpec === 'function') {
        spec = global.ArgoOperatorSpec(root.querySelector('.op-spec'), panelEl);
      }
    } catch (e) { spec = null; }

    /* [중복 방지] 리스너는 여기서 딱 한 번만 붙는다. show() 를 몇 번 부르든 늘어나지 않는다. */
    /* 새 관람객 — pointerdown 에서 잡고 전파를 끊는다. 안 끊으면 아래 root 핸들러가
       먼저 '연장' 으로 처리해 버린다(pointerdown 이 click 보다 먼저 온다). */
    actEl.addEventListener('pointerdown', function (e) { e.stopPropagation(); fire('new'); });
    actEl.addEventListener('click',       function (e) { e.stopPropagation(); fire('new'); });
    /* 기존 후보자 — 화면 아무 데나 */
    root.addEventListener('pointerdown', function () { fire('keep'); });
    return root;
  }

  /* 콜백을 먼저 비우고 부른다 — pointerdown 과 click 이 겹쳐 두 번 들어와도
     실제 경로는 한 번만 탄다. */
  function fire(kind) {
    var k = onKeep, n = onNew;
    onKeep = null; onNew = null;
    if (kind === 'new') { if (typeof n === 'function') { n(); return; } }
    else if (typeof k === 'function') { k(); return; }
    hide();
  }

  /* 한 자리를 굴린다. 바뀐 자리만 움직여야 시선이 그 자리로 간다 —
     두 자리가 같이 튀면 무엇이 변했는지 안 보인다. */
  function rollTile(tile, ch) {
    var cur = tile.querySelector('.aw-d:not(.is-out)');
    if (!cur || cur.textContent === ch) return;
    cur.classList.add('is-out');
    cur.addEventListener('animationend', function () { if (cur.parentNode) cur.parentNode.removeChild(cur); });
    var next = document.createElement('span');
    next.className = 'aw-d is-in';
    next.textContent = ch;
    tile.appendChild(next);
    /* 들어온 뒤에는 애니메이션 클래스를 떼어 다음 교체가 처음부터 다시 돌게 한다 */
    next.addEventListener('animationend', function () { next.classList.remove('is-in'); });
  }

  function sec0(ms) { return Math.ceil(ms / 1000); }

  function frame() {
    var left = endAt - performance.now();
    if (left < 0) left = 0;
    /* 초 단위로만 바뀐다 — 매 tick DOM 을 건드리지 않는다. */
    var sec = Math.ceil(left / 1000);
    var txt = (sec < 10 ? '0' : '') + sec;
    if (txt !== lastTxt) {
      rollTile(tileEls[0], txt.charAt(0));
      rollTile(tileEls[1], txt.charAt(1));
      lastTxt = txt;
    }
    if (left <= 0) { clearInterval(tick); tick = 0; }
  }

  /* opts : { ms:남은 시간(ms), onKeep:연장 콜백, onNew:새 관람객 콜백 } */
  function show(opts) {
    opts = opts || {};
    build();
    clearTimeout(outT);
    onKeep = typeof opts.onKeep === 'function' ? opts.onKeep : null;
    onNew  = typeof opts.onNew  === 'function' ? opts.onNew  : null;
    spanMs = Math.max(1, opts.ms || 30000);
    endAt  = performance.now() + spanMs;
    /* 처음 뜰 때는 굴리지 않는다 — 등장과 롤이 겹치면 지저분하다. 값만 맞춘다. */
    var first = (sec0(spanMs) < 10 ? '0' : '') + sec0(spanMs);
    tileEls.forEach(function (t, i) {
      t.innerHTML = '<span class="aw-d">' + first.charAt(i) + '</span>';
    });
    lastTxt = first;
    root.classList.remove('is-out');
    /* 이미 떠 있으면 다시 열지 않는다 — 등장 모션이 되감기지 않게. */
    if (!root.classList.contains('is-on')) {
      /* 시작 상태를 확정시킨 뒤 클래스를 준다.
         [주의] rAF 로 미루면 안 된다 — 배경 탭에서 rAF 가 멈춰 경고가 안 뜬다.
         강제 리플로로 같은 효과를 동기적으로 얻는다. */
      void root.offsetWidth;
      root.classList.add('is-on');
    }
    document.body.classList.add('aw-open');   /* 커서를 오버레이 위로 (CSS 참고) */
    if (spec) { try { spec.start(); } catch (e) {} }
    frame();
    clearInterval(tick);
    tick = setInterval(frame, 100);
  }

  function hide() {
    if (!root || !root.classList.contains('is-on')) return;
    onKeep = null; onNew = null;
    clearInterval(tick); tick = 0;
    if (spec) { try { spec.stop(); } catch (e) {} }
    root.classList.add('is-out');
    root.classList.remove('is-on');
    document.body.classList.remove('aw-open');
    clearTimeout(outT);
    outT = setTimeout(function () { root.classList.remove('is-out'); }, 260);
  }

  global.ArgoWarn = {
    show: show,
    hide: hide,
    isOpen: function () { return !!(root && root.classList.contains('is-on')); }
  };

  /* ---- 개발용 미리보기 ------------------------------------------------
     ?argoWarningPreview=1 로 열면 90초를 기다리지 않고 바로 확인할 수 있다.
     localhost / 127.0.0.1 에서만 동작한다 — 배포 도메인에서는 주소에 붙어 있어도 무시된다.
     세션·Supabase 요청·이벤트·종료·상태 초기화는 일절 하지 않는다. 눌러도 닫히기만 한다. */
  function isLocal() {
    var h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
  }
  function previewRequested() {
    try { return new URLSearchParams(location.search).get('argoWarningPreview') === '1'; }
    catch (e) { return false; }
  }
  function boot() {
    if (!document.body) { setTimeout(boot, 20); return; }
    if (!isLocal() || !previewRequested()) return;
    show({ ms: 30000, onKeep: hide, onNew: hide });   /* 닫기만 — 부작용 없음 */
    try { console.info('[ArgoWarn] preview mode — 세션/DB/이벤트 없음'); } catch (e) {}
  }
  boot();
})(window);
