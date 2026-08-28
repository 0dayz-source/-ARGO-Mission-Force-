/* =====================================================================
   ARGO STAR TORUS — SYSTEM INDEX 중앙 오브제
   ---------------------------------------------------------------------
   [레퍼런스 분석 — atlab.io / Active Theory "Proton + Antimatter"]
   실제 번들(assets/js/app.*.js)을 받아 확인한 구성은 이랬다.

     · 입자 수      GPU.logoParticleCount() → 데스크톱 262144 (512² 텍스처)
                    저사양/모바일 16384 (128²)
     · 형상         Point Cloud 프리셋
                    "vec3 pointShape = texture2D(tPointCloud, uv).xyz;"
                    → 미리 구워 둔 포인트클라우드 파일에서 위치를 읽는다
     · 움직임       Curl Noise 프리셋
                    "curlNoise(pos * uCurlNoiseScale*0.1 + time*uCurlTimeScale*0.1)"
     · 커서 반응    Mouse Fluid 프리셋 — 유체 시뮬 속도장(tFluid)으로 입자를 민다
     · 렌더         전량 GPGPU. 위치 계산이 전부 셰이더 안에서 끝난다.

   [여기서 따라한 것]
   구조를 그대로 옮겼다. 위치는 정적 attribute 로 한 번만 굽고, 이후 프레임마다
   CPU 는 유니폼(시간·마우스·진행도)만 바꾼다. 컬 노이즈 드리프트와 커서 밀어내기,
   진입 수렴까지 전부 버텍스 셰이더에서 계산한다.
   → 예전 CPU 루프 버전은 46,000개가 한계였는데 이 방식으로 180,224개가 된다.
     레퍼런스의 "고운 모래알" 질감은 결국 입자 밀도에서 나온다.

   [따라하지 않은 것]
   포인트클라우드 파일은 저쪽 자산이라 쓰지 않는다. 대신 같은 자리에서
   3D 밸류 노이즈로 표면이 우글거리는 비정형 토러스를 절차적으로 만든다.
   색도 저쪽 퍼플 대신 ARGO 팔레트(화이트 다수 + 코랄/레드/오렌지 악센트)를 쓴다.

   THREE 는 app.js 에 번들된 r128 전역을 쓴다. 새 라이브러리를 붙이지 않는다.
   ===================================================================== */
(function (global) {
  'use strict';

  /* 팔레트 — ARGO 네온.
     처음엔 레퍼런스(atlab)를 따라 화이트/그레이 84% 로 잡았는데, 저쪽은 퍼플 한 색만
     악센트로 쓰는 화면이라 그 비율이 성립했다. ARGO 는 메인 성운부터 코랄·레드·
     오렌지·핑크·민트가 한꺼번에 도는 사이트라 같은 비율로는 회색 먼지로만 보인다.
     → 컬러를 다수(약 3/4)로 올리고 화이트는 별빛 하이라이트로만 남긴다.
     색값은 메인 성운(app.js initScene)의 네온 팔레트와 같은 것을 쓴다. */
  /* [팔레트] 코랄핑크·레드 계열이 중심, 민트는 포인트, 오렌지는 최소.
     오렌지가 많으면 화면 전체가 주황빛으로 눌린다 — 코랄 쪽으로 무게를 옮겼다. */
  /* [교체] 색이 너무 많이 섞여 있었다(핑크·마젠타·민트·오렌지가 한 화면에).
     레퍼런스(atlab)처럼 밝은 입자가 다수이고 악센트는 한 계열로만 간다.
     여기서는 화이트 → ARGO 레드로 이어지는 한 줄기 그라데이션만 쓴다.
     민트·오렌지·마젠타는 뺐다 — 계열이 갈리면 모래알이 아니라 색종이가 된다. */
  /* [교체] 화이트 → 오렌지 → 핑크 한 줄기 그라데이션.
     레드/딥레드를 빼고 그 자리를 오렌지가 메운다 — 흰빛에서 주황을 거쳐
     핑크로 넘어가는 단계가 끊기지 않아야 '그라데이션' 으로 읽힌다. */
  /* [수정] 보라가 보이던 원인 — #FF3D68(B .553 > G .302), #FF2D82(B .494) 처럼
     파랑 채널이 초록보다 높은 마젠타 계열이 섞여 있었다. 어둡게 깔리면 보라로 읽힌다.
     파랑을 초록 아래로 눌러 전부 붉은 계열에 머물게 하고, 대신 단계를 늘려
     오렌지–버밀리언–토마토–코랄–레드–로즈–살몬까지 다양하게 벌린다. */
  /* [v2 Cosmic Pink] 문 화이트 → 로즈 → 마젠타 그라데이션 + 라벤더 소량.
     레드·오렌지는 없다. 라벤더는 보색 포인트라 비중을 낮게 둔다. */
  /* [v3] 지정 비율 — 페일로즈 55 / 핫핑크 25 / 라벤더 10 / 블루 7 / 마젠타 3.
     화면 대부분이 부드러운 밀키 핑크로 깔리고, 마젠타는 3%만 섞여
     '가끔 하나가 확 빛나는' 별 역할만 한다. */
  /* [v4 Vivid] 비율은 그대로(페일로즈군 55 / 핫핑크 25 / 바이올렛 10 / 블루 7 / 마젠타 3),
     값만 레퍼런스의 입자 스트림처럼 채도를 끝까지 올렸다. */
  /* [팔레트 v5] ARGO Index 전용 — 핑크 계열만. 비율은 아래 WEIGHT. */
  var PALETTE = [
    [1.000, 0.176, 0.510],   /* #FF2D82  핫 핑크 */
    [1.000, 0.239, 0.408],   /* #FF3D68  레이저 핑크 */
    [1.000, 0.153, 0.765],   /* #FF27C3  일렉트릭 마젠타 */
    [0.361, 0.055, 0.290],   /* #5C0E4A  딥 마젠타 — 잔별 */
    [1.000, 1.000, 1.000]    /* #FFFFFF  화이트 코어 */
  ];
  /* ARGO Index 는 핑크 하나로만 간다(요청). 피치·블루는 메인 성운에만 쓴다. */
  var WEIGHT = [0.34, 0.30, 0.20, 0.10, 0.06];

  function pickColor() {
    var t = Math.random(), acc = 0;
    for (var i = 0; i < WEIGHT.length; i++) { acc += WEIGHT[i]; if (t < acc) return PALETTE[i]; }
    return PALETTE[0];
  }

  /* app.js 메인 성운과 같은 3D 밸류 노이즈 — 링의 굴곡을 만든다 */
  function hash(n) { var x = Math.sin(n) * 43758.5453; return x - Math.floor(x); }
  function snoise(x, y, z) {
    var ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    var fx = x - ix, fy = y - iy, fz = z - iz;
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
    return (hash(ix + hash(iy + hash(iz))) * (1 - ux) + hash(ix + 1 + hash(iy + hash(iz))) * ux) * (1 - uy)
         + (hash(ix + hash(iy + 1 + hash(iz))) * (1 - ux) + hash(ix + 1 + hash(iy + 1 + hash(iz))) * ux) * uy
         + ((hash(ix + hash(iy + hash(iz + 1))) * (1 - ux) + hash(ix + 1 + hash(iy + hash(iz + 1))) * ux) * (1 - uy)
         +  (hash(ix + hash(iy + 1 + hash(iz + 1))) * (1 - ux) + hash(ix + 1 + hash(iy + 1 + hash(iz + 1))) * ux) * uy) * uz;
  }

  var TAU = Math.PI * 2;

  /* ── 배치 튜닝 ────────────────────────────────────────────────────────
     TORUS_SCALE    전체 배율.
     TORUS_CENTER_X 링 중심의 화면 가로 위치(0 = 왼쪽 끝, 0.5 = 정중앙, 1 = 오른쪽 끝).
                    낮출수록 왼쪽으로 간다 — 오른쪽 본문과 겹치는 정도를 이 값으로 잡는다. */
  var TORUS_SCALE    = 0.91;   /* 상·하가 프레임 밖으로 잘리되 밀도가 무너지지 않는 선 */
  var TORUS_CENTER_X = 0.54;   /* 레퍼런스 링 중심 = 프레임 가로 0.537 */
  /* TORUS_OVAL 링을 제 평면(로컬 XZ) 안에서 타원으로 만드는 비율(1 = 정원).
     링은 -1.06rad 기울어져 있어 로컬 Z 가 화면 세로로 투영된다 → Z 를 늘리면
     화면에서 세로로 길쭉해진다.
     [주의] 부모 그룹에 scale.y 를 거는 방법은 쓰지 않는다. 월드 배율이 비균등이 되면
     커서 밀어냄 반경(로컬 기준 구)까지 같이 찌그러져 원이 타원으로 보인다. */
  var TORUS_OVAL = 1.00;   /* 레퍼런스 실측: 정면 방향 정원 링(가로 1038 = 세로) */

  /* 링 둘레 밀도 — 입자가 뭉치는 자리를 정한다.
     u 를 균등 난수로 뽑으면 둘레 전체에 고르게 깔려 '다 퍼져 있는' 인상이 된다.
     저주파 봉우리 몇 개를 겹쳐 만들고, 그 값을 채택 확률로 써서 봉우리 근처에
     입자가 몰리게 한다(채택-거부 표본추출). 0.22 는 바닥값 — 뭉치지 않은 구간도
     완전히 비지는 않게 남겨 둔다. */
  function ringDensity(u) {
    var d = 0.22
      + 0.50 * Math.pow(Math.max(0, Math.sin(u * 2.0 + 0.7)), 3.0)
      + 0.38 * Math.pow(Math.max(0, Math.sin(u * 3.0 - 1.9)), 4.0)
      + 0.26 * Math.pow(Math.max(0, Math.sin(u * 5.0 + 2.6)), 6.0);
    return Math.min(1, d);
  }
  function pickRingAngle() {
    /* 12번 안에 채택되지 않으면 마지막 값을 그냥 쓴다 — 무한 루프 방지 */
    var u = 0;
    for (var k = 0; k < 12; k++) {
      u = TAU * Math.random();
      if (Math.random() <= ringDensity(u)) return u;
    }
    return u;
  }

  /* ── 컬 노이즈 (GLSL) ────────────────────────────────────────────────
     레퍼런스의 Curl Noise 프리셋과 같은 역할. 발산이 0인 벡터장이라
     입자가 뭉치거나 흩어지지 않고 표면을 따라 미끄러진다 — 살아 있는 인상. */
  /* ── 흐름 필드 (GLSL) ─────────────────────────────────────────────────
     레퍼런스(atlab)의 Curl Noise 프리셋과 같은 역할 — 발산이 거의 0인 벡터장이라
     입자가 뭉치거나 흩어지지 않고 표면을 따라 미끄러진다.

     [성능] 처음엔 심플렉스 노이즈로 유한차분 컬을 구했다. 그러면 정점 하나당
     snoise3 를 6번 부른다 → 18만 정점 × 6 = 프레임당 100만 회 이상. 이게 바로
     "계속 끊기는 렉" 의 정체였다. 눈으로 보이는 결과는 거의 같으면서 30배 이상
     싼 삼각함수 조합으로 바꿨다(각 성분이 다른 축의 sin 곱이라 회전장에 가깝다). */
  var CURL_GLSL = [
    'vec3 curlNoise(vec3 p){',
    '  float a = sin(p.y * 1.7 + p.z * 0.9);',
    '  float b = sin(p.z * 1.5 + p.x * 1.1);',
    '  float c = sin(p.x * 1.9 + p.y * 0.7);',
    '  vec3 v = vec3(a * c, b * a, c * b);',
    '  float L = length(v);',
    '  return L > 0.0001 ? v / L : vec3(0.0);',
    '}'
  ].join('\n');

  function create(canvas, opts) {
    if (!canvas || typeof THREE === 'undefined') return null;
    opts = opts || {};

    var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var lowPerf = (navigator.hardwareConcurrency || 4) <= 4 || innerWidth < 900;

    /* 레퍼런스는 262,144(512²). 여기도 2의 거듭제곱 단으로 맞춘다.
       위치 계산이 전부 GPU 라 이 수가 매 프레임 CPU 부담이 되지 않는다 —
       버퍼를 굽는 초기 1회 루프만 감수하면 된다. */
    /* [성능] 남은 렉의 주범은 정점이 아니라 '프래그먼트' 였다.
       점 하나가 최대 9.5 디바이스px → 9만 개면 프레임당 800만 픽셀을 알파 합성한다
       (depthTest 를 꺼 둬서 전부 그려진다). 메인 성운(52,000)과 같은 규모로 낮추고
       점 크기 상한도 함께 내려 프래그먼트 부담을 4~5배 줄인다. */
    /* [수정] 크게 키운 만큼 화면 면적이 늘어 92k 로는 모래가 아니라 성긴 먼지가 됐다. */
    var COUNT = reduce ? 16384 : (lowPerf ? 40960 : 262144);

    /* [수정] 가운데 구멍이 넓었다. 구멍 반경 ≈ R - (튜브가 뻗는 거리) 이므로
       링 반경은 줄이고 튜브는 굵혀 안쪽을 메운다.
       이전 R 2.15 / r 0.52 → 구멍 ≈ 1.44, 지금 → 구멍 ≈ 0.84 (바깥 지름은 비슷) */
    var R = 2.00;   /* 링 중심 반경 */
    /* [실측] 레퍼런스는 바깥지름 1038px 에 구멍 600px → R+r=519, R-r=300
       → r/R = 0.27. 튜브는 두꺼운 게 아니라 오히려 얇다. */
    /* [수정] 0.45 는 실선처럼 얇았다 — 다만 진짜 원인은 반경이 아니라 아래 band(가닥
       구조)였다. band 를 푼 뒤 0.80 까지 굵혔더니 이번엔 R-r 이 줄어 구멍이 메워졌다.
       0.58(= 0.29R) 이 두께와 구멍을 함께 지키는 값이다. */
    var r = 0.58;

    var W = canvas.clientWidth || 1, H = canvas.clientHeight || 1;
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: true });
    } catch (e) { return null; }
    renderer.setSize(W, H, false);
    renderer.setPixelRatio(Math.min(devicePixelRatio, lowPerf ? 1.25 : 1.75));
    renderer.setClearColor(0x000000, 0);

    var scene = new THREE.Scene();
    /* 레퍼런스처럼 오브제가 프레임 밖으로 잘려 나갈 만큼 크게 잡는다.
       화면에 통째로 들어오면 '가운데 놓인 도넛' 이 되고 배경으로 깔리지 않는다. */
    /* [fake 3D] fov 42 → 54. 화각을 넓히면 앞뒤 크기 차가 커져 입체로 읽힌다.
       다만 68 은 과했다 — 카메라가 링에 너무 붙어 안쪽 테두리만 보였다. */
    var cam = new THREE.PerspectiveCamera(54, W / H, 0.1, 100);
    /* 4.4 는 너무 가까워 안쪽 공동만 보였다. 링 몸통이 화면을 채우면서
       가장자리는 프레임 밖으로 잘려 나가는 거리. */
    /* 카메라를 당겨 링이 화면을 더 채우게 한다 (6.8 → 5.2) */
    cam.position.set(0, 0, 5.2);

    /* ---- 정적 버퍼 : 한 번만 굽는다 -------------------------------- */
    var aHome    = new Float32Array(COUNT * 3);   /* 최종 자리(토러스) */
    var aScatter = new Float32Array(COUNT * 3);   /* 진입 시작점 */
    var aColor   = new Float32Array(COUNT * 3);
    var aSeed    = new Float32Array(COUNT);       /* 링 각도 u — 노드 연동에 쓴다 */
    var aRand    = new Float32Array(COUNT);       /* 개체 편차 */

    /* [수정] 부유 입자가 넓게 퍼져 실루엣을 흐렸다. 껍질 비중을 올린다. */
    var iShell = Math.floor(COUNT * 0.74);
    var iCore  = Math.floor(COUNT * 0.22);

    /* [형태] atlab 처럼 '가닥이 서로 감긴' 모양.
       매끈한 도넛은 표면에 입자를 고르게 뿌리지만(v 를 균등 난수로),
       여기서는 링을 도는 각도 u 에 따라 튜브 둘레 각 v 가 같이 돌게 묶는다
       → 링을 감고 올라가는 나선 띠가 되고, 띠를 여러 개 두면 DNA 처럼 얽힌다. */
    var STRANDS = 3;    /* 서로 감기는 가닥 수 */
    var TWIST   = 2;    /* 링 한 바퀴 도는 동안 가닥이 튜브를 감는 횟수 — 2~3회면 충분히 얽혀 보인다 */

    for (var i = 0; i < COUNT; i++) {
      var u = pickRingAngle();
      var kind = i < iShell ? 0 : (i < iShell + iCore ? 1 : 2);

      /* 가닥 중심선 : v = TWIST·u + 가닥 오프셋. 그 주변으로만 흩어진다.
         부유 입자(kind 2)는 가닥에서 풀려 나온 것이라 넓게 퍼뜨린다. */
      var strand = i % STRANDS;
      var vCore  = TWIST * u + strand * (TAU / STRANDS);
      /* [수정] 0.62 는 가닥 간격(2π/3 = 2.09) 의 30% 라, 입자가 나선 3가닥 위에만
         얹혀 '꼰 실' 로 보였다. 간격에 가깝게 벌리면 가닥이 서로 섞여 튜브가 찬다.
         결(나선)은 밀도 차로만 희미하게 남는다. */
      var band   = kind === 0 ? 1.90 : (kind === 1 ? 2.30 : 2.6);
      var v = vCore + (Math.random() - 0.5) * band;

      /* 링 반경의 저주파 굴곡 — 매끈한 도넛이 되지 않게 */
      var lobe = 1
        + snoise(Math.cos(u) * 1.7 + 11, Math.sin(u) * 1.7 + 5, 3.1) * 0.31
        + snoise(Math.cos(u) * 4.3 + 2, Math.sin(u) * 4.3 + 9, 7.7) * 0.09;

      var tubeR;
      if (kind === 0) {
        /* 표면 껍질 — 얇은 층에 몰아 레퍼런스의 '모래 껍질' 질감을 만든다 */
        /* [수정] 0.86~1.06 은 종잇장 같은 껍질이었다. 안쪽까지 채워 부피를 준다. */
        tubeR = r * (0.58 + Math.random() * 0.46);
      } else if (kind === 1) {
        /* 안쪽 — 바깥에 치우치게 해서 가운데가 비어 보이게 */
        tubeR = r * Math.pow(Math.random(), 0.58) * 0.92;
      } else {
        /* 표면에서 이탈해 부유하는 입자 */
        tubeR = r * (1.04 + Math.pow(Math.random(), 2.0) * 0.42);
      }
      /* 튜브 단면도 노이즈로 우그러뜨린다 — 껍질에 결이 생긴다 */
      tubeR *= 1 + snoise(Math.cos(v) * 2.4 + u * 1.3, Math.sin(v) * 2.4, u * 0.8) * 0.36;

      var rr = R * lobe + tubeR * Math.cos(v);
      var x = rr * Math.cos(u);
      var y = tubeR * Math.sin(v) * 1.30;
      var z = rr * Math.sin(u) * 0.92 * TORUS_OVAL;

      aHome[i * 3] = x; aHome[i * 3 + 1] = y; aHome[i * 3 + 2] = z;
      aSeed[i] = u;
      aRand[i] = Math.random();

      /* 진입 시작점 : 사방으로 크게 흩어진 별먼지 */
      var sr = 9 + Math.random() * 16, sp = Math.acos(2 * Math.random() - 1), st = TAU * Math.random();
      aScatter[i * 3]     = sr * Math.sin(sp) * Math.cos(st);
      aScatter[i * 3 + 1] = sr * Math.sin(sp) * Math.sin(st);
      aScatter[i * 3 + 2] = sr * Math.cos(sp);

      var c = pickColor();
      /* 표면에 가까울수록 밝게 — 앞뒤 밀도차와 함께 입체감을 만든다.
         부유 입자는 확 낮춰 링을 덮지 않게 한다. */
      var lit = 0.95 + 0.35 * Math.min(1, tubeR / (r * 1.05));
      if (kind === 2) lit *= 0.62;   /* 부유 입자만 낮춰 링을 덮지 않게 */
      /* [레퍼런스] 저쪽 화면은 '거의 검은 모래알 다수 + 타오르는 소수' 다.
         전부 비슷한 밝기면 균일한 안개가 된다. 3.2제곱이라 대부분 0.2 근처에
         깔리고 상위 몇 %만 2 를 넘어 별처럼 튄다. */
      lit *= 0.18 + Math.pow(Math.random(), 3.2) * 2.3;
      aColor[i * 3] = c[0] * lit; aColor[i * 3 + 1] = c[1] * lit; aColor[i * 3 + 2] = c[2] * lit;
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(aHome, 3));
    geo.setAttribute('aScatter', new THREE.BufferAttribute(aScatter, 3));
    geo.setAttribute('aColor',   new THREE.BufferAttribute(aColor, 3));
    geo.setAttribute('aSeed',    new THREE.BufferAttribute(aSeed, 1));
    geo.setAttribute('aRand',    new THREE.BufferAttribute(aRand, 1));
    /* 시작점이 아주 멀리 흩어져 있어 자동 바운딩스피어가 과하게 커진다.
       링 크기로 직접 잡아 프러스텀 컬링이 제대로 먹게 한다. */
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4.2);

    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:   { value: 0 },
        uForm:   { value: 0 },              /* 0 = 흩어짐, 1 = 토러스 */
        uFade:   { value: 0 },
        /* 렌더러에 넣은 값과 반드시 같아야 한다. 2.0 과 1.75 로 어긋나 있으면
           점이 의도보다 14% 크게 그려진다. */
        uPR:     { value: Math.min(devicePixelRatio, lowPerf ? 1.25 : 1.75) },
        uMouse:  { value: new THREE.Vector3(999, 999, 0) },  /* 월드 좌표 */
        uPush:   { value: 0 },              /* 커서 밀어내기 세기 */
        uWave:   { value: -1 },             /* 클릭 파동 진행도 */
        /* 커서를 따라 번지는 링 파동 4개.
           ref. MARS // MISSION SYSTEMS 카드의 RippleDistortion(shared/argo-ripple.js)
           원본은 원형 브러시를 가산 합성해 물결을 만든다. 여기서는 입자를 직접
           밀어내는 방식으로 옮겼다 — 링이 지나갈 때 그 자리 입자가 바깥으로
           부풀었다 되돌아온다(sweep). */
        uRipOrig:{ value: [new THREE.Vector2(0,0),new THREE.Vector2(0,0),
                           new THREE.Vector2(0,0),new THREE.Vector2(0,0)] },
        uRipAge: { value: [-1,-1,-1,-1] },
        uPulseA: { value: -1 },             /* 목록 호버 각도 */
        uPulse:  { value: 0 },
        uDriftPh:{ value: 0 },      /* 대기 흐름 '위상'. 속도를 곱하지 않고 누적한다 */
        uDriftAmp:{ value: 1.0 },   /* 대기 시 0 → 입자가 완전히 멎는다 */
        /* 커서 반응 범위·세기. 구름 로컬 단위(링 반경 2.15, 튜브 0.52) */
        /* [수정] 1.9 는 너무 좁았다. fall 을 제곱해 쓰기 때문에 체감 반경은
           uRadius 의 절반쯤이다 — 값을 키워야 '퍼진다' 로 읽힌다. */
        uRadius: { value: 3.4 },    /* 이 반경 밖 입자는 전혀 반응하지 않는다 */
        uSpread: { value: 1.05 },   /* 커서 바로 위 입자가 밀려나는 거리 */
        /* [3D] 밀려난 입자를 '화면 앞쪽'으로도 띄운다. 반경 방향으로만 밀면
           평면 위에서 번지는 것처럼 보인다 — 표면에서 솟아올라야 입체로 읽힌다.
           카메라의 구름 로컬 방향을 매 프레임 넣어 준다. */
        uCamL:   { value: new THREE.Vector3(0, 0, 1) },
        uLift:   { value: 0.85 },
        /* 피사계 심도 — 카메라에서 링 중심까지가 초점(5.2), 그 앞뒤 uDofRange 만큼이 흐려진다 */
        uFocus:  { value: 5.2 },
        uDofRange:{ value: 2.6 },
        /* 반짝임 속도(rad/s). 낮출수록 느긋하다 — 0.6 이면 한 번 깜빡이는 데 약 10초 */
        uTwSpeed:{ value: 0.6 },
        /* 스파클 — 가끔 한 순간만 확 타오르는 반짝임. 위의 느린 명멸과 별개다. */
        uSpSpeed:{ value: 1.15 }
      },
      vertexShader: [
        'attribute vec3 aScatter;',
        'attribute vec3 aColor;',
        'attribute float aSeed;',
        'attribute float aRand;',
        'uniform float uTime, uForm, uFade, uPR, uPush, uWave, uPulseA, uPulse, uDriftPh, uDriftAmp;',
        'uniform float uRadius, uSpread, uLift, uFocus, uDofRange, uTwSpeed, uSpSpeed;',
        'uniform vec3 uCamL;',
        'uniform vec3 uMouse;',
        'uniform vec2 uRipOrig[4];',
        'uniform float uRipAge[4];',
        'varying vec3 vColor;',
        'varying float vAlpha;',
        'varying float vRing;',
        'varying float vPS;',
        CURL_GLSL,
        'void main(){',
        '  vec3 home = position;',

        /* 목록 호버 → 그 항목이 맡은 각도 구간이 바깥으로 부푼다 */
        '  if(uPulse > 0.001 && uPulseA >= 0.0){',
        '    float da = abs(mod(aSeed - uPulseA + 9.42477, 6.28318) - 3.14159);',
        '    float nearv = 1.0 - clamp(da / 0.5, 0.0, 1.0);',
        '    home *= 1.0 + nearv * uPulse * 0.16;',
        '  }',

        /* 컬 노이즈 드리프트 — 레퍼런스 Curl Noise 프리셋과 같은 구성.
           표면 입자는 살짝, 부유 입자(aRand 큰 쪽)는 크게 흔들린다. */
        /* [수정] uDriftAmp 가 0 이면 변위 자체가 사라진다.
           속도(uDrift)만 줄이면 느리게 계속 꿈틀거린다 — 진폭을 함께 죽여야 멎는다. */
        /* [수정] 진폭 0.055~0.155 는 링 반경(2.15) 대비 커서, 커서를 움직이는 내내
           표면 전체가 물결쳤다("꿈틀거림"). 살아 있는 기색만 남기고 절반으로 줄인다. */
        /* [수정] 진폭 0.024~0.072 는 링 반경(2.0×0.74=1.48) 대비 최대 5% 다.
           컬 노이즈는 저주파라 그만큼이 통째로 부풀었다 꺼지며 '조직이 꿀렁이는' 인상을 냈다.
           진폭을 1/5 로 줄이고, 대신 노이즈 주파수를 올려 큰 덩어리 스웰이 아니라
           표면에 잔결만 남게 한다. */
        /* [수정] 0.005~0.014 는 링 반경(1.48) 의 1% 미만 — 위상은 흐르는데 눈에는 정지였다.
           진폭을 2.4배 키우고(≈2%) 대신 아래 위상 속도를 절반으로 늦춘다.
           빠르고 작은 떨림 → 느리고 넓은 물결. 예전 '꿀렁임' 은 노이즈 주파수가
           낮아 덩어리째 부푼 탓이라, 주파수 2.10 은 그대로 두면 재발하지 않는다. */
        '  float amp = (0.012 + aRand * 0.022) * uDriftAmp;',
        /* [버그 수정] 예전엔 위상을 uTime * uDrift 로 만들었다.
           대기로 들어갈 때 uDrift 가 0.052 → 0 으로 줄어드는데 uTime 은 계속 커지므로,
           둘의 곱(= 위상)이 순식간에 큰 값에서 0 으로 쓸려 내려간다.
           예: 60초 시점이면 위상이 3.12 → 0 으로 0.9초 만에 훑어 지나간다 —
           마우스를 멈추고 몇 초 뒤 '부르르 떨리던' 것이 이 역주행이다.
           위상은 CPU 에서 누적해 넘긴다. 속도가 0 이 되면 그냥 멈출 뿐 되감기지 않는다. */
        '  vec3 drift = curlNoise(home * 2.10 + vec3(uDriftPh)) * amp;',
        '  home += drift * uForm;',

        /* 진입 : 흩어진 자리에서 토러스로. smoothstep 으로 감속시킨다. */
        '  float f = uForm * uForm * (3.0 - 2.0 * uForm);',
        '  vec3 pos = mix(aScatter, home, f);',

        /* ── 커서 근처 입자가 바깥으로 퍼진다 ────────────────────────────
           [전면 수정] 예전 구현에는 '꿈틀거림' 의 원인이 두 개 있었다.

           1) fall = exp(-d²·0.12) — 감쇠가 너무 완만해서 화면 절반의 입자가
              동시에 반응했다. 커서를 조금만 움직여도 구름 전체가 출렁여서
              '근처가 퍼지는' 게 아니라 '덩어리가 밀린다' 로 보였다.
           2) swirl = curlNoise(pos + uTime*0.5) 를 미는 방향에 섞었다.
              uTime 이 들어가므로 커서가 가만히 있어도 미는 방향이 매 프레임
              바뀐다 — 입자가 제자리에서 계속 꼼지락거린 실체가 이것이다.

           지금은 순수 반경 방향으로만, 지정한 반경 안에서만 민다.
           시간항이 없으므로 커서가 멈추면 모양도 완전히 멎는다. */
        /* 거리는 3D 로 잰다. 링은 로컬 XZ 평면에 눕고 Y 는 두께라, xy 만 보면
           깊이가 다른 입자까지 같은 거리로 취급돼 반대편 입자가 같이 튄다. */
        '  vec3 dm = pos - uMouse;',
        '  float dl = length(dm);',
        /* 반경 밖은 정확히 0 — exp 처럼 화면 절반까지 꼬리가 남지 않는다 */
        '  float fall = 1.0 - smoothstep(0.0, uRadius, dl);',
        '  fall *= fall;',                    /* 가장자리를 더 급하게 죽여 '근처' 를 좁힌다 */
        '  pos += normalize(dm + vec3(1e-4)) * fall * uPush * uSpread;',
        /* 표면에서 화면 앞쪽으로 솟는다 — 이게 없으면 아무리 밀어도
           평면 위에서 번지는 그림이 된다(사용자 지적: "2D처럼 움직인다"). */
        '  pos += uCamL * fall * uPush * uLift;',

        /* 링 파동(sweep) — 각 파동은 원점에서 바깥으로 퍼지는 얇은 띠다.
           띠에 걸린 입자만 반경 방향으로 밀렸다가, 띠가 지나가면 제자리로 돌아온다.
           MARS 카드의 물결과 같은 인상을 입자 변위로 낸 것. */
        '  float ripLit = 0.0;',
        '  for(int k = 0; k < 4; k++){',
        '    float age = uRipAge[k];',
        '    if(age < 0.0) continue;',
        '    vec2 rd = pos.xy - uRipOrig[k];',
        '    float rl = length(rd);',
        '    float radius = age * 8.2;',           /* 파동이 닿는 거리 확대 */                 /* 링이 퍼지는 속도 */
        '    float band = 1.0 - smoothstep(0.0, 1.9, abs(rl - radius));',   /* 띠 폭도 넓게 */
        '    float life = 1.0 - age;',                   /* 나이 들수록 약해진다 */
        '    float amt = band * life * life;',
        '    pos.xy += normalize(rd + vec2(0.0001)) * amt * 0.20;',
        '    pos.z  += sin(amt * 3.14159) * 0.10;',      /* 띠 위에서 살짝 솟는다 */
        '    ripLit = max(ripLit, amt);',
        '  }',
        '  vec3 c = aColor;',
        /* 띠가 지나갈 때 그 자리만 잠깐 밝아진다 — 물결이 눈에 보이게 */
        '  c = mix(c, c * 1.7 + vec3(0.16, 0.07, 0.07), ripLit * 0.55);',
        /* 클릭 파동 : 중심에서 퍼지는 얇은 띠가 레드로 달아오른다 */
        '  if(uWave >= 0.0){',
        '    float band = 1.0 - smoothstep(0.0, 0.5, abs(length(pos) - uWave * 3.6));',
        '    c = mix(c, vec3(1.0, 0.176, 0.510), band * 0.9);',
        '  }',
        '  vColor = c;',

        '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
        '  gl_Position = projectionMatrix * mv;',
        '  float dist = max(-mv.z, 0.6);',
        /* 레퍼런스의 점은 아주 작고 또렷하다(1~2px). 크게 잡으면 헤일로가 겹쳐
           모래알이 아니라 안개가 된다. 캡을 낮게 둔다. */
        /* 거리 반비례를 그대로 쓰되 범위를 넓힌다 — 앞의 입자는 굵고 뒤는 먼지처럼.
           범위가 좁으면 전부 같은 크기로 보여 2D 스티커처럼 읽힌다. */
        /* 점도 키운다 — 거리 계수와 상한을 함께 올린다 */
        /* [요청] 입자 자체를 더 크게. 거리 계수 9.0→15.0, 상한 6.2→10.5, 하한 1.1→1.8.
           앞뒤 비율은 그대로라 깊이감은 유지되고 전체 굵기만 올라간다. */
        /* [피사계 심도] 레퍼런스는 사진처럼 초점이 얕다 — 초점면에서 멀어질수록
           점이 커지고(착란원) 가운데가 비어 고리로 보인다.
           uFocus 는 카메라에서 링 중심까지의 거리다. */
        '  float dof = clamp(abs(dist - uFocus) / uDofRange, 0.0, 1.0);',
        /* [수정] 레퍼런스는 점이 아주 작다 — 조밀해도 뭉개지지 않고 모래처럼 읽히고,
           본문 글자 위에 깔려도 가독성을 덜 해친다. 10.5→6.6, 상한 8.5→5.0 */
        '  gl_PointSize = clamp(uPR * (8.0 / dist) * (0.75 + dof * 1.2), uPR * 1.2, uPR * 6.0);',
        '  vPS = gl_PointSize;',
        /* 초점이 나갈수록, 그리고 개체 편차가 큰 것일수록 고리에 가깝다.
           전부 고리가 되면 지저분하므로 일부만 걸리게 aRand 를 곱한다. */
        '  vRing = dof * smoothstep(0.55, 1.0, aRand);',
        /* 깊이 안개 — 뒤로 갈수록 흐려진다. 앞뒤 대비가 생겨야 깊이가 보인다. */
        '  float depth = clamp((dist - 3.0) / 6.0, 0.0, 1.0);',
        /* [수정] 뒤쪽을 0.20 까지 떨어뜨리니 링의 절반이 사라져 평면처럼 보였다.
           앞뒤 대비는 남기되 뒤쪽도 읽히게 한다. */
        '  vAlpha = mix(1.0, 0.42, depth) * uFade;',
        /* [반짝임] 입자마다 다른 위상·속도로 투명도가 1 ↔ 0 을 오간다.
           위상은 aSeed(링 각도)와 aRand 를 섞은 해시로 뽑는다 — aRand 만 쓰면
           고리(vRing)·드리프트와 같은 값을 공유해 깜빡임이 그것들과 붙어 버린다.
           속도도 입자마다 0.6~1.4배로 흩어 놓아야 화면 전체가 한 박자로
           숨쉬는 것처럼 보이지 않는다. */
        '  float twPh = fract(sin(aSeed * 91.7 + aRand * 47.3) * 43758.5453);',
        '  float twSp = 0.6 + twPh * 0.8;',
        '  vAlpha *= 0.5 + 0.5 * sin(uTime * uTwSpeed * twSp + twPh * 62.83);',
        /* [스파클] 느린 명멸 위에 짧은 섬광을 얹는다. sin 을 28제곱으로 누르면
           대부분의 시간은 0 이고 아주 짧게만 1 에 닿는다 — 별이 튀듯 반짝인다.
           입자마다 위상·속도가 달라 한 순간에 몇 개만 걸린다. */
        '  float sp = pow(max(0.0, sin(uTime * uSpSpeed * (0.7 + twPh * 0.9) + twPh * 31.4)), 28.0);',
        '  vColor += vColor * sp * 2.6;',
        '  vAlpha = min(1.0, vAlpha + sp * 0.85);',
        '  vColor *= mix(1.30, 0.72, depth);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'varying vec3 vColor;',
        'varying float vAlpha;',
        'varying float vRing;',
        'varying float vPS;',
        'void main(){',
        '  vec2 uv = gl_PointCoord - 0.5;',
        '  float d = length(uv) * 2.0;',
        '  if(d > 1.0) discard;',
        /* [보케] 레퍼런스의 입자는 솜털 같은 헤일로가 아니라 '납작한 원판' 이다 —
           가장자리만 안티에일리어싱하고 안쪽은 균일하게 채운다.
           [버그] 문턱을 0.86 처럼 고정하면 점이 작을 때 그 폭이 1픽셀도 안 돼
           계단이 그대로 드러난다 — 원이 아니라 사각형·마름모로 보였다.
           경계 폭을 실제 점 크기(vPS)에서 역산해 항상 2픽셀쯤 되게 잡는다. */
        '  float aa = clamp(2.0 / max(vPS, 1.0), 0.06, 0.6);',
        '  float disc = 1.0 - smoothstep(1.0 - aa, 1.0, d);',
        /* 실제 렌즈 보케는 테두리가 더 밝다. 초점이 나갈수록 이 띠만 남는다. */
        '  float rim = smoothstep(0.50, 1.0 - aa, d) * disc;',
        /* 고리형 : 초점이 크게 나간 입자는 가운데가 뚫려 도넛/초승달로 보인다 */
        '  float hollow = mix(1.0, smoothstep(0.16, 0.76, d), vRing);',
        '  float a = disc * hollow * vAlpha;',
        '  vec3 col = vColor * (1.0 + rim * (0.5 + 1.9 * vRing));',
        '  gl_FragColor = vec4(col, a);',
        '}'
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      depthTest: false,
      /* [겹침 처리] 가산 합성은 입자가 겹칠수록 흰색으로 날아간다(번들거림).
         일반 알파 합성으로 바꾸면 겹친 자리가 위 입자의 색으로 눌려, 잉크를 겹쳐 칠한
         것처럼 색이 진해진다 — 요청한 'multiply 되는' 인상이 이쪽이다.
         진짜 MultiplyBlending 은 배경이 검정이라(색 × 0 = 0) 전부 사라진다. */
      blending: THREE.NormalBlending
    });

    var cloud = new THREE.Points(geo, mat);
    /* [배치] 전체 크기 0.9배, 그리고 왼쪽으로 옮겨 오른쪽 본문과 조금만 겹치게 한다.
       월드 단위 offset 이라 화면 폭에 따라 겹치는 비율이 달라진다 —
       카메라 화각에서 역산해 '화면 폭의 몇 %' 로 고정한다(아래 layout()). */
    cloud.scale.setScalar(TORUS_SCALE);
    scene.add(cloud);

    /* 링 중심을 화면 가로 어디에 둘지(0 = 왼쪽 끝, 1 = 오른쪽 끝).
       0.5 가 정중앙. 0.38 이면 왼쪽으로 옮겨져 오른쪽 본문을 살짝만 덮는다. */
    function layout() {
      var halfH = Math.tan(cam.fov * Math.PI / 360) * cam.position.z;
      var halfW = halfH * cam.aspect;
      cloud.position.x = (TORUS_CENTER_X - 0.5) * 2 * halfW;
    }
    /* resize() 는 크기가 그대로면 일찍 빠져나가므로 여기서 한 번 직접 잡는다 */
    layout();

    /* ---- 상태 ---------------------------------------------------------- */
    /* 커서 정규화 좌표(-1..1) — 카메라 시차에만 쓴다. 물체 자체는 기울이지 않는다. */
    var pnx = 0, pny = 0;
    var spin = 0;
    var form = 0, fade = 0, t0 = 0;
    /* 진입은 '프레임 수' 가 아니라 '경과 시간' 으로 센다.
       프레임당 증가로 두면 30fps 기기에서 두 배로 늘어진다. 시간 기준이면 어디서나 같다.
       [수정] 페이드는 사실상 즉시(120ms) — 버튼을 누르면 글자와 같이 바로 떠야 한다.
       수렴(FORM)만 짧게 남겨 '모여드는' 인상을 지킨다. */
    var FORM_MS = 900, FADE_MS = 120;
    var waveT = -1;
    var pushTarget = 0, push = 0;
    var camVX = 0, camVY = 0, ppx = 0, ppy = 0;   /* 카메라 자유 항해 속도 + 직전 커서 위치 */
    var mouseNDC = new THREE.Vector3(999, 999, 0.5);
    var pulseAmt = 0;
    var lastMove = 0, idle = 1;   /* 1 = 완전 대기 */
    /* 링 파동 풀 — 가장 오래된 것부터 덮어쓴다 */
    var ripAge = [-1, -1, -1, -1], ripSlot = 0, lastRip = 0;
    var raf = 0, running = false, started = false;
    var frames = 0, fpsT0 = 0, prevNow = 0, driftPh = 0;
    var mWorld = new THREE.Vector3();
    var camL   = new THREE.Vector3(0, 0, 1);   /* 카메라의 구름 로컬 방향 */

    function resize() {
      var nw = canvas.clientWidth || 1, nh = canvas.clientHeight || 1;
      /* 크기가 그대로면 아무것도 하지 않는다 — setSize 는 프레임버퍼를 다시 잡아
         18만 개 규모에서는 눈에 띄는 끊김이 된다. */
      if (nw === W && nh === H && renderer.getPixelRatio() === mat.uniforms.uPR.value) return;
      W = nw; H = nh;
      renderer.setSize(W, H, false);
      cam.aspect = W / H; cam.updateProjectionMatrix();
      mat.uniforms.uPR.value = renderer.getPixelRatio();   /* 항상 동기화 */
      layout();   /* 가로 위치는 화각·비율에 따라 달라진다 — 크기가 바뀌면 다시 잡는다 */
    }

    /* 1D 부드러운 값 노이즈 : 반복 없는 배회용. 정수 격자에서 해시를 뽑아
       smoothstep 으로 잇는다(사인처럼 되돌아오지 않고 계속 새 자리로 흐른다). */
    function hash1(n){ var x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }
    function nz1(t){
      var i = Math.floor(t), f = t - i;
      var u = f * f * (3 - 2 * f);
      return hash1(i) * (1 - u) + hash1(i + 1) * u;
    }

    function frame(now) {
      if (!running) { raf = 0; return; }

      /* 실측 fps 로 픽셀비만 낮춘다. 위치 계산은 GPU 로 넘겼으니 입자 수는 건드리지 않는다. */
      frames++;
      if (!fpsT0) fpsT0 = now;
      else if (now - fpsT0 > 1600) {
        var fps = frames * 1000 / (now - fpsT0);
        /* [버그 수정] 예전엔 setPixelRatio 만 내렸다. gl_PointSize 는 uPR(고정값)로
           계산하므로, 드로잉 버퍼만 작아지고 점 크기는 그대로 → 화면상에서 점이
           갑자기 커지고 밝아졌다("작았다가 갑자기 커지는" 그 증상).
           픽셀비를 바꿀 때는 uPR 도 같이 맞춰야 점의 실제 크기가 유지된다. */
        if (fps < 34 && renderer.getPixelRatio() > 1) {
          renderer.setPixelRatio(1);
          mat.uniforms.uPR.value = 1;
        }
        frames = 0; fpsT0 = now;
      }

      if (!t0) t0 = now;
      var el = now - t0;
      /* [중요] 단조 증가만 허용한다. 어떤 이유로든 t0 가 늦게 잡히면 form 이 0 으로
         되돌아가 입자가 시작점으로 다시 날아간다("시작점에서 재로딩"). */
      form = reduce ? 1 : Math.max(form, Math.min(1, el / FORM_MS));
      fade = Math.max(fade, Math.min(1, el / FADE_MS));

      /* [끊김] 아래 보간 계수는 전부 '한 프레임당' 값이었다. 다른 캔버스와 GPU 를
         나눠 쓰다 프레임이 20fps 로 떨어지면 같은 시간에 1/3 만 진행하고, 회복되면
         갑자기 따라잡는다 — 커서를 움직일 때 "끊기다가 원래 모양으로 되돌아가는" 것처럼
         보이던 실체가 이것이다. 60fps 기준으로 정규화해 프레임률과 무관하게 만든다. */
      var dtms = prevNow ? Math.min(100, now - prevNow) : 16.667;
      prevNow = now;
      var kf = dtms / 16.667;                                   /* 60fps = 1 */
      var ease = function (f) { return 1 - Math.pow(1 - f, kf); };

      /* [전면 수정] 예전엔 커서 위치로 구름 전체를 기울이고(tiltX/tiltY)
         카메라까지 반대쪽으로 흔들었다. 추종 계수가 0.010(= 매우 느림)이라
         덩어리가 커서를 뒤늦게 질질 따라오는 모양이 됐다 —
         "렉 걸린 것처럼 움직인다" 가 정확히 이것이다.
         커서는 이제 '입자를 퍼뜨리는' 역할만 한다(셰이더 uPush/uRadius).
         물체 자체는 커서와 무관하게 아주 느린 자전만 한다. */
      /* [수정] 대기 자전이 0.00016 rad/프레임(≈0.55°/s)이라 멈춘 것처럼 보였다.
         메인 성운처럼 커서와 무관하게 계속 도는 속도로 올린다(≈2.2°/s). */
      spin += (idle > 0.5 ? 0.00062 : 0.0009) * kf;
      /* [수정] Y 자전 하나뿐이라 '제자리에서 도는 도넛' 이었다. 레퍼런스는 축이 함께
         흔들리며 천천히 텀블링한다 — 기울기 두 축에 느린 노이즈를 얹는다(주기 없음). */
      var tw = now * 0.001;
      /* [실측] 레퍼런스는 세로/가로 = 1.0 → 링을 거의 정면으로 본다.
         -1.06(세로 87%) 보다 눕혀 -1.32(세로 97%) 로 잡는다. */
      cloud.rotation.set(
        -1.32 + (nz1(tw * 0.055 +  5.1) - 0.5) * 0.30,
        spin,
         0.14 + (nz1(tw * 0.042 + 19.6) - 0.5) * 0.38
      );

      /* [3D 시차] 물체를 기울이는 대신 카메라가 링 둘레를 조금 돈다.
         예전 코드도 카메라를 움직이긴 했는데 진폭이 0.021(= tiltY 0.07 × 0.30)
         이었다 — 5.2 거리에서 0.2° 라 시차가 눈에 보일 리가 없었고,
         그래서 아무리 마우스를 움직여도 평면처럼 보였다.
         진폭을 실제로 보이는 크기로 올리고, 추종은 빠르게(0.12) 해서
         예전처럼 덩어리가 뒤늦게 끌려오는 인상이 생기지 않게 한다. */
      /* [핵심] 예전엔 카메라 목표가 '커서 위치' 뿐이라, 커서가 멈추면 목표도 고정 →
         카메라가 그 자리에 수렴하고 시차가 죽어 전체가 얼어붙어 보였다.
         메인 성운(app.js)은 커서 값에 느린 사인 배회를 더해 늘 움직인다 — 같은 방식으로,
         커서를 놓으면(idle→1) 배회가 그 자리를 대신 채운다. */
      /* [수정] 사인 배회는 주기가 있어 같은 자리로 되돌아온다("원위치").
         부드러운 값 노이즈(fbm)를 시간 축으로 흘려 보내면 궤적이 반복되지 않는다 —
         물이 흐르듯 매번 다른 자리로 간다. 노이즈는 아래 nz1() 참고. */
      /* [핵심 수정] 목표 좌표를 없앤다.
         이전 구조 tg = pnx*(1-idle) + wx*idle 는 커서를 놓는 순간 커서 성분이
         빠지면서 카메라가 '배회 좌표'로 반드시 끌려갔다 — 이게 매번 같은 자리로
         돌아가는 것처럼 보인 원인이다(pointerOut 은 아예 0,0 으로 리셋했다).
         이제 카메라는 목표 없이 속도를 적분한다. 커서는 위치가 아니라 물을 젓는
         '충격량'으로만 들어오므로, 멈춰도 빠져나갈 성분 자체가 없다. */
      var dts = Math.min(0.05, dtms * 0.001);
      var ts  = now * 0.001;

      /* 흐름장 : 방향이 계속 바뀌는 노이즈 속도. 평균이 0 근처라 한쪽으로 튀지 않는다. */
      var fx = (nz1(ts * 0.085 +  3.7) - 0.5) * 0.90 + (nz1(ts * 0.23 + 11.2) - 0.5) * 0.30;
      var fy = (nz1(ts * 0.071 + 27.4) - 0.5) * 0.72 + (nz1(ts * 0.19 + 41.9) - 0.5) * 0.24;

      /* 수반: 흐름장을 그대로 쓰지 않고 속도를 서서히 그쪽으로 끌어 관성을 준다 */
      camVX += (fx - camVX) * (1 - Math.pow(0.14, dts));
      camVY += (fy - camVY) * (1 - Math.pow(0.14, dts));

      /* 수조 벽 : 반경 1.15 를 넘어설 때만 안쪽으로 민다(고정점이 아니라 경계다) */
      var rr = Math.sqrt(cam.position.x * cam.position.x + cam.position.y * cam.position.y);
      if (rr > 1.15) {
        var over = (rr - 1.15) * 2.4 * dts;
        camVX -= (cam.position.x / rr) * over;
        camVY -= (cam.position.y / rr) * over;
      }

      cam.position.x += camVX * dts;
      cam.position.y += camVY * dts;
      cam.lookAt(0, 0, 0);

      /* 마지막 커서 움직임에서 1.2초가 지나면 대기 상태로 본다 */
      idle = Math.min(1, Math.max(0, (now - lastMove - 500) / 700));   /* 멈추면 0.5초 뒤부터 잦아든다 */
      /* [정지] 하한을 0 으로 둔다. 0.010/0.06 을 남겨 뒀더니 마우스를 안 움직여도
         계속 느리게 일렁였다("꿈틀거림"). 대기 상태에서는 흐름을 완전히 끈다. */
      /* 위상 누적 — dtms 는 위에서 잰 프레임 간격(ms).
         [수정] 예전엔 (1 - idle) 을 그대로 곱해서 커서가 멈추면 위상도 진폭도 0 이 됐다.
         구름이 그 자리에서 '툭' 얼어붙어 보이던 원인이다. 바닥값을 남겨 두면
         커서가 없어도 아주 느리게 계속 숨 쉰다(대기 상태에서 속도 35% · 진폭 26%). */
      /* 대기 상태에서도 이 정도는 계속 흐른다. 0.26 은 amp 가 0.0013 까지 떨어져
         사실상 정지였다 — 멈춘 뒤 1초쯤 보이던 건 커서 밀어냄(push)이 풀리는 잔여였다.
         진폭을 살려 두면 커서와 무관하게 같은 속도로 계속 일렁인다.
         (예전 '꿈틀거림' 은 밀어내는 *방향*에 uTime 을 섞어서 났던 것이고,
          이 드리프트는 curl 노이즈를 따라 흐르는 결이라 결이 다르다) */
      var IDLE_SPD = 0.62, IDLE_AMP = 0.82;
      var live = 1 - idle;
      driftPh += (IDLE_SPD + (1 - IDLE_SPD) * live) * 0.0088 * (dtms * 0.001) * 60;
      mat.uniforms.uDriftPh.value  = driftPh;
      mat.uniforms.uDriftAmp.value = IDLE_AMP + (1 - IDLE_AMP) * live;
      push += (pushTarget - push) * ease(0.12);

      /* 파동 나이 진행 — 1 을 넘으면 꺼진다 */
      var RU = mat.uniforms.uRipAge.value;
      for (var k = 0; k < 4; k++) {
        if (ripAge[k] >= 0) { ripAge[k] += 0.012 * kf; if (ripAge[k] > 1) ripAge[k] = -1; }
        RU[k] = ripAge[k];
      }
      if (pulseAmt > 0) pulseAmt *= Math.pow(0.94, kf);
      if (waveT >= 0) { waveT += 0.016 * kf; if (waveT > 1.3) waveT = -1; }

      /* 커서 화면좌표 → 구름의 '로컬' 좌표.
         [버그] 예전엔 unproject 결과에 2.4 를 곱해 그대로 uMouse 로 넘겼다.
         그런데 셰이더의 pos 는 구름 로컬 좌표이고 구름은 rotation(-1.06, spin, 0.14)
         만큼 돌아 있다 — 두 좌표계가 달라서 '커서 근처' 가 실제 커서 위치와 어긋났다.
         예전엔 감쇠가 화면 절반까지 퍼져 있어 티가 안 났을 뿐이다.
         카메라에서 커서로 쏜 광선을 토러스 중심면(z=0)과 만나게 한 뒤 로컬로 변환한다. */
      mWorld.copy(mouseNDC).unproject(cam).sub(cam.position).normalize();
      var tHit = mWorld.z !== 0 ? -cam.position.z / mWorld.z : 0;
      mWorld.multiplyScalar(tHit).add(cam.position);
      cloud.updateMatrixWorld();
      cloud.worldToLocal(mWorld);

      /* 카메라가 구름의 로컬 좌표계에서 어느 쪽에 있는지 — 셰이더가 이 방향으로
         입자를 띄운다(= 화면 앞쪽). 구름이 자전하므로 매 프레임 다시 구한다. */
      camL.copy(cam.position);
      cloud.worldToLocal(camL);
      camL.normalize();

      var U = mat.uniforms;
      U.uTime.value = now * 0.001;
      U.uForm.value = form;
      U.uFade.value = fade;
      U.uPush.value = push;
      U.uWave.value = waveT;
      U.uPulse.value = pulseAmt;
      U.uMouse.value.copy(mWorld);
      U.uCamL.value.copy(camL);

      renderer.render(scene, cam);
      raf = requestAnimationFrame(frame);
    }

    var api = {
      start: function () {
        if (running) return;
        running = true;
        if (!started) { started = true; t0 = 0; }   /* 첫 진입에만 수렴 연출 */
        resize();
        if (!raf) raf = requestAnimationFrame(frame);
      },
      stop: function () {
        running = false;
        prevNow = 0;   /* 다시 켤 때 멈춰 있던 시간만큼 한 프레임에 몰아 진행하지 않게 */
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
      },
      resize: resize,
      /* nx, ny : -1..1 정규화 좌표 */
      pointer: function (nx, ny) {
        /* 커서 이동량을 카메라 속도에 실어 준다(물 젓기). 절대 위치로 잡아 두지
           않으므로, 손을 떼도 되돌아갈 기준점이 없다 — 젓던 결이 그대로 흘러간다. */
        camVX += (nx - ppx) * 2.2;
        camVY += (ny - ppy) * 1.7;
        ppx = nx; ppy = ny;
        pnx = nx; pny = ny;
        mouseNDC.set(nx, ny, 0.5);
        lastMove = performance.now();
        pushTarget = reduce ? 0 : 1;
        /* [제거] 예전엔 커서가 움직이는 동안 420ms 마다 링 파동을 하나씩 뿌렸다.
           그 파동들이 겹치면서 표면이 계속 출렁여, 커서 근처가 '퍼지는' 게 아니라
           오브제 전체가 물결치는 것처럼 보였다.
           커서 반응은 이제 셰이더의 반경 밀어내기 하나로만 낸다.
           (링 파동은 클릭 시 wave() 로만 남는다 — 되살리려면 아래 주석을 풀면 된다.)
        if (reduce) return;
        var now = performance.now();
        if (now - lastRip < 420) return;
        lastRip = now;
        mWorld.set(nx, ny, 0.5).unproject(cam);
        mat.uniforms.uRipOrig.value[ripSlot].set(mWorld.x * 2.4, mWorld.y * 2.4);
        ripAge[ripSlot] = 0;
        ripSlot = (ripSlot + 1) % 4; */
      },
      /* [수정] 예전엔 여기서 pnx/pny 를 0 으로 되돌려 카메라가 정중앙으로
         쓸려 갔다. 이제 카메라는 커서 위치를 참조하지 않는다 — 밀어냄만 푼다. */
      pointerOut: function () { pushTarget = 0; },
      wave: function () { if (!reduce) waveT = 0; },
      pulse: function (idx, total) {
        if (reduce || idx == null || !total) { pulseAmt = 0; mat.uniforms.uPulseA.value = -1; return; }
        mat.uniforms.uPulseA.value = (idx / total) * TAU;
        pulseAmt = 1;
      },
      clearPulse: function () { pulseAmt = 0; mat.uniforms.uPulseA.value = -1; },
      isStarted: function () { return started; },
      count: COUNT
    };

    addEventListener('resize', resize);
    return api;
  }

  global.ArgoTorus = { create: create };
})(window);
