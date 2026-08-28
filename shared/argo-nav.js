/* ============================================================================
   ARGO — page transition between index.html and 11-planet-detail.html.

   로딩/전환 화면 = 검정 배경 + 코드 레인(ref. activetheory.net 로딩 화면).
   ogl 의존성 없이 원본의 vertex/fragment 셰이더와 볼 파라미터 계산(hash31/hash33)을
   그대로 옮겨 raw WebGL2 로 그린다. 프리셋:
     cursorBallSize 2 · ballCount 17 · animationSize 44 · clumpFactor 1.1
     speed 0.7 · hoverSmoothness 0.05 · enableMouseInteraction true · enableTransparency true
   컬러는 흰색 단색 대신 ARGO 파티클 팔레트(핑크 → 페일핑크 → 민트)를 공마다 다른
   위상으로 돌린다. 겹치는 곳에서 필드 가중치로 섞여 물감이 번지듯 보인다.

   나갈 때(argoGoto)  : 검은 화면이 덮이고 blob 이 돈다 → 이동
   들어올 때(on load) : 같은 화면이 걷힌다
   No dependencies. Safe on both pages.
   ============================================================================ */
(function () {
  'use strict';

  /* 로딩 화면은 페이지를 넘어가도 "한 번, 2초" 다.
     예전엔 떠나는 쪽에서 한 번(OUT_MS+MIN_HOLD), 도착한 쪽에서 또 한 번(opacity 0→1)
     페이드인을 해서 그 사이에 새 페이지가 번쩍 보였다 → 로딩화면이 두 번 나오는 것처럼 보였다.
     이제 argoGoto 가 시작 시각을 sessionStorage 에 남기고, 도착 페이지는
     '이미 덮인 상태'로 트랜지션 없이 시작해 남은 시간만 채운 뒤 걷힌다. */
  var TOTAL_MS = 2000;               /* 덮이기 시작해서 완전히 걷힐 때까지 = 2초 */
  var FADE_IN  = 420;                /* 떠날 때 덮이는 시간 */
  var FADE_OUT = 420;                /* 도착해서 걷히는 시간 */
  var HOLD     = TOTAL_MS - FADE_OUT;/* 직접 로드(링크 아님)일 때 유지 시간 = 1580ms */
  var DIR_KEY = 'argoNavDir';
  var T0_KEY  = 'argoNavT0';         /* argoGoto 가 시작한 시각(ms) */

  /* ---------- 로딩 배경 ---------- */
  /* blob 전체 크기 배율. 셰이더의 scale = animationSize / 화면높이 이고 공(위치·반지름)은
     그 좌표계 안에 있으므로, animationSize 를 키우면 blob 은 반대로 작아진다.
     따라서 0.8배로 줄이려면 animationSize 를 1/0.8 만큼 늘린다. (44 → 55)
     유휴 상태 커서볼 궤도 반경(아래 0.15)도 같은 비율로 줄여 구도를 유지한다. */
  /* ── 로딩 배경 : 코드 레인 ────────────────────────────────────────────
     [교체] 액체(메타볼) 연출은 전부 걷어냈다.
     ref. activetheory.net 로딩 화면 — 검은 바탕에 코드가 무수히 흘러가고
     네온이 얇게 번지는 인상. 코드 문구는 MARS 히어로에 떠 있는 것과 같은 계열
     (텔레메트리 / 셰이더 / 쿼리 / 후보자 레코드)을 쓴다.

     캔버스 2D 하나로 끝낸다 — 이 오버레이는 페이지 전환 중에 뜨는 화면이라
     WebGL 컨텍스트를 하나 더 잡으면 도착 페이지의 성운과 자리를 다툰다. */
  var RAIN_LINES = [
    '$ tfsc telemetry --stream',
    '> link established · SOL-0687',
    '  relay ORBIT-3 ... ok',
    '  latency 12m40s',
    'const candidate = {',
    "  id: 'TFSC-04',",
    "  biometric: 'sealed',",
    "  genome: 'locked'",
    '};',
    'function evaluate(c) {',
    '  const s = score(c.cognitive);',
    '  if (s < THRESHOLD) return reject(c);',
    '  return admit(c);',
    '}',
    '[ATMOS]  0.6% Earth',
    '[THERM] -63C avg',
    '[ROT]    24.6 hrs',
    '[STATUS] IN PROGRESS',
    'await archive.seal({',
    '  frame: capture.latest,',
    '  hash: sha256(frame),',
    "  scope: 'committee-only'",
    '});',
    '> terraform status',
    '  phase 02 · running',
    '  mirrors   deployed',
    '  nanoswarm active',
    'vec3 col = texture(uCapture, uv).rgb;',
    'col = dither(col, bayer8);',
    'fragColor = vec4(col, 1.0);',
    'SELECT * FROM candidates',
    ' WHERE adaptation_score > 0.82',
    ' ORDER BY sealed_at DESC;',
    '⟶ scan sequence 03/06',
    '  surface dust ...... ok',
    '  pressure .......... ok',
    '  mineral trace ..... ok'
  ];
  /* 네온 팔레트 — 글자 한 자마다 여기서 하나씩 뽑는다.
     [교체] 색을 새로 지어내지 않고 MARS 히어로(11-planet-detail)에서 쓰는 값을 그대로 가져왔다.
       · 파티클       hero-nebula-fx PALETTE  — 코랄 주조 + 진한→연한 핑크 그라데이션
       · 코드 텍스트  pd-skin.css .pd-hero-code pre / .mid / .far
       · 성운 셰이더  uCore #FF9A7A (크림 코어)
     로딩화면도 같은 코드 잔광이므로 히어로에 없는 색은 한 개도 넣지 않았다.

     차가운 자리는 히어로 MINTS 중 '민트 초록'이 아니라 하늘빛 쪽(#FF2D82 스카이)과
     먼 층 코드색(#5B8DEF)만 골랐다 — 앞서 요청한 대로 민트 대신 연한 아이스 블루로 읽힌다.
     #FF2D82 / #FF2D82 / #FF2D82 (초록기 있는 민트)과 순수 빨강 계열은 제외. */
  /* v3 비율 — 페일로즈 55 / 핫핑크 25 / 라벤더 10 / 블루 7 / 마젠타 3.
     항목을 비율대로 중복해 넣어 균등 난수만으로 가중치를 낸다. */
  /* v4 비비드. 비율은 그대로 — 항목을 비율만큼 중복해 넣어 가중치를 낸다. */
  /* v4.1 — 로즈군 50 / 핫핑크 24 / 오렌지 9 / 엠버 5 / 블루 5 / 마젠타 4 / 바이올렛 3 */
  /* MISSION FORCE ARGO 헤드라인과 같은 색 세트. 비율만큼 중복해 가중치를 낸다. */
  /* [v6] 로딩화면 코드비 색 — 사이트 최종 팔레트 비율(쿨 70 / 웜 30)을 그대로 따른다.
     항목을 비율만큼 중복해 넣어 균등 난수로 가중치를 낸다. */
  var RAIN_HUES = [
    '255,39,195','255,39,195','255,39,195','255,39,195',   /* 일렉트릭 마젠타 20% */
    '255,45,130','255,45,130','255,45,130',                /* 핫 핑크         15% */
    '255,61,104','255,61,104',                             /* 레이저 핑크     10% */
    '185,168,255','185,168,255',                           /* 크롬 라일락     10% */
    '91,141,239','91,141,239',                             /* 스텔라 블루     10% */
    '40,255,212',                                          /* 네온 민트        5% */
    '212,250,255',                                         /* 아이스 화이트    5% */
    '255,154,122','255,154,122','255,154,122',             /* 하이퍼 피치     15% */
    '255,107,102','255,107,102'                            /* 네온 코랄       10% */
  ];


  function pickHue() { return RAIN_HUES[(Math.random() * RAIN_HUES.length) | 0]; }


  function initCodeRain(container) {
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    container.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    var reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
    var W = 0, H = 0, dpr = 1, cols = [], raf = 0;
    var FS = 12, LH = 17, COLW = 210;
    var FONT = '400 ' + FS + 'px "Geist Mono","IBM Plex Mono",ui-monospace,monospace';

    /* ---- 글리프 아틀라스 -------------------------------------------------
       글자마다 색이 다르려면 글자마다 따로 그려야 하는데, 화면에 한 번에
       1만 자쯤 뜬다. 거기에 네온(shadowBlur)까지 매 프레임 걸면 프레임이 무너진다.
       (색,글자) 조합을 작은 캔버스에 '네온까지 구워서' 한 번만 만들어 두고,
       런타임에는 drawImage 로 찍기만 한다 — 글로우가 공짜가 된다. */
    /* PAD 는 글로우가 번질 여백이다. 스프라이트 면적이 그대로 채우기 비용이라
       (한 프레임에 7~8천 자를 찍는다) 필요한 만큼만 준다. */
    var PAD = 5, CW = FS * 0.6, atlas = {};

    function glyph(hue, ch, hot) {
      var key = hue + '|' + ch + '|' + (hot ? 1 : 0);
      var g = atlas[key];
      if (g) return g;
      var sw = CW + PAD * 2, sh = LH + PAD * 2;
      g = document.createElement('canvas');
      g.width = Math.max(1, Math.round(sw * dpr));
      g.height = Math.max(1, Math.round(sh * dpr));
      var c2 = g.getContext('2d');
      c2.setTransform(dpr, 0, 0, dpr, 0, 0);
      c2.font = FONT;
      c2.textBaseline = 'top';
      /* 네온 : 넓고 옅은 글로우를 두 겹 깔고 그 위에 또렷한 글자를 얹는다 */
      c2.shadowColor = 'rgba(' + hue + ',1)';
      c2.fillStyle = 'rgba(' + hue + ',' + (hot ? 0.95 : 0.8) + ')';
      c2.shadowBlur = hot ? 9 : 6;
      c2.fillText(ch, PAD, PAD);
      c2.shadowBlur = hot ? 18 : 13;
      c2.fillText(ch, PAD, PAD);
      c2.shadowBlur = 0;
      c2.fillStyle = hot ? '#fff' : 'rgba(' + hue + ',1)';
      c2.fillText(ch, PAD, PAD);
      atlas[key] = g;
      return g;
    }

    function resize() {
      /* 로더가 숨어 있으면(display:none → clientWidth 0) 아무것도 되살리지 않는다.
         이 가드가 없으면 창 크기를 바꿀 때마다 접어 뒀던 6MP 캔버스가 다시 잡힌다. */
      if (!raf && !container.clientWidth) return;
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = container.clientWidth || innerWidth;
      H = container.clientHeight || innerHeight;
      canvas.width = Math.max(1, W * dpr);
      canvas.height = Math.max(1, H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = FONT;
      CW = ctx.measureText('0').width || FS * 0.6;   /* 모노스페이스 — 한 번만 재면 된다 */
      atlas = {};                                    /* dpr·자폭이 바뀌었으니 다시 굽는다 */
      build();
    }
    /* 웹폰트가 늦게 붙으면 폴백 글꼴로 구운 스프라이트가 남는다 — 그때 한 번 버린다 */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        ctx.font = FONT;
        CW = ctx.measureText('0').width || CW;
        atlas = {};
      });
    }

    function build() {
      var n = Math.max(3, Math.ceil(W / COLW) + 1);
      cols = [];
      for (var i = 0; i < n; i++) {
        /* 열마다 길이를 다르게 — 전부 같은 길이면 끝이 한 줄로 맞아 띠처럼 보인다 */
        var rows = Math.ceil(H / LH) + 6 + ((Math.random() * 10) | 0);
        var text = [];
        for (var r = 0; r < rows; r++) text.push(RAIN_LINES[(Math.random() * RAIN_LINES.length) | 0]);
        var span = rows * LH;
        cols.push({
          x: (i + 0.5) * (W / n) + (Math.random() - 0.5) * 70,
          /* [수정] -Math.random()*H 는 시작점이 전부 화면 위쪽 한 구간에 몰렸다.
             자기 길이(span) 전체에 흩어 놓아야 처음부터 화면 곳곳에 코드가 있다. */
          y: -Math.random() * span,
          /* 열마다 속도가 달라야 '흐른다' 는 인상이 난다. 아래로 흐른다. */
          v: 14 + Math.random() * 26,
          text: text,
          /* [수정] 줄 단위로 색을 물리면 문장 하나가 통째로 한 색이라 덩어리져 보인다.
             글자 한 자마다 색을 따로 뽑는다 — d/f/0 이 제각각 다른 네온으로 뜬다. */
          hues: text.map(function (line) {
            var hs = [];
            for (var k = 0; k < line.length; k++) hs.push(pickHue());
            return hs;
          }),
          hot: (Math.random() * text.length) | 0,   /* 이 줄만 타오른다 */
          alpha: 0.52 + Math.random() * 0.33        /* 네온이 살도록 상향 (0.34~0.64 → 0.52~0.85) */
        });
      }
    }

    var last = 0;
    function frame(now) {
      var dt = last ? Math.min(64, now - last) : 16; last = now;
      ctx.clearRect(0, 0, W, H);
      /* 글자는 아틀라스에서 찍는다(네온은 이미 구워져 있다).
         screen 합성이라 글자가 겹칠수록 빛이 쌓인다. */
      ctx.globalCompositeOperation = 'screen';

      /* 중앙 원형(마크 + 궤도 링)을 침범하지 않게 비워 둘 반경.
         링이 214px 이므로 그보다 넉넉히 잡는다. */
      var cx = W / 2, cy = H / 2;
      var CLEAR_R = 168, FADE_R = 250;

      for (var i = 0; i < cols.length; i++) {
        var c = cols[i];
        if (!reduce) c.y += c.v * dt / 1000;
        var span = c.text.length * LH;
        if (c.y > H) { c.y -= span; c.hot = (Math.random() * c.text.length) | 0; }

        var sw = CW + PAD * 2, sh = LH + PAD * 2;
        for (var r = 0; r < c.text.length; r++) {
          var y = c.y + r * LH;
          if (y < -LH || y > H) continue;

          var line = c.text[r], rowHues = c.hues[r], hot = (r === c.hot);
          var base = hot ? 0.95 : c.alpha;
          for (var k = 0; k < line.length; k++) {
            var ch = line.charAt(k);
            if (ch === ' ') continue;
            var gx = c.x + k * CW;
            if (gx < -sw || gx > W) continue;

            /* 중앙 원 안쪽은 건너뛰고, 테두리 부근은 서서히 옅게 —
               딱 잘리면 글자가 원에 물린 것처럼 보인다.
               글자 단위로 재므로 원의 경계가 줄 단위였을 때보다 매끈하다. */
            var d = Math.hypot(gx - cx, y - cy);
            if (d < CLEAR_R) continue;
            var edge = d < FADE_R ? (d - CLEAR_R) / (FADE_R - CLEAR_R) : 1;

            ctx.globalAlpha = base * edge;
            ctx.drawImage(glyph(rowHues[k], ch, hot), gx - PAD, y - PAD, sw, sh);
          }
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    }

    resize();
    addEventListener('resize', resize);
    raf = requestAnimationFrame(frame);

    function stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; last = 0;
      /* 백스토어까지 비운다 — 전면 캔버스 하나가 DPR2 에서 6MP(=GPU 24MB) 다.
         로더는 페이지 수명의 99% 를 숨어 있으므로 그동안 들고 있을 이유가 없다. */
      canvas.width = canvas.height = 1;
    }
    function start() {
      if (raf) return;
      resize();
      raf = requestAnimationFrame(frame);
    }

    return { resize: resize, start: start, stop: stop, destroy: stop };
  }

  /* ARGO 워드마크 — index 의 <symbol id="logo-argo"> 와 같은 패스.
     이 파일은 스프라이트가 없는 페이지(photo-wall 등)에서도 쓰이므로 여기에 직접 둔다. */
  var ARGO_MARK = "<path d=\"M100.101 236.062H69.3729C66.9591 236.062 65 234.098 65 231.678V171.555C65 170.289 65.5466 169.083 66.4999 168.25L168.301 79.3811C169.097 78.6841 170.116 78.3027 171.174 78.3027H212.253C213.408 78.3027 214.51 78.7586 215.332 79.5695L331.078 194.467C331.909 195.292 332.373 196.414 332.373 197.584V231.674C332.373 234.093 330.413 236.057 328 236.057H299.987C297.573 236.057 295.614 234.093 295.614 231.674V214.337C295.614 213.132 295.12 211.979 294.245 211.155L286.251 203.576C285.438 202.805 284.362 202.375 283.247 202.375H138.871C136.458 202.375 134.499 200.411 134.499 197.992V179.63C134.499 178.354 135.054 177.14 136.016 176.307L143.607 169.758C144.399 169.074 145.413 168.697 146.463 168.697H237.367C241.32 168.697 243.244 163.862 240.375 161.136L193.065 116.14C191.443 114.597 188.919 114.532 187.218 115.983L106.63 184.841C105.362 185.924 104.632 187.507 104.632 189.172C104.632 197.242 104.605 221.728 104.474 231.735C104.444 234.133 102.493 236.062 100.101 236.062Z\"/><path d=\"M483.496 128.321V113.413H284.17C283.051 113.413 281.97 112.984 281.157 112.208L270.548 102.104L270.513 102.152L253.254 85.8856C250.363 83.1635 252.283 78.3066 256.24 78.3066H487.357C488.463 78.3066 489.535 78.7274 490.344 79.4902L508.5 96.5548C509.383 97.3789 509.891 98.5405 509.891 99.7459V138.276H483.5V128.321H483.496Z\"/><path d=\"M508.5 154.433L489.447 172.348C488.634 173.097 487.567 173.531 486.461 173.531H449.029C445.058 173.531 443.138 178.397 446.055 181.123L496.676 228.477C499.575 231.186 497.66 236.056 493.689 236.056H452.999C451.893 236.056 450.821 235.635 450.012 234.873L385.98 174.715C385.167 173.952 384.1 173.531 382.993 173.531H348.29C347.184 173.531 346.112 173.102 345.303 172.348L331.288 159.175L317.137 145.854C314.247 143.132 316.18 138.275 320.137 138.275H509.891V151.237C509.891 152.443 509.388 153.604 508.5 154.428V154.433Z\"/><path d=\"M591.257 113.843H710.047C711.092 113.843 712.098 113.444 712.859 112.734L736.022 91.0889L741.978 85.4255C744.681 82.8568 742.87 78.2937 739.144 78.2893L580.92 78C579.936 78 578.982 78.3507 578.235 78.9863L531.471 118.941C530.553 119.726 530.023 120.879 530.023 122.088V213.105C530.023 214.249 530.496 215.341 531.327 216.121L551.354 234.939C552.12 235.658 553.13 236.057 554.175 236.057H713.716C714.766 236.057 715.771 235.658 716.537 234.939L734.719 217.857C735.55 217.077 736.022 215.981 736.022 214.841V152.338C736.022 150.054 734.177 148.2 731.894 148.2H677.11C676.061 148.2 675.051 148.599 674.286 149.318L646.994 174.987C644.266 177.552 646.076 182.141 649.819 182.141H693.902C696.181 182.141 698.03 183.991 698.03 186.279V195.353C698.03 197.636 696.185 199.491 693.902 199.491H571.75C569.471 199.491 567.622 197.641 567.622 195.353V134.647C567.622 133.437 568.151 132.284 569.069 131.5L588.577 114.834C589.324 114.194 590.273 113.848 591.253 113.848L591.257 113.843Z\"/><path d=\"M959.198 79.1835C958.389 78.4208 957.317 78 956.207 78H798.205C797.094 78 796.023 78.4252 795.214 79.1835L756.793 115.281C755.91 116.109 755.412 117.267 755.412 118.481V198.329C755.412 199.548 755.919 200.709 756.807 201.538L792.603 234.891C793.412 235.645 794.475 236.066 795.581 236.066H958.826C959.932 236.066 960.995 235.645 961.804 234.891L997.601 201.538C998.493 200.709 998.996 199.543 998.996 198.329V118.481C998.996 117.271 998.497 116.109 997.614 115.281L959.198 79.1835ZM961.568 178.367L940.556 198.881C939.738 199.679 938.645 200.126 937.504 200.126H816.917C815.775 200.126 814.682 199.679 813.864 198.881L792.852 178.367C792.008 177.543 791.532 176.416 791.532 175.237L791.471 143.422C791.471 142.208 791.969 141.047 792.852 140.218L819.558 115.123C820.367 114.36 821.438 113.94 822.549 113.94H931.867C932.978 113.94 934.049 114.365 934.858 115.123L961.564 140.218C962.447 141.047 962.95 142.208 962.945 143.422L962.884 175.237C962.884 176.416 962.407 177.547 961.564 178.371L961.568 178.367Z\"/>";

  /* ---------- 전환 오버레이 ---------- */
  function dirForUrl(url) {
    if (/11-planet-detail/.test(url)) return 'mars';
    if (/index\.html/.test(url) || url === '/' || url === './') return 'home';
    return 'link';
  }

  var css =
    '#argo-nav{position:fixed;inset:0;z-index:2147483000;pointer-events:none;' +
      'background:#000;opacity:0}' +
    '#argo-nav.on{opacity:1}' +
    '#argo-nav .rain{position:absolute;inset:0;width:100%;height:100%;overflow:hidden}' +
    /* 코드 레인 위에 ARGO 마크를 얹는다. 작게 —
       로고가 커지면 로딩 화면이 아니라 스플래시처럼 보인다. */
    '#argo-nav .mark{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
      'width:88px;height:auto;fill:#fff;opacity:.95;pointer-events:none;z-index:2}' +
    /* ---- 궤도 링 (ref. vengenceui.com Kinetic Text Loader) -------------------
       마크를 중심에 두고 모노 텍스트가 궤도를 한 겹 돈다. 원본은 React 라 결과만 이식했다.
       중앙은 코드가 읽히지 않게 눌러 둔다 — 마크와 링이 먼저 읽혀야 한다. */
    '#argo-nav .rain::after{content:"";position:absolute;inset:0;pointer-events:none;' +
      /* [수정] .75/.30 은 중앙 코드가 거의 안 보일 만큼 눌렀다. 마크와 링이 먼저
         읽힐 정도만 남기고 걷어낸다. */
      'background:radial-gradient(circle at 50% 50%, rgba(0,0,0,.15) 0, rgba(0,0,0,.05) 22%, transparent 40%)}' +
    '#argo-nav .ring{position:absolute;left:50%;top:50%;width:214px;height:214px;' +
      'transform:translate(-50%,-50%);pointer-events:none;z-index:1;' +
      'animation:argoRing 15s linear infinite}' +
    '#argo-nav .ring text{font-family:"IBM Plex Mono",ui-monospace,monospace;' +
      'font-size:9.4px;letter-spacing:.24em;fill:rgba(212,250,255,.45)}' +
    '@keyframes argoRing{to{transform:translate(-50%,-50%) rotate(360deg)}}' +
    /* 상태 문구 — 글자가 스크램블로 확정되며 바뀐다 */
    '#argo-nav .stat{position:absolute;left:0;right:0;bottom:16%;text-align:center;z-index:2;' +
      'font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;' +
      'letter-spacing:.2em;color:#FF2D82;pointer-events:none}' +
    '@media (prefers-reduced-motion:reduce){#argo-nav .ring{animation:none}}';

  var st = document.createElement('style');
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  var mbApi = null;
  var root = document.createElement('div');
  root.id = 'argo-nav';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = '<div class="rain"></div>'
    + '<svg class="ring" viewBox="0 0 220 220" aria-hidden="true">'
    +   '<defs><path id="argoRingPath" d="M110,110 m-82,0 a82,82 0 1,1 164,0 a82,82 0 1,1 -164,0"/></defs>'
    +   '<text><textPath href="#argoRingPath">'
    +     'TERRAFORMING SELECTION COMMITTEE \u00b7 SOL-0687 \u00b7 TFSC-04 \u00b7 '
    +   '</textPath></text>'
    + '</svg>'
    + '<svg class="mark" viewBox="0 0 1064 314" aria-hidden="true">' + ARGO_MARK + '</svg>'
    + '<div class="stat" aria-hidden="true">INITIALIZING</div>';

  /* 상태 문구 스크램블. shared/argo-scramble.js 를 쓰지 않는 이유 —
     이 파일이 먼저 로드되는 페이지가 있어 로드 순서에 기대면 조용히 안 돈다. */
  var SCRAMBLE_CHARS = '01<>/\\[]{}#$%&*+=~ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  /* 로더 오버레이가 숨은 동안에는 안의 애니메이션을 전부 멈춘다.
     예전엔 코드 레인(전면 캔버스 · 글자마다 shadowBlur)과 상태 텍스트 스크램블이
     display:none 뒤에서 페이지가 열려 있는 내내 매 프레임 돌았다 — 렉의 주범. */
  var statusEl = null, statusT = 0, statusRunning = false;
  function navHidden() { return root.style.display === 'none'; }

  function startStatus(el) {
    if (el) statusEl = el;
    el = statusEl;
    if (!el || statusRunning) return;
    if (matchMedia('(prefers-reduced-motion:reduce)').matches) return;
    statusRunning = true;
    var WORDS = ['INITIALIZING', 'LINKING ORBIT', 'SEALING RECORD', 'READY'], w = 0;
    function run(txt, done) {
      var s = txt.split(''), t0 = performance.now();
      (function f(now) {
        if (navHidden()) { statusRunning = false; return; }
        var p = Math.min(1, (now - t0) / 620), out = '';
        for (var i = 0; i < s.length; i++) {
          var lock = (i / s.length) * 0.7;
          out += (s[i] === ' ') ? ' '
               : (p >= lock + 0.3 ? s[i] : SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0]);
        }
        el.textContent = out;
        if (p < 1) requestAnimationFrame(f); else done();
      })(performance.now());
    }
    (function loop() {
      run(WORDS[w % WORDS.length], function () {
        w++;
        clearTimeout(statusT);
        statusT = setTimeout(loop, 780);
      });
    })();
  }

  function mount() {
    if (!document.body) { return setTimeout(mount, 8); }

    /* [수정] argoSkipLoader 는 지금까지 쓰기만 하고 아무도 읽지 않아 무용지물이었다.
       View Transition 으로 넘어온 이동은 로딩 오버레이가 뜨면 안 된다 —
       와이프가 끝나자마자 메타볼 화면이 덮어 버려 연출이 통째로 가려진다. */
    var skip = false;
    try {
      skip = sessionStorage.getItem('argoSkipLoader') === '1';
      if (skip) sessionStorage.removeItem('argoSkipLoader');
    } catch (e) {}
    if (skip) {
      try { sessionStorage.removeItem(DIR_KEY); sessionStorage.removeItem(T0_KEY); } catch (e) {}
      root.style.display = 'none';
      return;
    }

    document.body.appendChild(root);
    try { sessionStorage.removeItem(DIR_KEY); } catch (e) {}

    var rainHost = root.querySelector('.rain');
    mbApi = initCodeRain(rainHost);
    startStatus(root.querySelector('.stat'));

    /* index.html 자체 로딩 화면(#load)은 이 오버레이로 대체한다 — 두 겹으로 뜨지 않게 */
    var legacy = document.getElementById('load');
    if (legacy) { legacy.classList.add('off'); legacy.style.display = 'none'; }

    /* argoGoto 로 넘어온 것이면 그때 시작한 시각을 이어받는다 → 두 페이지에 걸쳐 총 1.5초 */
    var began = Date.now(), viaNav = false;
    try {
      var raw = sessionStorage.getItem(T0_KEY);
      if (raw) { var v = parseInt(raw, 10); if (v) { began = v; viaNav = true; } }
      sessionStorage.removeItem(T0_KEY);
    } catch (e) {}

    /* 도착은 '이미 덮인 상태'다 — 트랜지션 없이 즉시 불투명하게 만들어
       새 페이지가 잠깐 비치는 일이 없게 한다. 걷힐 때만 애니메이션한다. */
    root.style.transition = 'none';
    root.classList.add('on');
    void root.offsetWidth;
    root.style.transition = 'opacity ' + FADE_OUT + 'ms ease-out';

    function reveal() {
      /* 링크로 왔으면 시작 시각 기준 남은 시간, 직접 로드면 HOLD 를 채운다 */
      var target = viaNav ? (TOTAL_MS - FADE_OUT) : HOLD;
      var wait = Math.max(0, target - (Date.now() - began));
      setTimeout(function () {
        root.classList.remove('on');
        setTimeout(function () {
          root.style.display = 'none';
          /* 숨긴 뒤 안쪽 애니메이션을 반드시 끈다 — 이게 없으면 영원히 돈다 */
          if (mbApi && mbApi.stop) mbApi.stop();
          clearTimeout(statusT);
          statusRunning = false;
        }, FADE_OUT + 60);
      }, wait);
    }
    /* [수정] load 만 기다리면 배경은 떴는데 성운(WebGL)은 아직 첫 프레임을 못 그린
       상태에서 오버레이가 걷힌다 → 파티클이 한 박자 늦게 튀어나온다.
       성운이 첫 프레임을 그렸다는 신호를 함께 기다리되, 그 페이지에 성운이
       없거나 WebGL 이 막힌 경우를 대비해 상한(1.2초)을 둔다. */
    function revealWhenPainted() {
      if (window.__argoNebulaReady || !document.getElementById('gc')) { reveal(); return; }
      var capped = false;
      var go = function () {
        if (capped) return; capped = true;
        /* 신호는 '첫 렌더 호출' 시점이다. 그 프레임이 실제로 합성돼 화면에 올라간 뒤
           걷어야 성운이 이미 있는 상태로 드러난다 — rAF 두 번을 기다린다. */
        requestAnimationFrame(function () { requestAnimationFrame(reveal); });
      };
      addEventListener('argo:nebula-ready', go, { once: true });
      /* 성운(52,000개 + 셰이더 컴파일)은 기기에 따라 1.2초를 넘긴다.
         상한이 짧으면 로더가 먼저 걷혀 배경만 뜬 화면이 보인다 → 3초로 늘린다. */
      setTimeout(go, 3000);
    }
    if (document.readyState === 'complete') revealWhenPainted();
    else addEventListener('load', revealWhenPainted, { once: true });
  }
  mount();

  window.argoGoto = function (url, skipLoader) {
    if (!url) return;
    /* [추적] 하드 페이지 이동의 단일 통로. 여기서만 잡아 두면 링크마다 리스너를 달지 않아도 된다.
       도착 페이지에서 page_entered 를, 이전 페이지의 page_exited 는 다음 로드에서 보완한다. */
    try {
      if (window.ArgoTrack) {
        var _dir = dirForUrl(url);
        var _to = _dir === 'mars' ? 'mars' : (_dir === 'home' ? 'main' : 'link');
        window.ArgoTrack.act(_dir === 'mars' ? 'mars_viewed' : 'navigation_clicked',
          { to_page: _to, navigation_type: 'main_navigation' });
      }
    } catch (e) {}
    try {
      if (skipLoader) sessionStorage.setItem('argoSkipLoader', '1');
      sessionStorage.setItem(DIR_KEY, dirForUrl(url));
      sessionStorage.setItem(T0_KEY, String(Date.now()));
    } catch (e) {}

    root.style.display = '';
    /* 숨겨져 있는 동안 캔버스는 1x1 로 접혀 있다 — 다시 띄우며 크기를 맞추고 재개한다. */
    if (mbApi && mbApi.start) mbApi.start();
    startStatus();
    root.style.pointerEvents = 'all';
    root.style.transition = 'opacity ' + FADE_IN + 'ms ease-in';
    void root.offsetWidth;
    root.classList.add('on');

    /* 완전히 덮이면 바로 이동한다. 나머지 시간은 도착 페이지가 이어서 채운다. */
    setTimeout(function () { window.location.href = url; }, FADE_IN);
  };

  /* 로더를 띄우지 않고 바로 이동한다.
     양쪽 문서에 @view-transition{navigation:auto} 가 선언돼 있으면
     브라우저가 문서 간 전환을 clip-path 로 애니메이션한다(skiper26 방식). */
  window.argoGotoInstant = function (url) {
    if (!url) return;
    try {
      sessionStorage.setItem('argoSkipLoader', '1');
      sessionStorage.setItem(DIR_KEY, dirForUrl(url));
    } catch (e) {}
    window.location.href = url;
  };
})();
