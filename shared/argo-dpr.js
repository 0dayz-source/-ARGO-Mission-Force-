/* 저사양판(lite/) 전용 — 캔버스 해상도를 1배로 묶는다. 다른 스크립트보다 먼저 읽혀야 한다.
   5K 아이맥은 devicePixelRatio 2 라서 전면 캔버스 하나가 5120×2880(1,470만 픽셀)이 된다.
   모든 캔버스·셰이더가 devicePixelRatio 를 읽어 크기를 정하므로, 여기서 한 번만 줄인다.
   현장 조정: 주소 뒤에 ?dpr=1.5 (더 선명하게) / ?dpr=0.75 (더 가볍게) */
(function () {
  var cap = +new URLSearchParams(location.search).get('dpr') || 1;
  var real = window.devicePixelRatio || 1;
  window.__realDPR = real;   /* QR 처럼 작고 선명해야 하는 캔버스는 실제 값을 쓴다(shared/argo-qr.js) */
  try {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      get: function () { return Math.min(real, cap); }
    });
  } catch (e) {}
})();
