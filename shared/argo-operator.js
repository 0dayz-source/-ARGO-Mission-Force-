/* =====================================================================
   TFSC OPERATOR · 07 — 스크롤 연동 안내 (contextual guide)
   ref. string-tune.fiddle.digital 의 '스크롤 도중 안내가 등장하는' 구조.
        캐릭터·문구·그래픽은 복제하지 않았다. ARGO 기관의 항법 AI 로 다시 썼다.

   [무엇이 아닌가] 생성형 챗봇이 아니다. 대화도 하지 않는다.
   섹션 진입에 따라 미리 쓰인 안내가 한 번씩 뜨는 것뿐이다.

   [원칙]
   · 기존 스크롤·3D·평가 로직에 손대지 않는다. 이 파일은 DOM 을 새로 붙이기만 한다.
   · 스크롤을 막지 않는다(모달 아님). 언제든 닫고 계속 볼 수 있다.
   · 같은 메시지는 세션당 한 번만. sessionStorage 로 기억한다.
   · 키보드·focus·aria·prefers-reduced-motion 을 지킨다.
   ===================================================================== */
(function (global) {
  'use strict';

  var ASSESS_URL = 'index.html?goto=assess';
  var CH_MS = 36;   /* 타자 속도 : 글자 하나 찍는 간격(ms). 올릴수록 느려진다 */

  /* 캐릭터 프레임 위치. 이 파일은 루트(11-planet-detail.html)와 pages/ 양쪽에서
     불리므로, 자기 src 를 기준으로 shared/assets/guide/ 를 찾는다. */
  var GUIDE_BASE = (function () {
    var s = document.currentScript;
    if (s && s.src) return s.src.replace(/[?#].*$/, '').replace(/argo-operator\.js$/, 'assets/guide/');
    return 'shared/assets/guide/';
  })();

  /* ---- 말풍선 테두리 : SpecularButton ------------------------------------
     ref. npx shadcn@latest add @react-bits/SpecularButton-JS-CSS
     원본(ogl)의 프래그먼트 셰이더를 그대로 옮겼다 — 둥근 사각형 SDF 를 구하고,
     광원 방향 L 과 테두리 법선이 이루는 각으로 '번쩍이는 구간' 을 잘라낸다.
     빛 각도는 커서를 향하고, 커서가 멀면 천천히 혼자 돈다(원본 followMouse/autoAnimate).
     PAD 만큼 캔버스를 키워 테두리 글로우가 박스 밖으로 번지게 한다. */
  var SPEC_PAD = 20;

  var SPEC_VERT =
    '#version 300 es\nin vec2 position;\nvoid main(){ gl_Position = vec4(position,0.0,1.0); }\n';

  var SPEC_FRAG = [
    '#version 300 es',
    'precision highp float;',
    'uniform vec2 uCenter; uniform vec2 uHalfSize;',
    'uniform float uRadius, uAngle, uPx, uIntensity, uShineSize, uShineFade, uThickness, uBaseWidth;',
    'uniform vec3 uLineColor, uBaseColor;',
    'out vec4 fragColor;',
    'float sdRoundedRect(vec2 p, vec2 b, float r){',
    '  vec2 q = abs(p) - b + r;',
    '  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;',
    '}',
    'float gaussianLine(float d, float sigma){',
    '  float x = d / (sigma + 1e-6);',
    '  float k = mix(1.0, 1.6, smoothstep(0.0, 1.5, x));',
    '  return exp(-k * x * x);',
    '}',
    'void main(){',
    '  vec2 p = gl_FragCoord.xy - uCenter;',
    '  float d = sdRoundedRect(p, uHalfSize, uRadius);',
    '  vec2 L = vec2(cos(uAngle), sin(uAngle));',
    /* 테두리에 붙는 어두운 밑선 — 두께감을 준다 */
    '  float base = (1.0 - smoothstep(0.0, uBaseWidth, abs(d))) * 0.45;',
    /* 광원을 향한 쪽과 등진 쪽 양쪽에 대칭으로 줄무늬가 걸린다 */
    '  vec2 nEll = normalize(p / (uHalfSize * uHalfSize) + 1e-6);',
    '  float phi = acos(clamp(abs(dot(nEll, L)), 0.0, 1.0));',
    '  float rim = 1.0 - smoothstep(uShineSize - uShineFade, uShineSize + uShineFade + 1e-4, phi);',
    '  float line = gaussianLine(d, uThickness);',
    '  float edgeClamp = 1.0 - smoothstep(0.5 * uPx, 3.0 * uPx, abs(d));',
    '  float hi = line * rim * edgeClamp * uIntensity;',
    '  vec3 col = uBaseColor * base + uLineColor * hi;',
    '  float a = clamp(base + hi, 0.0, 1.0);',
    '  fragColor = vec4(col, a);',
    '}'
  ].join('\n');

  function mountSpecular(host, panel) {
    if (!host || !panel) return null;
    var canvas = document.createElement('canvas');
    var gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) { host.classList.add('op-spec-fallback'); return null; }

    function sh(t, src) {
      var o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o);
      return gl.getShaderParameter(o, gl.COMPILE_STATUS) ? o : null;
    }
    var vs = sh(gl.VERTEX_SHADER, SPEC_VERT), fs = sh(gl.FRAGMENT_SHADER, SPEC_FRAG);
    if (!vs || !fs) { host.classList.add('op-spec-fallback'); return null; }
    var pr = gl.createProgram();
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { host.classList.add('op-spec-fallback'); return null; }
    gl.useProgram(pr);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(pr, 'position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    function U(n) { return gl.getUniformLocation(pr, n); }
    var uCenter = U('uCenter'), uHalf = U('uHalfSize'), uAngle = U('uAngle');
    var dpr = Math.min(devicePixelRatio || 1, 2);
    /* 원본 기본값 — 색만 ARGO 코랄로 바꾼다(원본은 흰빛 + 회색 밑선) */
    gl.uniform1f(U('uPx'), dpr);
    gl.uniform1f(U('uBaseWidth'), dpr);
    gl.uniform1f(U('uRadius'), 30 * dpr);
    gl.uniform1f(U('uIntensity'), 1.0);
    gl.uniform1f(U('uShineSize'), 0.17);
    gl.uniform1f(U('uShineFade'), 0.7);
    gl.uniform1f(U('uThickness'), 1.0 * dpr);
    gl.uniform3f(U('uLineColor'), 1.0, 0.86, 0.84);   /* 흰빛에 코랄기 */
    gl.uniform3f(U('uBaseColor'), 0.42, 0.24, 0.24);  /* 어두운 코랄 밑선 */

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    var reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
    var w = 1, h = 1, raf = 0;
    function resize() {
      var r = panel.getBoundingClientRect();
      if (!r.width || !r.height) return;
      w = r.width; h = r.height;
      canvas.width  = Math.max(1, Math.round((w + SPEC_PAD * 2) * dpr));
      canvas.height = Math.max(1, Math.round((h + SPEC_PAD * 2) * dpr));
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uCenter, (SPEC_PAD + w / 2) * dpr, (SPEC_PAD + h / 2) * dpr);
      gl.uniform2f(uHalf, (w / 2) * dpr, (h / 2) * dpr);
    }

    /* 빛 각도 — 커서 쪽을 향한다. 커서가 멀면 천천히 혼자 돈다(원본 speed 0.35). */
    var pointerAngle = null, angle = 2.4, idleAngle = 2.4, last = performance.now();
    addEventListener('pointermove', function (e) {
      var r = panel.getBoundingClientRect();
      if (!r.width) return;
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      pointerAngle = Math.atan2(cy - e.clientY, e.clientX - cx);
      /* 꼬리 원(.op-tail)은 CSS 그라디언트라 셰이더를 못 쓴다 — 같은 광원 각도를
         변수로 넘겨 준다. CSS 각도는 시계방향·12시 기준이라 축을 맞춰 변환한다. */
      var host = panel.parentElement;
      if (host) host.style.setProperty('--op-ang', (90 - pointerAngle * 180 / Math.PI).toFixed(1) + 'deg');
    }, { passive: true });

    function frame(now) {
      var dt = Math.min((now - last) / 1000, 0.05); last = now;
      idleAngle += 0.35 * dt;
      var target = pointerAngle != null ? pointerAngle : idleAngle;
      var diff = ((target - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      angle += diff * (1 - Math.exp(-dt * 7));   /* 원본과 같은 지수 추종 */
      gl.uniform1f(uAngle, angle);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(frame);
    }

    host.appendChild(canvas);
    resize();
    new ResizeObserver(resize).observe(panel);
    addEventListener('resize', resize, { passive: true });

    return {
      start: function () {
        if (raf) return;
        resize();
        if (reduce) { gl.uniform1f(uAngle, 2.4); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3); return; }
        last = performance.now();
        raf = requestAnimationFrame(frame);
      },
      stop: function () { if (raf) cancelAnimationFrame(raf); raf = 0; }
    };
  }


  /* 평가로 이동 — 기존 전환 로직을 그대로 쓴다(새 경로를 만들지 않는다) */
  /* [수정] skipLoader(두 번째 인자)를 넘기면 도착 페이지가 로더를 통째로 건너뛴다.
     그러면 떠나는 쪽 페이드인(420ms)만 보이고 끝나 로딩화면이 번쩍하고 사라진다.
     원래 의도는 View Transition 과 겹치지 않게 하려던 것인데 이 프로젝트엔
     @view-transition 선언이 없다 — 그냥 정상 전환(2초)을 쓴다. */
  function toAssessment() {
    /* [추적] MARS → 시험 이동. 하드 페이지 이동이라 page_exited 는 다음 로드에서 보완된다. */
    try{ if (global.ArgoTrack) global.ArgoTrack.act('navigation_clicked',
      { page:'mars', from_page:'mars', to_page:'assessment', navigation_type:'normal_next', button_id:'operator_next' }); }catch(e){}
    if (global.argoGoto) global.argoGoto(ASSESS_URL);
    else location.href = ASSESS_URL;
  }

  /* 첫 안내의 SKIP 은 평가로 바로 건너뛰는 게 아니라 이 페이지의 마지막 화면(.pd-cta)으로
     내려간다 — 거기서 NEXT 로 평가에 들어가면 된다(요청). */
  function toLastSection() {
    var el = document.querySelector('.pd-cta');
    if (!el) { toAssessment(); return; }
    /* 이 페이지는 휠을 가로채는 커스텀 관성 스크롤을 쓴다. scrollIntoView 만으로는
       중간에 멈추는 경우가 있어, 좌표를 직접 구해 스크롤하고 끝에서 한 번 더 못박는다. */
    var y = el.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop || 0);
    var max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    if (y > max) y = max;
    /* 이 페이지의 커스텀 관성 스크롤러가 있으면 반드시 그쪽으로 넘긴다 —
       window.scrollTo 로 움직이면 스크롤러의 target 이 옛 위치라 되돌아온다. */
    if (typeof window.__argoScrollTo === 'function') { window.__argoScrollTo(y); return; }
    try { window.scrollTo({ top: y, behavior: 'smooth' }); }
    catch (e) { window.scrollTo(0, y); }
  }


  /* ---- 메시지 정의 ---------------------------------------------------- */
  /* ---- 구간별 안내 ----------------------------------------------------
     섹션 이름은 사용자가 부른 대로 매핑했다(문서 순서가 아니라 '어떤 구간이냐' 기준).
       protocol : 촬영 사전 안내 (#pre-capture) — 여기서부터 챗이 등장한다
       stack    : 화성 data stack (.pd-tele)
       capture  : 후보자 촬영 (.pd-scan)
       done     : 마지막 (.pd-cta) */
  function messages(api) {
    return {
      protocol: {
        text: '후보자님, 화성 정착 기록 열람을 시작합니다.\n' +
              '시간이 부족한 경우 스킵할 수 있습니다.',
        actions: [
          { label: 'CONTINUE', kind: 'primary', act: function () { api.dismiss(); } },
          { label: 'SKIP', kind: 'ghost', act: function () {
              try{ if (global.ArgoTrack) global.ArgoTrack.act('skip_clicked',
                { page:'mars', from_page:'mars', to_page:'mars_cta', skip_type:'operator_intro',
                  navigation_type:'skip', button_id:'operator_skip' }); }catch(e){}
              api.dismiss(); toLastSection(); } }
        ]
      },
      capture: {
        text: '신원 이미지가 확인되었습니다.\n' +
              '기록은 게늄 데이터로 변환되어 아카이브에 보관됩니다.',
        actions: [
          /* 첫 말풍선(protocol)만 코랄을 쓴다 — 나머지는 투명 */
          { label: 'CONTINUE', kind: 'ghost', act: function () { api.dismiss(); } }
        ]
      },
      done: {
        text: '화성 정착 기록 열람과 후보자 등록이 완료되었습니다.\n' +
              '이제 심리 소양 및 적응 가능성 평가를 시작합니다.',
        actions: [
          { label: 'NEXT →', kind: 'ghost final', act: toAssessment }
        ]
      },
      menu: {
        text: 'TFSC 항법 보조입니다. 무엇을 도와드릴까요?',
        actions: [
          { label: 'CONTINUE', kind: 'ghost', act: function () { api.dismiss(); } },
          { label: 'SKIP', kind: 'ghost', act: function () {
              try{ if (global.ArgoTrack) global.ArgoTrack.act('skip_clicked',
                { page:'mars', from_page:'mars', to_page:'assessment', skip_type:'operator_to_assessment',
                  navigation_type:'skip', button_id:'operator_skip_assess' }); }catch(e){}
              toAssessment(); } }
        ]
      }
    };
  }

  function init() {
    if (document.getElementById('argo-operator')) return;

    var root = document.createElement('div');
    root.className = 'op-root';
    root.id = 'argo-operator';
    root.innerHTML =
      '<div class="op-panel" role="dialog" aria-live="polite" aria-label="TFSC OPERATOR 07 안내">' +
        /* 테두리 — ref. npx shadcn@latest add @react-bits/SpecularButton-JS-CSS
           [교체] 예전엔 Aceternity Moving Border(빛 점 하나가 사각 경로를 도는 방식)였다.
           SpecularButton 은 둥근 사각형 SDF 위에서 '광원 각도' 를 따라 테두리가
           번쩍이는 방식이라 말풍선 전체가 유리처럼 읽힌다.
           원본은 ogl 을 쓰지만 이 프로젝트 방식대로 프래그먼트 셰이더만 옮겨
           WebGL2 로 직접 띄운다(ogl·React 를 새로 붙이지 않는다). */
        '<span class="op-spec" aria-hidden="true"></span>' +
        '<div class="op-panel-in">' +
          '<p class="op-msg"></p>' +
          '<div class="op-actions"></div>' +
        '</div>' +
        /* 말풍선 꼬리 — 삼각형 대신 점점 작아지는 원 두 개(만화 말풍선 방식).
           캐릭터 쪽으로 대각선으로 내려간다. 테두리 빛은 커서 방향(--op-ang)을 따른다. */
        '<i class="op-tail op-tail-1" aria-hidden="true"></i>' +
        '<i class="op-tail op-tail-2" aria-hidden="true"></i>' +
      '</div>' +
      /* 캐릭터 — 픽셀아트 3프레임(idle / float / scan)을 순환시킨다.
         ref. string-tune.fiddle.digital 의 '안내 캐릭터가 제자리에서 계속 움직이는' 인상.
         스프라이트 애니메이션이라 크로스페이드 없이 딱딱 끊어 넘긴다(픽셀아트의 결). */
      '<button class="op-guide" type="button" aria-label="TFSC OPERATOR 07 안내 열기">' +
        '<span class="op-guide-stage">' +
          '<img class="op-f op-f1" src="' + GUIDE_BASE + 'operator-07-v3-01-idle.svg"  alt="" draggable="false">' +
          '<img class="op-f op-f2" src="' + GUIDE_BASE + 'operator-07-v3-02-transmit.svg" alt="" draggable="false">' +
          '<img class="op-f op-f3" src="' + GUIDE_BASE + 'operator-07-v3-03-authorize.svg"  alt="" draggable="false">' +
        '</span>' +
        '<span class="op-guide-tag">OPERATOR·07</span>' +
      '</button>';
    document.body.appendChild(root);

    var panel   = root.querySelector('.op-panel');
    var msgEl   = root.querySelector('.op-msg');
    var actsEl  = root.querySelector('.op-actions');
    var orbBtn  = root.querySelector('.op-guide');
    var talkT = null, typeT = null, btnT = null;

    var spec = mountSpecular(root.querySelector('.op-spec'), panel);

    var api = {
      open: open, close: close, show: show
    };
    var MSG = messages(api);

    function close() {
      root.classList.remove('is-open');
      document.body.classList.remove('op-active');
      mbStop();
      panel.setAttribute('aria-hidden', 'true');
      orbBtn.setAttribute('aria-expanded', 'false');
      orbBtn.focus({ preventScroll: true });
    }
    function open() {
      root.classList.add('is-open');
      document.body.classList.add('op-active');
      mbStart();
      panel.removeAttribute('aria-hidden');
      orbBtn.setAttribute('aria-expanded', 'true');
    }

    /* 오브가 먼저 활성화되고, 대화창이 약간 늦게 열린다 */
    function show(key) {
      var m = MSG[key];
      if (!m) return;
      /* 타자 효과 — 글자를 하나씩 켠다. 캐럿(커서 막대)은 두지 않는다(요청).
         글자를 미리 다 심어 두고 opacity 만 켜므로 줄바꿈이 도중에 흔들리지 않는다. */
      clearTimeout(typeT);
      clearTimeout(btnT);
      root.classList.remove('is-typed');   /* 버튼은 타자가 끝난 뒤에 올라온다 */
      msgEl.innerHTML = '';
      var chEls = [];
      m.text.split('\n').forEach(function (line) {
        var row = document.createElement('span');
        if (!line) { row.className = 'op-gap'; msgEl.appendChild(row); return; }
        line.split('').forEach(function (c) {
          var ch = document.createElement('span');
          ch.className = 'op-ch';
          ch.textContent = c;
          row.appendChild(ch);
          chEls.push(ch);
        });
        msgEl.appendChild(row);
      });
      if (matchMedia('(prefers-reduced-motion:reduce)').matches || !chEls.length) {
        chEls.forEach(function (c) { c.classList.add('on'); });
        root.classList.add('is-typed');
      } else {
        var ti = 0;
        (function type() {
          /* [수정] 16ms 에 두 글자(=초당 125자)는 60자 문구가 0.5초에 끝나 타자로 안 보였다.
             한 글자씩 CH_MS 간격 — 초당 약 28자, 읽으면서 따라올 수 있는 속도다. */
          chEls[ti++].classList.add('on');
          if (ti < chEls.length) typeT = setTimeout(type, CH_MS);
          else root.classList.add('is-typed');   /* 다 써지면 버튼이 올라온다 */
        })();
      }
      actsEl.innerHTML = '';
      m.actions.forEach(function (a) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'op-btn ' + (a.kind.indexOf('primary') >= 0 ? 'op-btn-primary' : 'op-btn-ghost') +
                      (a.kind.indexOf('final') >= 0 ? ' op-btn-final' : '');
        b.textContent = a.label;
        b.addEventListener('click', a.act);
        actsEl.appendChild(b);
      });

      /* [안전망] 배경 탭에서는 브라우저가 연쇄 setTimeout 을 1초로 묶어 버려
         타자가 몇십 초씩 걸린다. 그동안 버튼이 잠겨 있으면 안 되므로
         예상 소요시간 + 여유를 넘기면 강제로 올린다. */
      clearTimeout(btnT);
      btnT = setTimeout(function () { root.classList.add('is-typed'); },
                        chEls.length * CH_MS + 1500);

      root.classList.add('is-talking');
      clearTimeout(talkT);
      /* '말하는 중' 표시는 타자가 끝날 때까지 간다 — 고정 1800ms 로 두면
         문구가 길 때 아직 찍히고 있는데 오브가 먼저 잠잠해진다. */
      talkT = setTimeout(function () { root.classList.remove('is-talking'); },
                         Math.max(1800, chEls.length * CH_MS + 500));

      var reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
      setTimeout(open, reduce ? 0 : 260);   /* 오브 → 대화창 시차 */
    }

    orbBtn.setAttribute('aria-expanded', 'false');
    panel.setAttribute('aria-hidden', 'true');
    orbBtn.addEventListener('click', function () {
      if (root.classList.contains('is-open')) { manual = false; close(); }
      else if (current) { manual = false; show(current); }   /* 이 구간 안내를 다시 */
      else { manual = true; show('menu'); }
    });

    /* 테두리 빛은 SpecularButton(mountSpecular)이 전담한다.
       예전 Moving Border(getPointAtLength 로 점을 돌리던 코드)는 제거했다. */
    function mbStart() { if (spec) spec.start(); }
    function mbStop()  { if (spec) spec.stop(); }

    /* ---- 스크롤 구동 ---------------------------------------------------
       [구조 변경] 이제 '섹션에 들어오면 열고 버튼으로 닫는' 방식이 아니다.
       채팅창이 켜져 있는 게 기본이고, 스크롤 위치가 문구를 바꾼다.
       안내가 필요 없는 구간에서는 통째로 쏙 내려갔다가(is-hidden),
       필요한 구간에 오면 다시 쏙 올라온다(StringTune 이 하는 방식).

       구간은 화면 중앙선이 어느 섹션 위에 있는지로 정한다 —
       IntersectionObserver 보다 '지금 어디를 보고 있나' 를 정확히 짚는다. */
    var ZONES = [
      { sel: '#pre-capture', key: 'protocol' },   /* 여기서부터 챗이 등장한다 */
      { sel: '.pd-scan',     key: 'capture', needsShot: true },
      { sel: '.pd-cta',      key: 'done' }
    ];
    ZONES.forEach(function (z) { z.el = document.querySelector(z.sel); });

    /* 웹캠 구간은 '실제로 촬영했을 때' 만 말을 건다 */
    var shotTaken = false;
    addEventListener('argo:capture', function () {
      shotTaken = true;
      resolve(true);            /* 촬영 직후 바로 반영 */
    });

    var current = null, manual = false, dismissed = null;

    function hidePod() {
      document.body.classList.remove('op-visible');
      /* [부드럽게] is-open 을 같이 떼면 말풍선이 자기 축소 애니메이션을 동시에 돌려
         '스르륵 내려간다' 가 아니라 '툭 사라진다' 로 보인다.
         내용은 열린 채로 두고, 껍데기(root)만 아래로 미끄러뜨린다. */
      root.classList.add('is-hidden');
      document.body.classList.remove('op-active');
    }
    /* [수정] op-active 는 '패널이 열렸을 때' 만 붙어서, 말풍선이 닫힌 채
       오브만 떠 있을 때는 커스텀 커서가 오브 밑으로 숨었다.
       포드가 보이는 동안 계속 커서를 위로 올린다. */
    function showPod() {
      root.classList.remove('is-hidden');
      document.body.classList.add('op-visible');
    }

    /* 지금 화면 중앙이 걸친 구간을 찾는다 */
    function activeZone() {
      var mid = innerHeight * 0.5, found = null;
      ZONES.forEach(function (z) {
        if (!z.el) return;
        var r = z.el.getBoundingClientRect();
        if (r.top <= mid && r.bottom >= mid) found = z;   /* 뒤쪽 우선 */
      });
      return found;
    }

    function resolve(force) {
      if (manual) return;                       /* 메뉴를 직접 열어 둔 동안은 건드리지 않는다 */
      var z = activeZone();
      /* 안내가 없는 구간 → 쏙 사라진다 */
      if (!z) { current = null; dismissed = null; hidePod(); return; }
      /* 촬영 전 웹캠 구간도 안내가 없다 */
      if (z.needsShot && !shotTaken) { current = null; dismissed = null; hidePod(); return; }
      /* CONTINUE 로 내보낸 구간에서는 다시 올라오지 않는다 — 구간을 벗어나면 풀린다 */
      if (dismissed === z.key) { current = z.key; return; }
      dismissed = null;
      showPod();
      if (z.key === current && !force) return;  /* 같은 구간이면 다시 열지 않는다 */
      current = z.key;
      show(z.key);
    }

    /* [스로틀] rAF 로 묶으면 프레임이 눌린 환경(백그라운드 탭·저사양)에서
       콜백이 영영 안 돌아 구간 판정이 멈춘다. 시간 기준으로 바꾼다. */
    var lastRun = 0, pend = null;
    addEventListener('scroll', function () {
      var now = Date.now();
      if (now - lastRun > 90) { lastRun = now; resolve(false); return; }
      clearTimeout(pend);
      pend = setTimeout(function () { lastRun = Date.now(); resolve(false); }, 100);
    }, { passive: true });
    addEventListener('resize', function () { resolve(true); }, { passive: true });

    hidePod();                    /* 히어로에서는 보이지 않는다 */
    setTimeout(function () { resolve(true); }, 900);

    /* [CONTINUE] 말풍선만 접으면 캐릭터가 남아 "닫았는데 안 사라진다" 가 된다.
       패널을 먼저 접고(180ms), 그게 캐릭터 쪽으로 빨려 들어간 뒤에 포드를 내린다 —
       들어올 때와 같은 길, 역순. */
    api.dismiss = function () {
      manual = false;
      dismissed = current;
      close();
      var reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
      setTimeout(hidePod, reduce ? 0 : 150);
    };
    api.resolve = function () { resolve(true); };
    api.zone = function () { var z = activeZone(); return z ? z.key : null; };
    global.ArgoOperator = api;
  }

  /* [중요] DOMContentLoaded 를 기다리지 않는다.
     이 페이지는 three·model-viewer 를 unpkg 에서 받는데, 그 응답이 늦으면
     readyState 가 'loading' 에 머물러 DOMContentLoaded 가 영영 안 떨어진다.
     그러면 안내가 통째로 뜨지 않는다(실제로 그렇게 멈춰 있었다).
     이 스크립트는 </body> 직전에 있으므로 body 는 이미 있다 — 바로 붙인다. */
  /* 경고 오버레이(shared/argo-warn.js)가 같은 테두리 빛을 쓰도록 내보낸다.
     말풍선 생김새를 두 벌로 관리하지 않기 위해서다 — 여기가 유일한 출처다. */
  global.ArgoOperatorSpec = mountSpecular;

  function boot() {
    if (!document.body) { setTimeout(boot, 20); return; }
    init();
  }
  boot();
})(window);
