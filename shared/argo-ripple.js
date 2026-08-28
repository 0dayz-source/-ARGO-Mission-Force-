/* ============================================================================
   RippleDistortion — React Bits <RippleDistortion /> 바닐라 이식.
   원본: npx shadcn@latest add @react-bits/RippleDistortion-JS-CSS  (React + ogl)
   "Pointer-driven water displacement that warps content and leaves a decaying wake."

   이 프로젝트는 React 도 ogl 도 쓰지 않으므로 MetaBalls·WavePath·FoldText·
   OptionWheel 과 같은 방식으로 옮겼다. 2-패스 구조와 셰이더 수식은 원본 그대로다:

     1) wave 패스  — 인스턴싱된 원형 브러시 100개를 가산 합성(ONE,ONE)으로
                     오프스크린 FBO(변위장)에 그린다. 각 파동은 지수적으로
                     커지면서(growth) 지수적으로 사라진다(decay).
     2) composite 패스 — 변위장의 r 값으로 소스 텍스처의 UV 를 밀어(swirl 방향)
                     샘플링한다. 색수차(dispersion)·틴트·법선 기반 글린트 동일.

   ogl 의 Renderer/Program/RenderTarget 대신 raw WebGL1 +
   ANGLE_instanced_arrays 를 직접 쓴다.

   원본과 다른 점은 딱 하나 — 소스가 이미지가 아니라 알파를 가진 절차적
   글래스 텍스처다. MISSION SYSTEMS 카드는 배경 도트가 비쳐야 하는 투명
   글래스라서, 불투명 사진을 깔면 카드가 막혀 버린다. 그래서 텍스처를
   RGBA 로 만들고 composite 가 알파까지 변위시켜 출력한다. 결과적으로
   "카드 표면 유리막이 커서를 따라 일렁이는" 그림이 된다.

   사용:
     ArgoRipple.create(mountEl, { strength:0.14, glint:0.35, ... });
   ============================================================================ */
(function (global) {
  'use strict';

  var MAX_WAVES = 100;
  var QUALITY_SCALE = { low: 0.4, medium: 0.7, high: 1 };
  var START_SCALE = 1.5;
  var LIFE_CONSTANT = Math.log(500);

  /* ---------------------------------------------------------------- 셰이더 */

  var WAVE_VS = [
    'precision highp float;',
    'attribute vec2 position;',
    'attribute vec2 uv;',
    'attribute vec2 iOffset;',
    'attribute vec2 iScale;',
    'attribute float iOpacity;',
    'varying vec2 vUv;',
    'varying float vOpacity;',
    'void main(){',
    '  vUv = uv;',
    '  vOpacity = iOpacity;',
    '  gl_Position = vec4(iOffset + position * iScale, 0.0, 1.0);',
    '}'
  ].join('\n');

  var WAVE_FS = [
    'precision highp float;',
    'varying vec2 vUv;',
    'varying float vOpacity;',
    'uniform float uRings;',
    'const float PI = 3.141592653589793;',
    'const float EDGE = 0.006737947;',
    'void main(){',
    '  vec2 p = vUv * 2.0 - 1.0;',
    '  float r = dot(p, p);',
    '  if (r > 1.0) discard;',
    '  float brush = (exp(-r * 5.0) - EDGE) / (1.0 - EDGE);',
    '  brush *= 0.55 + 0.45 * cos(sqrt(r) * PI * 2.0 * uRings);',
    '  gl_FragColor = vec4(vec3(brush * vOpacity * vOpacity), 1.0);',
    '}'
  ].join('\n');

  var SCREEN_VS = [
    'precision highp float;',
    'attribute vec2 position;',
    'attribute vec2 uv;',
    'varying vec2 vUv;',
    'void main(){ vUv = uv; gl_Position = vec4(position, 0.0, 1.0); }'
  ].join('\n');

  /* 원본 compositeFragment. 다른 곳은 그대로 두고 마지막 출력만 알파를 살린다. */
  var COMPOSITE_FS = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform sampler2D uTexture;',
    'uniform sampler2D uDisplacement;',
    'uniform vec2 uResolution;',
    'uniform vec2 uTextureSize;',
    'uniform vec2 uTexel;',
    'uniform vec3 uTint;',
    'uniform vec3 uHighlight;',
    'uniform float uStrength;',
    'uniform float uSwirl;',
    'uniform float uDispersion;',
    'uniform float uGlint;',
    'uniform float uTintAmount;',
    'uniform float uGrayscale;',
    'uniform float uAlpha;',
    'const float TAU = 6.283185307179586;',
    'vec2 coverUV(vec2 uv){',
    '  vec2 safe = max(uTextureSize, vec2(1.0));',
    '  vec2 s = uResolution / safe;',
    '  vec2 scaledSize = safe * max(s.x, s.y);',
    '  vec2 offset = (uResolution - scaledSize) * 0.5;',
    '  return (uv * uResolution - offset) / scaledSize;',
    '}',
    'void main(){',
    '  float amount = texture2D(uDisplacement, vUv).r;',
    '  vec2 base = coverUV(vUv);',
    '  float theta = amount * uSwirl * TAU;',
    '  vec2 dir = vec2(sin(theta), cos(theta));',
    '  vec2 push = dir * amount * uStrength;',
    '  vec4 center = texture2D(uTexture, base + push);',
    '  vec3 color = center.rgb;',
    '  float alpha = center.a;',
    '  if (uDispersion > 0.001) {',
    '    float split = uDispersion * 0.25;',
    '    color.r = texture2D(uTexture, base + push * (1.0 + split)).r;',
    '    color.b = texture2D(uTexture, base + push * (1.0 - split)).b;',
    '  }',
    '  if (uGrayscale > 0.001) {',
    '    color = mix(color, vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), uGrayscale);',
    '  }',
    '  if (uTintAmount > 0.001) {',
    '    color = mix(color, color * uTint * 1.9, clamp(amount * 1.6, 0.0, 1.0) * uTintAmount);',
    '  }',
    '  if (uGlint > 0.001) {',
    '    float ex = texture2D(uDisplacement, vUv + vec2(uTexel.x, 0.0)).r - texture2D(uDisplacement, vUv - vec2(uTexel.x, 0.0)).r;',
    '    float ey = texture2D(uDisplacement, vUv + vec2(0.0, uTexel.y)).r - texture2D(uDisplacement, vUv - vec2(0.0, uTexel.y)).r;',
    '    vec3 normal = normalize(vec3(-ex * 26.0, -ey * 26.0, 1.0));',
    '    vec3 light = normalize(vec3(-0.35, 0.55, 1.0));',
    '    float raw = pow(max(dot(normal, light), 0.0), 22.0);',
    '    float flatSpec = pow(max(light.z, 0.0), 22.0);',
    '    float spec = clamp((raw - flatSpec) / max(1.0 - flatSpec, 0.0001), 0.0, 1.0) * uGlint;',
    '    color += uHighlight * spec;',
    /*     물결 마루에서만 유리막이 살짝 두꺼워 보이게 — 알파도 같이 올린다 */
    '    alpha = clamp(alpha + spec * 0.5, 0.0, 1.0);',
    '  }',
    '  gl_FragColor = vec4(color * alpha * uAlpha, alpha * uAlpha);',
    '}'
  ].join('\n');

  /* ---------------------------------------------------------------- 유틸 */

  function hexToRGB(hex) {
    var clean = String(hex || '').replace('#', '');
    var full = clean.length === 3 ? clean.split('').map(function (c) { return c + c; }).join('') : clean;
    var n = parseInt(full, 16);
    if (isNaN(n)) return [1, 1, 1];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('[argo-ripple] shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  function link(gl, vsSrc, fsSrc) {
    var vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
    var fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn('[argo-ripple] link:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  function uniforms(gl, p, names) {
    var u = {};
    names.forEach(function (n) { u[n] = gl.getUniformLocation(p, n); });
    return u;
  }

  /* ---- 소스 텍스처 : ARGO 글래스 시트를 캔버스2D 로 그린다 ----------------
     사진 대신 절차적으로 만드는 이유는 (1) 외부 에셋/CORS 가 없고
     (2) 알파를 직접 설계할 수 있고 (3) 카드마다 seed 로 결을 다르게
     줄 수 있어서다. 변위가 눈에 보이려면 텍스처에 결이 있어야 하므로
     블룸 + 사선 결 + 그레인을 섞는다.

     blooms 는 색 블룸 목록이다. 형식은 CSS radial-gradient 를 그대로 옮긴 꼴:
       { x:0.20, y:0.30, r:0.32, rgb:'255,154,122', a:0.5 }
     (x,y,r 은 텍스처 한 변에 대한 비율) */
  function glassTexture(seed, blooms) {
    var S = 512;
    var c = document.createElement('canvas');
    c.width = c.height = S;
    var x = c.getContext('2d');

    /* 무작위지만 카드마다 재현 가능한 난수 */
    var s = seed * 9301 + 49297;
    function rnd() { s = (s * 9301 + 49297) % 233280; return s / 233280; }

    x.clearRect(0, 0, S, S);

    /* 바탕 유리 — 위가 살짝 밝은 수직 그라디언트 */
    var base = x.createLinearGradient(0, 0, S * 0.35, S);
    /* 바탕은 웜뉴트럴로 — 예전 쿨그레이(190,205,215 / 120,140,155)가 남아서
       블룸을 주황–핑크로만 바꿔도 카드에 파란 기가 5% 정도 섞여 나왔다. */
    base.addColorStop(0, 'rgba(212,250,255,0.10)');
    base.addColorStop(0.45, 'rgba(255,154,122,0.05)');
    base.addColorStop(1, 'rgba(255,61,104,0.085)');
    x.fillStyle = base;
    x.fillRect(0, 0, S, S);

    /* 컬러 블룸. 위치는 카드마다 조금씩 흔들어 같은 그림이 세 번 반복되지 않게 한다
       — 색은 넘겨받은 그대로 쓴다. */
    function bloom(cx, cy, r, col, a) {
      var g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(' + col + ',' + a + ')');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      x.fillStyle = g;
      x.fillRect(0, 0, S, S);
    }
    x.save();
    x.globalCompositeOperation = 'lighter';   /* CSS 의 mix-blend-mode:screen 에 대응 */
    blooms.forEach(function (b) {
      var jx = (rnd() - 0.5) * 0.10, jy = (rnd() - 0.5) * 0.10;
      bloom(S * (b.x + jx), S * (b.y + jy), S * b.r, b.rgb, b.a);
    });
    x.restore();
    bloom(S * rnd(), S * rnd(), S * 0.34, '255,255,255', 0.08);

    /* 사선 결 — 변위가 읽히게 하는 주 구조 */
    x.save();
    x.globalCompositeOperation = 'lighter';
    x.translate(S / 2, S / 2);
    x.rotate(-0.5 + rnd() * 1.0);
    x.translate(-S, -S);
    for (var i = 0; i < 26; i++) {
      var w = 3 + rnd() * 26;
      x.fillStyle = 'rgba(255,255,255,' + (0.010 + rnd() * 0.030).toFixed(3) + ')';
      x.fillRect(rnd() * S * 2, 0, w, S * 2);
    }
    x.restore();

    /* 그레인 — 글린트가 물릴 미세 굴곡 */
    var img = x.getImageData(0, 0, S, S), d = img.data;
    for (var p = 0; p < d.length; p += 4) {
      var n = (rnd() - 0.5) * 26;
      d[p] = Math.max(0, Math.min(255, d[p] + n));
      d[p + 1] = Math.max(0, Math.min(255, d[p + 1] + n));
      d[p + 2] = Math.max(0, Math.min(255, d[p + 2] + n));
      d[p + 3] = Math.max(0, Math.min(255, d[p + 3] + n * 0.5));
    }
    x.putImageData(img, 0, 0);

    /* .sc-iri 의 filter:saturate(1.7) 대응 — 블룸 색이 그대로 살아나게 한다 */
    var sat = document.createElement('canvas');
    sat.width = sat.height = S;
    var sx = sat.getContext('2d');
    sx.filter = 'saturate(1.7)';
    sx.drawImage(c, 0, 0);
    return sat;
  }

  /* ---------------------------------------------------------------- 본체 */

  function create(mount, opts) {
    if (!mount) return null;
    opts = opts || {};

    var brushSize   = opts.brushSize   != null ? opts.brushSize   : 150;
    var strength    = opts.strength    != null ? opts.strength    : 0.2;
    var swirl       = opts.swirl       != null ? opts.swirl       : 1;
    var rings       = opts.rings       != null ? opts.rings       : 4;
    var spread      = opts.spread      != null ? opts.spread      : 5;
    var fade        = opts.fade        != null ? opts.fade        : 3;
    var spacing     = opts.spacing     != null ? opts.spacing     : 15;
    var dispersion  = opts.dispersion  != null ? opts.dispersion  : 0;
    var glint       = opts.glint       != null ? opts.glint       : 0;
    var tintAmount  = opts.tintAmount  != null ? opts.tintAmount  : 0.1;
    var grayscale   = opts.grayscale   != null ? opts.grayscale   : false;
    var clickStrength = opts.clickStrength != null ? opts.clickStrength : 2;
    var trigger     = opts.trigger || 'hover';
    var quality     = opts.quality || 'medium';
    var alpha       = opts.alpha != null ? opts.alpha : 1;
    var seed        = opts.seed != null ? opts.seed : 1;
    var tintHex     = opts.tint || '#FF2D82';
    var highlightHex = opts.highlightColor || '#ffffff';
    /* 색 블룸 목록. 기본값은 ABOUT OUR SYSTEM 6개 박스의 .sc-iri::before 와 같은 팔레트다. */
    var texBlooms   = opts.textureBlooms || [
      { x:0.20, y:0.30, r:0.32, rgb:'255,154,122',  a:0.50 },
      { x:0.75, y:0.25, r:0.30, rgb:'255,90,150',  a:0.45 },
      { x:0.60, y:0.75, r:0.34, rgb:'120,170,255', a:0.40 },
      { x:0.25, y:0.80, r:0.30, rgb:'255,200,90',  a:0.40 }
    ];

    var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var canvas = document.createElement('canvas');
    canvas.className = 'ripple-distortion-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    var gl = canvas.getContext('webgl', {
      alpha: true, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: true, powerPreference: 'low-power'
    }) || canvas.getContext('experimental-webgl');
    if (!gl) return null;

    var inst = gl.getExtension('ANGLE_instanced_arrays');
    if (!inst) return null;   /* 인스턴싱이 없으면 조용히 포기 — 카드는 그대로 보인다 */

    mount.appendChild(canvas);

    /* 화면을 통째로 덮는 인스턴스(히어로)는 픽셀 수가 카드의 수십 배다.
       maxDpr 로 표시 해상도 상한을 따로 걸 수 있게 했다 — 유리막은 원래
       뿌연 연출이라 해상도를 낮춰도 눈에 띄지 않는다. */
    var dpr = Math.min(global.devicePixelRatio || 1, opts.maxDpr != null ? opts.maxDpr : 2);

    /* ---- 프로그램 ---- */
    var waveP = link(gl, WAVE_VS, WAVE_FS);
    var compP = link(gl, SCREEN_VS, COMPOSITE_FS);
    if (!waveP || !compP) return null;

    var waveU = uniforms(gl, waveP, ['uRings']);
    var compU = uniforms(gl, compP, [
      'uTexture', 'uDisplacement', 'uResolution', 'uTextureSize', 'uTexel',
      'uTint', 'uHighlight', 'uStrength', 'uSwirl', 'uDispersion', 'uGlint',
      'uTintAmount', 'uGrayscale', 'uAlpha'
    ]);

    var waveA = {
      position: gl.getAttribLocation(waveP, 'position'),
      uv:       gl.getAttribLocation(waveP, 'uv'),
      iOffset:  gl.getAttribLocation(waveP, 'iOffset'),
      iScale:   gl.getAttribLocation(waveP, 'iScale'),
      iOpacity: gl.getAttribLocation(waveP, 'iOpacity')
    };
    var compA = {
      position: gl.getAttribLocation(compP, 'position'),
      uv:       gl.getAttribLocation(compP, 'uv')
    };

    /* ---- 지오메트리 ---- */
    function buf(data, usage) {
      var b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
      return b;
    }

    var quadPos = buf(new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]));
    var quadUv  = buf(new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]));
    /* ogl Triangle : 화면을 덮는 큰 삼각형 하나 */
    var triPos = buf(new Float32Array([-1, -1, 3, -1, -1, 3]));
    var triUv  = buf(new Float32Array([0, 0, 2, 0, 0, 2]));

    var offsets   = new Float32Array(MAX_WAVES * 2);
    var scales    = new Float32Array(MAX_WAVES * 2);
    var opacities = new Float32Array(MAX_WAVES);
    var offBuf = buf(offsets, gl.DYNAMIC_DRAW);
    var sclBuf = buf(scales, gl.DYNAMIC_DRAW);
    var opaBuf = buf(opacities, gl.DYNAMIC_DRAW);

    var waves = [];
    for (var w = 0; w < MAX_WAVES; w++) {
      waves.push({ x: 0, y: 0, scale: START_SCALE, target: START_SCALE, size: 1, opacity: 0 });
    }
    var current = 0;

    /* ---- 소스 텍스처 ---- */
    var srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
      opts.image || glassTexture(seed, texBlooms));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    var texW = (opts.image && opts.image.width) || 512;
    var texH = (opts.image && opts.image.height) || 512;

    /* ---- 변위장 렌더 타깃 (ogl RenderTarget 대체) ---- */
    var fieldTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fbo = gl.createFramebuffer();
    var fieldW = 2, fieldH = 2;

    function setFieldSize(fw, fh) {
      fieldW = fw; fieldH = fh;
      gl.bindTexture(gl.TEXTURE_2D, fieldTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    var width = 1, height = 1;

    function resize() {
      width  = Math.max(1, mount.clientWidth);
      height = Math.max(1, mount.clientHeight);
      canvas.width  = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      var scale = QUALITY_SCALE[quality] || QUALITY_SCALE.high;
      setFieldSize(Math.max(2, Math.round(width * scale)), Math.max(2, Math.round(height * scale)));
    }

    /* remeasure 는 함수 선언이라 호이스팅된다 — 아래에서 정의해도 여기서 부를 수 있다 */
    var ro = new ResizeObserver(function () { resize(); remeasure(); });
    ro.observe(mount);
    resize();

    /* ---- 파동 생성 ---- */
    function setNewWave(x, y, power) {
      var wv = waves[current];
      current = (current + 1) % MAX_WAVES;
      wv.x = x; wv.y = y;
      wv.scale  = START_SCALE * power;
      wv.target = START_SCALE * Math.max(1, spread) * power;
      wv.size   = Math.max(1, brushSize);
      wv.opacity = 1;
      wake();
    }

    /* [끊김] 예전엔 pointermove 마다 mount.getBoundingClientRect() 를 읽었다.
       리스너가 window 에 붙어 있고 인스턴스가 여러 개라, 마우스를 한 번 움직일 때마다
       인스턴스 수만큼 강제 동기 레이아웃이 걸렸다(같은 이벤트에서 커스텀 커서가
       transform 을 바꿔 스타일을 더럽히므로 매번 실제로 다시 계산된다).

       [수정] 그렇다고 리사이즈·스크롤 때만 다시 재면 안 된다 —
       갤러리(HALL OF FAME)는 마운트 하나를 타일 사이로 옮겨 붙이는 구조라
       (app.js onHofTileHover → inner.appendChild(hofRippleMount)),
       캐시가 옛 타일 위치를 가리킨 채 굳어 호버가 통째로 죽었다.
       → '프레임당 한 번' 으로 바꾼다. pointermove 가 한 프레임에 여러 번 와도
       레이아웃은 한 번만 계산되고, 마운트가 옮겨 다녀도 다음 프레임에 바로 따라간다. */
    var mRect = null, rectFresh = false;
    function remeasure() {
      mRect = mount.getBoundingClientRect();
      rectFresh = true;
      requestAnimationFrame(function () { rectFresh = false; });
    }
    global.addEventListener('resize', remeasure, { passive: true });
    global.addEventListener('scroll', remeasure, { passive: true, capture: true });

    function localPoint(cx, cy) {
      if (!rectFresh) remeasure();
      var r = mRect;
      if (r.width === 0 || r.height === 0) return null;
      if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
      return [cx - r.left, r.height - (cy - r.top)];   /* GL 원점은 좌하단 */
    }

    var prevX = 0, prevY = 0, enabled = opts.enabled !== false;

    function onMove(e) {
      if (!enabled || reduce || trigger === 'click') return;
      var pt = localPoint(e.clientX, e.clientY);
      if (!pt) return;
      var step = Math.max(1, spacing);
      if (Math.abs(pt[0] - prevX) > step || Math.abs(pt[1] - prevY) > step) {
        setNewWave(pt[0], pt[1], 1);
        prevX = pt[0]; prevY = pt[1];
      }
    }
    function onDown(e) {
      if (!enabled || reduce || trigger === 'hover') return;
      var pt = localPoint(e.clientX, e.clientY);
      if (!pt) return;
      setNewWave(pt[0], pt[1], Math.max(1, clickStrength));
    }

    global.addEventListener('pointermove', onMove, { passive: true });
    global.addEventListener('pointerdown', onDown, { passive: true });

    /* ---- 렌더 ---- */
    function bindAttr(loc, b, size, divisor) {
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      inst.vertexAttribDivisorANGLE(loc, divisor || 0);
    }

    function drawWaves() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, fieldW, fieldH);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(waveP);
      gl.uniform1f(waveU.uRings, rings);

      gl.bindBuffer(gl.ARRAY_BUFFER, offBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, offsets);
      gl.bindBuffer(gl.ARRAY_BUFFER, sclBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, scales);
      gl.bindBuffer(gl.ARRAY_BUFFER, opaBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, opacities);

      bindAttr(waveA.position, quadPos, 2, 0);
      bindAttr(waveA.uv,       quadUv,  2, 0);
      bindAttr(waveA.iOffset,  offBuf,  2, 1);
      bindAttr(waveA.iScale,   sclBuf,  2, 1);
      bindAttr(waveA.iOpacity, opaBuf,  1, 1);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);   /* 원본 setBlendFunc(ONE, ONE) — 파동은 누적된다 */
      inst.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, MAX_WAVES);
    }

    function drawComposite() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(compP);
      bindAttr(compA.position, triPos, 2, 0);
      bindAttr(compA.uv,       triUv,  2, 0);
      /* 인스턴스 어트리뷰트 divisor 는 프로그램이 아니라 어트리뷰트 슬롯에 남는다.
         wave 패스에서 1 로 둔 슬롯이 composite 의 position/uv 와 겹칠 수 있어 되돌린다. */
      if (compA.position >= 0) inst.vertexAttribDivisorANGLE(compA.position, 0);
      if (compA.uv >= 0) inst.vertexAttribDivisorANGLE(compA.uv, 0);

      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform1i(compU.uTexture, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fieldTex);
      gl.uniform1i(compU.uDisplacement, 1);

      gl.uniform2f(compU.uResolution, width, height);
      gl.uniform2f(compU.uTextureSize, texW, texH);
      gl.uniform2f(compU.uTexel, 1 / fieldW, 1 / fieldH);
      gl.uniform3fv(compU.uTint, hexToRGB(tintHex));
      gl.uniform3fv(compU.uHighlight, hexToRGB(highlightHex));
      gl.uniform1f(compU.uStrength, strength);
      gl.uniform1f(compU.uSwirl, swirl);
      gl.uniform1f(compU.uDispersion, dispersion);
      gl.uniform1f(compU.uGlint, glint);
      gl.uniform1f(compU.uTintAmount, tintAmount);
      gl.uniform1f(compU.uGrayscale, grayscale ? 1 : 0);
      gl.uniform1f(compU.uAlpha, alpha);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   /* 프리멀티플라이드 출력 */
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    var raf = 0, prevTime = 0, idleFrames = 0;

    function loop(now) {
      var delta = prevTime ? Math.min(0.05, (now - prevTime) / 1000) : 0;
      prevTime = now;

      var growth = reduce ? 0 : 1 - Math.exp(-delta * 1.09);
      var decay  = reduce ? 1 : Math.exp((-delta * LIFE_CONSTANT) / Math.max(0.15, fade));

      var alive = 0;
      for (var i = 0; i < MAX_WAVES; i++) {
        var wv = waves[i];
        if (wv.opacity <= 0) { opacities[i] = 0; continue; }

        wv.opacity *= decay;
        wv.scale += (wv.target - wv.scale) * growth;

        if (wv.opacity < 0.002) { wv.opacity = 0; opacities[i] = 0; continue; }

        var half = (wv.scale * wv.size) / 2;
        offsets[i * 2]     = (wv.x / width) * 2 - 1;
        offsets[i * 2 + 1] = (wv.y / height) * 2 - 1;
        scales[i * 2]      = (half / width) * 2;
        scales[i * 2 + 1]  = (half / height) * 2;
        opacities[i] = wv.opacity;
        alive++;
      }

      drawWaves();
      drawComposite();

      /* 파동이 모두 죽으면 rAF 를 놓는다 — 카드 3장이 상시 도는 걸 막는다.
         마지막 한 프레임은 더 그려서 잔상이 남지 않게 한다. */
      if (alive === 0) {
        if (++idleFrames > 1) { raf = 0; return; }
      } else idleFrames = 0;

      raf = requestAnimationFrame(loop);
    }

    function wake() {
      if (raf) return;
      idleFrames = 0;
      prevTime = 0;
      raf = requestAnimationFrame(loop);
    }

    /* 첫 프레임 — 파동 없이 텍스처만 깔아 둔다 */
    drawWaves();
    drawComposite();

    function uploadImage(src) {
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      texW = src.naturalWidth || src.width || texW;
      texH = src.naturalHeight || src.height || texH;
    }

    return {
      canvas: canvas,
      /* 텍스처 교체 — 호버한 타일의 사진을 그때그때 올려 쓴다.
         같은 출처(assets/ 또는 dataURL)라서 캔버스가 오염되지 않는다. */
      setImage: function (src) {
        if (!src) return;
        try { uploadImage(src); } catch (e) { return; }
        resize();
        drawWaves(); drawComposite();
        wake();
      },
      /* 마운트를 다른 요소로 옮긴 직후엔 크기가 달라져 있다 */
      remount: function () { resize(); drawWaves(); drawComposite(); wake(); },
      /* 컬러 블룸을 갈아끼운다 — 텍스처를 다시 구워 올린다.
         호버할 때마다 그라디언트 배치를 새로 뽑고 싶을 때 쓴다(11-planet-detail 의 cap 카드).
         opts.image 로 사진을 쓰는 인스턴스에서는 의미가 없으므로 무시한다. */
      setBlooms: function (blooms, newSeed) {
        if (opts.image || !blooms || !blooms.length) return;
        texBlooms = blooms;
        if (newSeed != null) seed = newSeed;
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
          glassTexture(seed, texBlooms));
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        drawWaves(); drawComposite(); wake();
      },
      clearWaves: function () {
        for (var i = 0; i < MAX_WAVES; i++) { waves[i].opacity = 0; opacities[i] = 0; }
        prevX = 0; prevY = 0;
        drawWaves(); drawComposite();
      },
      set: function (k, v) {
        if (k === 'strength') strength = v;
        else if (k === 'glint') glint = v;
        else if (k === 'enabled') enabled = !!v;
        else if (k === 'alpha') alpha = v;
        wake();
      },
      destroy: function () {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        ro.disconnect();
        global.removeEventListener('pointermove', onMove);
        global.removeEventListener('pointerdown', onDown);
        global.removeEventListener('resize', remeasure);
        global.removeEventListener('scroll', remeasure, true);
        if (canvas.parentNode === mount) mount.removeChild(canvas);
        var ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
      }
    };
  }

  global.ArgoRipple = { create: create };
})(window);
