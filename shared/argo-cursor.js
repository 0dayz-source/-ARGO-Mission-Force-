/* ARGO 커스텀 커서 — 점 + 따라오는 링 + data-cursor 라벨.
   11-planet-detail.html 의 <script id="pd-fx"> 안에 있던 커서 부분만 떼어냈다.
   pd-fx 는 66KB 짜리 랜딩 전용 FX 뭉치라 통째로 들고 올 수 없어서, 커서만 분리했다.
   스타일은 shared/pd-skin.css 의 .pd-cursor / .pd-cursor-ring / .pd-cursor-label 을 그대로 쓴다.

   필요한 마크업 (없으면 조용히 아무것도 하지 않는다):
     <div class="pd-cursor" aria-hidden="true"></div>
     <div class="pd-cursor-ring" aria-hidden="true"></div>
     <div class="pd-cursor-label" aria-hidden="true"></div> */
(function(){
  'use strict';
  var fine   = matchMedia('(pointer:fine)').matches;
  var reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
  if(!fine || reduce) return;                 /* 터치기기·모션 최소화에서는 네이티브 커서 유지 */

  var dot   = document.querySelector('.pd-cursor');
  var ring  = document.querySelector('.pd-cursor-ring');
  var label = document.querySelector('.pd-cursor-label');
  if(!dot || !ring || !label) return;

  document.body.classList.add('cur-on');      /* body.cur-on 이 네이티브 커서를 none 으로 */

  function lerp(a,b,t){ return a + (b-a)*t; }

  var mx = innerWidth/2, my = innerHeight/2, rx = mx, ry = my;

  addEventListener('pointermove', function(e){
    mx = e.clientX; my = e.clientY;
    dot.style.transform   = 'translate('+mx+'px,'+my+'px) translate(-50%,-50%)';
    label.style.transform = 'translate('+mx+'px,'+(my+34)+'px) translate(-50%,-50%)';
  }, {passive:true});

  (function raf(){
    rx = lerp(rx, mx, .18); ry = lerp(ry, my, .18);
    ring.style.transform = 'translate('+rx+'px,'+ry+'px) translate(-50%,-50%)';
    requestAnimationFrame(raf);
  })();

  /* 원본은 로드 시점에 querySelectorAll 로 직접 바인딩했는데, 그러면 나중에 만들어지는
     요소(갤러리 썸네일 등)에는 라벨이 안 붙는다. 여기서는 문서에 위임해 둔다. */
  var HOVER_SEL = '[data-cursor],button,.glass-card';
  var current = null;

  function enter(el){
    if(el === current) return;
    current = el;
    ring.classList.add('grow');
    var t = el.getAttribute('data-cursor');
    if(t){ label.textContent = t; label.style.opacity = '1'; }
    else { label.style.opacity = '0'; }
  }
  function leave(){
    if(!current) return;
    current = null;
    ring.classList.remove('grow');
    label.style.opacity = '0';
  }

  addEventListener('pointerover', function(e){
    var el = e.target && e.target.closest ? e.target.closest(HOVER_SEL) : null;
    if(el) enter(el); else leave();
  }, {passive:true});

  addEventListener('pointerout', function(e){
    /* 자식 요소로 넘어가는 중이면 유지 — 같은 대상 안에서 깜빡이지 않게 */
    var to = e.relatedTarget;
    if(to && to.closest && to.closest(HOVER_SEL) === current) return;
    leave();
  }, {passive:true});
})();
