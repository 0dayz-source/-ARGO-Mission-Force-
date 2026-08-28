/* ============================================================================
   ArgoDate — 작중 시점(2068년) 날짜/시각을 한 곳에서 만든다.

   화면에 찍히는 날짜가 곳곳에 '2068-05-29' 처럼 박혀 있었고, 갤러리 캡션만
   실제 연도(2026)를 써서 서로 어긋났다. 여기서 규칙을 하나로 정한다:

     · 연도는 항상 MISSION_YEAR(2068) 로 고정한다 — 작중 시점이다.
       ARGO 연표 : 2041 창설 → 2063 무인 시스템 → 2068 유인 임무. 웹사이트는 유인 임무 시점.
     · 월·일·시각은 한국 시간(KST, UTC+9) 기준으로 실제 오늘 것을 쓴다.
       전시가 며칠에 걸쳐 돌아가도 날짜가 알아서 넘어간다.

   사용:
     ArgoDate.iso()            → '2068-08-08'
     ArgoDate.dot()            → '2068.08.08'
     ArgoDate.stamp(ms)        → '2068.08.08  21:07'   (갤러리 캡션)
     ArgoDate.clock()          → '21:07:33'
     ArgoDate.paint()          → [data-mission-date] 요소를 채운다
   ============================================================================ */
(function (global) {
  'use strict';

  var MISSION_YEAR = 2068;
  var KST_OFFSET_MS = 9 * 60 * 60 * 1000;

  function p2(n) { return (n < 10 ? '0' : '') + n; }

  /* 실제 시각을 KST 로 옮긴 뒤, UTC 게터로 '한국 기준 연·월·일·시' 를 읽는다.
     (브라우저 로컬 타임존이 무엇이든 같은 결과가 나온다 — 전시장 PC 설정에 안 흔들린다) */
  function kstParts(ms) {
    var d = new Date((ms == null ? Date.now() : ms) + KST_OFFSET_MS);
    return {
      m: d.getUTCMonth() + 1, d: d.getUTCDate(),
      H: d.getUTCHours(), M: d.getUTCMinutes(), S: d.getUTCSeconds()
    };
  }

  function iso(ms)   { var k = kstParts(ms); return MISSION_YEAR + '-' + p2(k.m) + '-' + p2(k.d); }
  function dot(ms)   { var k = kstParts(ms); return MISSION_YEAR + '.' + p2(k.m) + '.' + p2(k.d); }
  function clock(ms) { var k = kstParts(ms); return p2(k.H) + ':' + p2(k.M) + ':' + p2(k.S); }
  /* 갤러리 캡션 : '2068.08.08  21:07' */
  function stamp(ms) { var k = kstParts(ms); return dot(ms) + '  ' + p2(k.H) + ':' + p2(k.M); }

  /* <span data-mission-date="iso|dot|clock"> 를 채운다. 자정을 넘겨도 갱신되도록
     1분마다 다시 그린다(clock 은 1초). */
  function paint() {
    document.querySelectorAll('[data-mission-date]').forEach(function (el) {
      var kind = el.getAttribute('data-mission-date') || 'iso';
      el.textContent = kind === 'dot' ? dot() : kind === 'clock' ? clock() : iso();
    });
  }

  function start() {
    paint();
    setInterval(paint, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  global.ArgoDate = {
    MISSION_YEAR: MISSION_YEAR,
    iso: iso, dot: dot, clock: clock, stamp: stamp, paint: paint
  };
})(window);
