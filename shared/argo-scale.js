/* ============ 화면 배율 =====================================================
   이 사이트의 치수는 노트북 화면(가로 1710 CSS px) 기준으로 잡혀 있다.
   그보다 큰 모니터에서는 화면이 넓어진 만큼 --z 를 올려 전체를 통째로 키운다.
   작은 화면은 건드리지 않는다(기존 max-width 미디어쿼리가 담당).

   조절은 아래 상수 셋이 전부다.
     DESIGN_W / DESIGN_H  기준 화면 크기. 이 크기에서 배율은 정확히 1 이 된다.
     Z_MAX                안전 상한. 너무 키우면 한 화면에 안 들어간다.
     SOFT                 큰 글씨와 버튼이 배율을 따라가는 정도.
                          0 이면 원래 크기 그대로, 1 이면 나머지와 똑같이 커진다.
                          이것들은 배율을 그대로 먹이면 과하게 커져서 따로 둔다.
   현장에서 임시로 다르게 보고 싶으면 주소 끝에 ?scale=1.3 을 붙인다.

   실제 확대는 styles.css / pd-skin.css 의 html{zoom:var(--z,1)} 이 한다.
   zoom 은 vh·vw·dvh 를 보정하지 않으므로 두 파일의 뷰포트 단위는 전부
   calc(N * var(--vh)) 꼴로 바뀌어 있고 거기서 배율만큼 나눈다. */
(function(){
  var DESIGN_W = 1710;
  var DESIGN_H = 960;
  var Z_MAX    = 1.6;
  var SOFT     = 0.35;

  var forced = parseFloat(new URLSearchParams(location.search).get('scale'));

  function apply(){
    var z = forced > 0 ? forced
          : Math.min(Z_MAX, Math.max(1, Math.min(innerWidth / DESIGN_W,
                                                 innerHeight / DESIGN_H)));
    z = Math.round(z * 1000) / 1000;
    if (z === window.__argoZ) return;
    window.__argoZ = z;
    document.documentElement.style.setProperty('--z', z);
    /* 큰 글씨·버튼용 완만한 배율. styles.css 에서 zoom 을 부분만 되돌리는 데 쓴다. */
    document.documentElement.style.setProperty('--z-soft',
      Math.round((1 + (z - 1) * SOFT) * 1000) / 1000);
    /* 전면 캔버스는 JS 가 innerWidth 로 크기를 잡는다(확대되면 화면을 넘친다).
       resize 를 한 번 흘려 보내 각자 다시 재도록 한다. */
    dispatchEvent(new Event('resize'));
  }

  apply();
  addEventListener('resize', apply);
  window.ArgoScale = { apply:apply, get z(){ return window.__argoZ; } };
})();
