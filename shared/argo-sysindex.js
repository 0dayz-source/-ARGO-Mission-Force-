/* =====================================================================
   SYSTEM INDEX (s11) — 목록 · 필터 · 토러스 연동 · 진입
   ---------------------------------------------------------------------
   여기 실린 항목은 전부 이 저장소에 실제로 있는 화면이다. 없는 페이지나
   기능은 만들지 않는다 — 진입 경로(go)가 곧 그 증거다.

   진입은 기존 전환 로직을 그대로 쓴다:
     goScene(n)   index.html 안의 씬
     argoGoto(u)  다른 HTML 문서 (로더 전환 포함)
     openOriginOverlay()  기존 모달
   ===================================================================== */
(function () {
  'use strict';

  /* ---- 카탈로그 --------------------------------------------------------
     code  : 아카이브 코드(썸네일 대체면에도 쓴다)
     cat   : 필터 분류
     thumb : assets/index-thumbs/*.jpg — 실제 화면을 캡처한 것
     go    : 진입 함수. null 이면 진입 버튼을 숨긴다. */
  var ITEMS = [
    {
      code:'ARG-00', cat:'MISSION', thumb:'s0',
      name:'MISSION FORCE ARGO', ko:'메인 · 랜딩',
      keys:['LANDING','NEBULA','TELEMETRY'],
      desc:'ARGO 계획의 첫 화면입니다. 52,000개의 별 입자로 만든 성운이 배경에서 계속 흐르고, ' +
           '측면 패널에는 화성 기지의 실시간 텔레메트리가 갱신됩니다. 여기서 모든 경로가 갈라집니다.',
      feat:['WebGL 성운 파티클 — 커서를 따라 흩어지고 다시 모입니다',
            '라이브 텔레메트리 · 자기장 격자 · 지원자 카운터',
            'EXPLORE MARS / START ASSESSMENT 두 갈래 진입'],
      route:[['TYPE','SCENE'],['ID','s0']],
      go:function(){ goScene(0); }
    },
    {
      code:'ARG-01', cat:'MISSION', thumb:'mars',
      name:'PLANETARY BRIEF', ko:'화성 · 스크롤 브리핑',
      keys:['SCROLL STORY','WEBCAM','GENOME'],
      desc:'화성으로 내려가는 긴 스크롤 문서입니다. 성운을 헤치며 행성에 가까워지고, ' +
           '지원자 생체 등록(웹캠 촬영)과 게놈 캡슐을 지나 심리 평가 앞에 도착합니다.',
      feat:['커서로 성운을 흩뜨리는 히어로 — 스크롤할수록 화성에 가까워집니다',
            'IDENTITY CAPTURE — 손으로 사각 프레임을 만들면 촬영됩니다',
            'CREED 타이포그래피 · 워드 휠 · 게놈 캡슐 픽셀 전환'],
      route:[['TYPE','DOCUMENT'],['FILE','11-planet-detail.html']],
      go:function(){ if (window.argoGoto) argoGoto('11-planet-detail.html'); else location.href='11-planet-detail.html'; }
    },
    {
      code:'ARG-02', cat:'MISSION', thumb:'s1',
      name:'CORE ARCHITECTURE', ko:'시스템 · 여섯 개의 축',
      keys:['SIX SYSTEMS','GRID'],
      desc:'평가가 딛고 선 여섯 개의 축을 한 화면에 펼칩니다. 각 카드가 하나의 심리 지표이고, ' +
           '카드를 열면 그 지표의 정의와 판정 기준을 볼 수 있습니다.',
      feat:['여섯 시스템 카드 그리드 — 카드마다 개별 상세 화면으로 연결',
            '카드 표면의 유리 굴절 · 이리데선스 레이어'],
      route:[['TYPE','SCENE'],['ID','s1']],
      go:function(){ goScene(1); }
    },
    {
      code:'ARG-03', cat:'MISSION', thumb:'origin',
      name:'ORIGIN LOG', ko:'선발 위원회 · 출신 기록',
      keys:['COMMITTEE','ORIGIN'],
      desc:'테라포밍 선발 위원회를 소개하는 오버레이입니다. 전 세계 847,392명의 지원자가 ' +
           '어디에서 왔는지 기록을 훑어볼 수 있습니다.',
      feat:['위원회 브랜드 카드 · 지원자 출신 로그','메인 화면의 격자 아이콘에서도 열립니다'],
      route:[['TYPE','OVERLAY'],['ID','origin-overlay']],
      go:function(){ if (window.openOriginOverlay) openOriginOverlay(); }
    },

    {
      code:'PSY-00', cat:'ASSESSMENT', thumb:'s3',
      name:'PSYCH ASSESSMENT', ko:'심리 소양 평가서',
      keys:['8 ITEMS','ORBIT WHEEL','STAMP'],
      desc:'평가의 본체입니다. 왼쪽에서 문항 번호가 궤도를 따라 돌고, 오른쪽에서 선택지를 고릅니다. ' +
           '고른 선택지에는 기록 낙인이 찍히고, 응답은 즉시 후보자 기록에 반영됩니다. 중도 저장은 없습니다.',
      feat:['회전하는 문항 궤도 휠 — 진행에 따라 함께 돕니다',
            '포커스 카드 선택지 — 선택하면 기록 낙인이 찍힙니다',
            '여섯 축 적합도를 실시간으로 누적'],
      route:[['TYPE','SCENE'],['ID','s3'],['PHASE','02 / 03']],
      go:function(){ goScene(3); }
    },
    {
      code:'PSY-01', cat:'ASSESSMENT', thumb:'result',
      name:'POSITION ASSIGNMENT', ko:'결과 · 직군 배정',
      keys:['PROFILE','6 AXES'],
      desc:'평가를 마치면 여섯 축의 심리 지표가 직업군 적합도 프로파일로 환산되어 배정 직군이 정해집니다. ' +
           '평가 흐름의 마지막 단계라 단독으로는 열리지 않습니다.',
      feat:['직업군 적합도 프로파일 · 심리 지표 미터','재응시 또는 다음 단계로 이어짐'],
      route:[['TYPE','OVERLAY'],['ID','result-overlay'],['ACCESS','평가 완료 후']],
      enterLabel:'START ASSESSMENT',
      go:function(){ goScene(3); }
    },
    { code:'SYS-01', cat:'ASSESSMENT', thumb:'s4', name:'ISOLATION ENDURANCE', ko:'고립 내성',
      keys:['PSYCH','ISO'], desc:'연결이 끊긴 상태를 얼마나 오래 견디는지 봅니다. 화성 표면에서 통신 지연은 기본값이고, 고립은 사고가 아니라 조건입니다.',
      feat:['지표 정의와 판정 기준','평가 문항과의 대응 관계'], route:[['TYPE','SCENE'],['ID','s4']], go:function(){ goScene(4); } },
    { code:'SYS-02', cat:'ASSESSMENT', thumb:'s5', name:'NEUROTICISM FLOOR', ko:'정서 안정 하한',
      keys:['PSYCH','NEU'], desc:'압박 아래에서 정서가 어디까지 내려앉는지, 그 바닥을 봅니다. 최고치가 아니라 최저치가 생존을 가릅니다.',
      feat:['지표 정의와 판정 기준','평가 문항과의 대응 관계'], route:[['TYPE','SCENE'],['ID','s5']], go:function(){ goScene(5); } },
    { code:'SYS-03', cat:'ASSESSMENT', thumb:'s6', name:'AUTONOMOUS DECISION THRESHOLD', ko:'자율 판단 문턱',
      keys:['PSYCH','AUT'], desc:'지시를 기다릴 수 없을 때 스스로 결정을 내리는 지점을 봅니다. 지구까지 왕복 신호에는 시간이 걸립니다.',
      feat:['지표 정의와 판정 기준','평가 문항과의 대응 관계'], route:[['TYPE','SCENE'],['ID','s6']], go:function(){ goScene(6); } },
    { code:'SYS-04', cat:'ASSESSMENT', thumb:'s7', name:'COLLECTIVE PRIORITY INDEX', ko:'집단 우선 지수',
      keys:['PSYCH','COL'], desc:'개인과 정착지가 부딪칠 때 어느 쪽을 먼저 두는지 봅니다. 소수 인원의 기지에서 이 선택은 곧 구조가 됩니다.',
      feat:['지표 정의와 판정 기준','평가 문항과의 대응 관계'], route:[['TYPE','SCENE'],['ID','s7']], go:function(){ goScene(7); } },
    { code:'SYS-05', cat:'ASSESSMENT', thumb:'s8', name:'IDENTITY DISPLACEMENT TOLERANCE', ko:'정체성 전위 내성',
      keys:['PSYCH','IDN'], desc:'지구에서의 자기 자신을 놓아야 할 때 얼마나 버틸 수 있는지 봅니다. 도착한 사람은 떠난 사람과 같지 않습니다.',
      feat:['지표 정의와 판정 기준','평가 문항과의 대응 관계'], route:[['TYPE','SCENE'],['ID','s8']], go:function(){ goScene(8); } },
    { code:'SYS-06', cat:'ASSESSMENT', thumb:'s9', name:'GENERATIVE COMMITMENT', ko:'생성적 헌신',
      keys:['PSYCH','GEN'], desc:'자기 대에 완성되지 않을 일에 얼마나 오래 매달릴 수 있는지 봅니다. 테라포밍은 한 세대의 일이 아닙니다.',
      feat:['지표 정의와 판정 기준','평가 문항과의 대응 관계'], route:[['TYPE','SCENE'],['ID','s9']], go:function(){ goScene(9); } },

    {
      code:'ARC-00', cat:'ARCHIVE', thumb:'wall',
      name:'CANDIDATE WALL', ko:'후보자 사진 갤러리',
      keys:['DRIFT WALL','CAPTURES'],
      desc:'생체 등록에서 찍힌 컷이 모이는 벽입니다. 먼저 도착한 지원자들의 얼굴이 표류하듯 흘러가고, ' +
           '한 장을 고르면 크게 열립니다. 메인에서 아래로 스크롤해도 같은 벽에 닿습니다.',
      feat:['DriftWall — 관성으로 흐르는 사진 격자','촬영 컷 확대 보기 · 대표 컷 지정',
            '메인 상단 「후보자 사진」 버튼 · 메인 스크롤 두 경로'],
      route:[['TYPE','DOCUMENT'],['FILE','photo-wall.html']],
      go:function(){ if (window.goWebcam) goWebcam(); else if (window.argoGoto) argoGoto('photo-wall.html'); else location.href='photo-wall.html'; }
    },
    {
      code:'ARC-01', cat:'ARCHIVE', thumb:'s2',
      name:'GUEST LOG', ko:'방명록',
      keys:['WRITE','MISSION CONTROL'],
      desc:'미션 컨트롤 콘솔 형태의 방명록입니다. 남긴 글은 다른 방문자에게도 보입니다.',
      feat:['터미널형 입력 콘솔','남긴 기록이 목록에 쌓입니다'],
      route:[['TYPE','SCENE'],['ID','s2']],
      go:function(){ goScene(2); }
    }
  ];

  var CATS = ['ALL', 'MISSION', 'ASSESSMENT', 'ARCHIVE'];

  var scene, listEl, filtersEl, canvas, torus = null;
  var detailEl, defaultEl;
  var selected = -1, curFilter = 'ALL';
  var itemEls = [];

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  }); }

  /* ---- 목록 만들기 ---------------------------------------------------- */
  function buildList() {
    ITEMS.forEach(function (it, i) {
      var b = el('button', 'si-item');
      b.type = 'button';
      b.dataset.cat = it.cat;
      b.dataset.idx = i;
      /* lazy 를 걸지 않는다 — 15장 합쳐 73KB 뿐이고, 씬이 숨어 있는 동안
         지연됐다가 진입 직후 빈 칸으로 보이는 편이 더 나쁘다.
         파일이 없으면 onerror 로 지워지고 CSS 의 코드 슬레이트가 드러난다. */
      /* 썸네일 구조는 Aceternity "Moving Border" 를 따른다 —
         바깥 틀에 1px 패딩을 주고, 그 틈으로만 빛나는 점이 비치게 해서
         테두리를 따라 빛이 도는 것처럼 보이게 한다.
           .si-thumb    바깥 틀(패딩 1px)
           .si-mb       빛 레이어(svg 경로 + 점) — 안쪽 판에 가려 테두리만 보인다
           .si-thumb-in 안쪽 판(이미지) */
      b.innerHTML =
        '<span class="si-code">' + esc(it.code) + '</span>' +
        '<span class="si-thumb" data-code="' + esc(it.code) + '">' +
          '<span class="si-mb" aria-hidden="true">' +
            '<svg preserveAspectRatio="none" width="100%" height="100%">' +
              '<rect fill="none" width="100%" height="100%" rx="12%" ry="19%"></rect>' +
            '</svg>' +
            '<i class="si-mb-dot"></i>' +
          '</span>' +
          '<span class="si-thumb-in">' +
            '<img src="assets/index-thumbs/' + esc(it.thumb) + '.jpg" alt="" ' +
                 'onerror="this.remove()">' +
          '</span>' +
        '</span>' +
        '<span class="si-cap">' +
          '<span class="si-name">' + esc(it.name) + '</span>' +
          '<span class="si-keys">' + esc(it.keys.join(' · ')) + '</span>' +
        '</span>';

      b.addEventListener('click', function () { select(i); });
      b.addEventListener('mouseenter', function () {
        highlight(i, true);
        startMovingBorder(b);
        if (torus) torus.pulse(i, ITEMS.length);
      });
      b.addEventListener('mouseleave', function () {
        highlight(i, false);
        stopMovingBorder(b);
        if (torus) torus.clearPulse();
      });
      listEl.appendChild(b);
      itemEls.push(b);
    });
  }

  /* ---- Moving Border ---------------------------------------------------
     ref. Aceternity UI "Moving Border" (components/ui/moving-border.tsx)
     원본은 framer-motion 의 useAnimationFrame + getPointAtLength 로 SVG rect
     둘레를 따라 점을 옮긴다. 여기서는 같은 계산을 rAF 로 직접 돌린다 —
     이 프로젝트는 바닐라라 motion/react 를 붙이지 않는다.
     호버 중인 항목 하나만 돌린다(목록 14개를 전부 돌릴 이유가 없다). */
  var MB_DURATION = 3000;   /* 원본 기본값 */
  var mbRaf = 0, mbHost = null;

  function startMovingBorder(item) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var rect = item.querySelector('.si-mb rect');
    var dot  = item.querySelector('.si-mb-dot');
    if (!rect || !dot) return;
    stopMovingBorder();
    mbHost = item;
    var len = 0;
    try { len = rect.getTotalLength(); } catch (e) {}
    if (!len) return;
    var per = len / MB_DURATION;      /* px per ms — 원본과 같은 식 */
    function step(t) {
      if (mbHost !== item) { mbRaf = 0; return; }
      var pt;
      try { pt = rect.getPointAtLength((t * per) % len); } catch (e) { mbRaf = 0; return; }
      dot.style.transform = 'translate(' + pt.x + 'px,' + pt.y + 'px) translate(-50%,-50%)';
      mbRaf = requestAnimationFrame(step);
    }
    mbRaf = requestAnimationFrame(step);
  }
  function stopMovingBorder(item) {
    if (item && mbHost !== item) return;
    if (mbRaf) { cancelAnimationFrame(mbRaf); mbRaf = 0; }
    mbHost = null;
  }

  /* ---- 필터 ----------------------------------------------------------- */
  function buildFilters() {
    CATS.forEach(function (c) {
      /* 방명록·메인과 같은 버튼 언어로 통일 — 유리 채움(.lg-btn ::before) +
         광원 테두리(.lg-spec) + 호버 시 글자 스크램블(.lg-label). */
      var b = el('button', 'si-filter lg-btn' + (c === 'ALL' ? ' on' : ''),
        '<span class="lg-iri"></span><span class="lg-spec"></span><span class="lg-label">' + esc(c) + '</span>');
      b.type = 'button';
      b.addEventListener('click', function () {
        curFilter = c;
        [].forEach.call(filtersEl.children, function (x) { x.classList.toggle('on', x === b); });
        applyFilter();
      });
      filtersEl.appendChild(b);
    });
    if (window.ArgoScramble) ArgoScramble.bindButtons(filtersEl);
  }
  function applyFilter() {
    var n = 0;
    itemEls.forEach(function (b, i) {
      var show = curFilter === 'ALL' || b.dataset.cat === curFilter;
      b.classList.toggle('hide', !show);
      if (show) n++;
    });
    var cnt = document.getElementById('si-count');
    if (cnt) cnt.textContent = String(n).padStart(2, '0') + ' / ' + String(ITEMS.length).padStart(2, '0') + ' MODULES';
  }

  /* 목록 호버 강조 */
  function highlight(i, on) {
    if (itemEls[i] && i !== selected) itemEls[i].style.background = on ? 'rgba(255,255,255,.045)' : '';
  }

  /* 기본 소개(ARGO·TFSC)로 되돌린다 */
  function clearSelection() {
    selected = -1;
    itemEls.forEach(function (b) { b.classList.remove('sel'); b.style.background = ''; });
    detailEl.hidden = true;
    defaultEl.hidden = false;
    document.getElementById('si-panel').scrollTop = 0;
    if (torus) torus.clearPulse();
  }

  /* ---- 선택 -----------------------------------------------------------
     같은 항목을 다시 누르면 선택이 풀리고 기본 소개로 돌아온다 —
     한 번 고르면 ARGO 기본 정보로 돌아올 길이 없다는 지적이 있었다(토글). */
  function select(i) {
    if (i === selected) { clearSelection(); return; }
    selected = i;
    itemEls.forEach(function (b, k) { b.classList.toggle('sel', k === i); b.style.background = ''; });

    var it = ITEMS[i];
    defaultEl.hidden = true;
    detailEl.hidden = false;

    document.getElementById('si-d-code').textContent = it.code + ' · ' + it.cat;
    document.getElementById('si-d-name').textContent = it.name;
    document.getElementById('si-d-ko').textContent = it.ko;
    document.getElementById('si-d-desc').textContent = it.desc;

    var ul = document.getElementById('si-d-feat');
    ul.innerHTML = '';
    it.feat.forEach(function (f) { ul.appendChild(el('li', null, esc(f))); });

    var rows = document.getElementById('si-d-rows');
    rows.innerHTML = '';
    it.route.forEach(function (r) {
      var row = el('div', 'si-row');
      row.appendChild(el('dt', null, esc(r[0])));
      row.appendChild(el('dd', null, esc(r[1])));
      rows.appendChild(row);
    });

    /* [삭제] OPEN PAGE 버튼 — 목록 항목 자체가 이동을 맡는다 */
    document.getElementById('si-panel').scrollTop = 0;
    if (torus) torus.pulse(i, ITEMS.length);
  }

  /* ---- 토러스 연결 ---------------------------------------------------- */
  function bindTorus() {
    if (torus || !window.ArgoTorus || !canvas) return;
    torus = window.ArgoTorus.create(canvas);
    if (!torus) return;

    /* 캔버스가 씬 전체를 덮으므로 포인터도 씬 전체에서 받는다.
       (칼럼이 사라져서 '가운데 영역' 이라는 게 더는 없다) */
    var host = canvas.parentElement;

    /* [끊김 — 진짜 원인] 예전엔 pointermove 마다 host.getBoundingClientRect() 를 읽었다.
       host 는 씬 전체(모듈 14개 목록 + 본문 + 필터)다. 게다가 같은 pointermove 에서
       커스텀 커서(.pd-cursor)가 transform 을 바꿔 스타일을 더럽히므로,
       이 rect 읽기가 매 이벤트마다 '강제 동기 레이아웃' 을 일으킨다 —
       마우스를 움직일 때만 끊기고, 다른 파티클은 멀쩡했던 이유가 이것이다.
       rect 는 리사이즈·스크롤·씬 전환 때만 바뀐다. 캐시하고 그때만 다시 잰다. */
    var hostRect = null;
    function measureHost() { hostRect = host.getBoundingClientRect(); }
    measureHost();
    addEventListener('resize', measureHost, { passive: true });
    addEventListener('scroll', measureHost, { passive: true });
    torus._remeasure = measureHost;   /* 씬이 켜질 때 watchScene 이 부른다 */

    host.addEventListener('pointermove', function (e) {
      var r = hostRect;
      if (!r || !r.width || !r.height) { measureHost(); r = hostRect; if (!r || !r.width) return; }
      torus.pointer(((e.clientX - r.left) / r.width) * 2 - 1,
                    -(((e.clientY - r.top) / r.height) * 2 - 1));
    }, { passive: true });
    host.addEventListener('pointerleave', function () { torus.pointerOut(); });
    /* 목록/버튼 클릭까지 파동이 튀지 않게, 컨트롤 위가 아닐 때만 */
    host.addEventListener('click', function (e) {
      if (e.target.closest('.si-item, .si-filter, .si-back')) return;
      torus.wave();
    });
  }

  /* ---- 씬 진입/이탈에 맞춰 렌더 시작·정지 -----------------------------
     s11 이 화면에 없을 때 GPU 를 계속 먹지 않게 .active 를 감시한다. */
  function watchScene() {
    /* [버그] 예전엔 클래스가 바뀔 때마다 torus.resize() 를 불렀다.
       goScene 은 한 번의 전환에서 클래스를 여러 번 건드린다
       (enter-z2 추가 → was-z2 추가 → active 추가 → 1750ms·2650ms 에 제거).
       그때마다 18만 개짜리 렌더러가 setSize/setPixelRatio 를 다시 하느라
       프레임이 뚝뚝 끊겼다("멈췄다가 진행됐다가").
       → 활성 여부가 '실제로 바뀐 순간' 에만 반응하고, 크기 조정은 별도로 한다. */
    var wasOn = null;
    function sync() {
      var on = scene.classList.contains('active');
      if (on === wasOn) return;
      wasOn = on;
      if (on) {
        bindTorus();
        if (torus) {
          torus.start();
          /* 씬이 켜진 뒤에야 host 가 실제 크기를 갖는다 — 그때 한 번만 다시 잰다.
             (전환 애니메이션이 끝난 뒤 값이 확정되므로 살짝 늦춰서 한 번 더) */
          if (torus._remeasure) { torus._remeasure(); setTimeout(torus._remeasure, 900); }
        }
      }
      else if (torus) torus.stop();
    }
    new MutationObserver(sync).observe(scene, { attributes: true, attributeFilter: ['class'] });
    sync();
  }

  function init() {
    scene = document.getElementById('s11');
    if (!scene) return;
    listEl = document.getElementById('si-list');
    filtersEl = document.getElementById('si-filters');
    canvas = document.getElementById('si-canvas');
    detailEl = document.getElementById('si-detail');
    defaultEl = document.getElementById('si-default');

    if (!listEl || !filtersEl) return;

    buildFilters();
    buildList();
    applyFilter();



    /* 빈 곳(토러스 위)을 클릭하면 기본 소개로 되돌아간다 */
    scene.addEventListener('click', function (e) {
      if (e.target.closest('.si-item, .si-filter, .si-back, .si-panel')) return;
      clearSelection();
    });

    /* 토러스 사전 생성 — 버튼을 누른 뒤에 만들면 그만큼 파티클이 늦게 뜬다.
       [수정] 예전엔 페이지 로드 직후 유휴 시간에 바로 만들었다. 그런데 그 시점은
       메인 성운(52,000개 + 셰이더 컴파일)이 아직 뜨는 중이라, 토러스의
       WebGL 컨텍스트 생성 + 53,000×3 버퍼 굽기가 그 위에 겹쳐 메인 페이지가
       버벅였다(MARS 에서 돌아올 때 특히). 성운이 첫 프레임을 그린 뒤로 미룬다 —
       화면이 자리를 잡은 다음에야 조용히 굽는다. */
    function prebuild() {
      if (window.requestIdleCallback) requestIdleCallback(bindTorus, { timeout: 4000 });
      else setTimeout(bindTorus, 600);
    }
    if (window.__argoNebulaReady) prebuild();
    else addEventListener('argo:nebula-ready', prebuild, { once: true });
    /* 성운이 없는 문서(프리뷰 등)를 위한 안전망 */
    setTimeout(function () { if (!torus) prebuild(); }, 5000);

    watchScene();
  }

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
