/* ============================================================================
   ArgoScramble — 글자가 코드처럼 돌다가 확정되는 연출.

   원래 shared/app.js 안에만 있어서 index.html 에서만 동작했다.
   11-planet-detail.html 의 BEGIN ASSESSMENT 처럼 다른 문서의 버튼에도 같은
   효과를 걸려고 여기로 뽑았다. 알고리즘·문자셋·타이밍은 app.js 원본 그대로다.
     · 앞 글자부터 순서대로 확정된다 (charLockAt = i/len * 0.7)
     · 공백/줄바꿈은 건드리지 않는다
     · 요소당 rAF 하나만 돈다 (재호출 시 이전 것 취소)

   사용:
     ArgoScramble.text(el, 'FINAL', 360);
     ArgoScramble.bindButtons(document);   // .lg-btn 호버에 일괄 바인딩
   ============================================================================ */
(function (global) {
  'use strict';

  var SCRAMBLE_CHARS = '01<>/\\[]{}#$%&*+=~ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function text(el, finalText, duration) {
    if (!el) return;
    duration = duration || 420;
    if (el._scrambleRAF) cancelAnimationFrame(el._scrambleRAF);
    var chars = String(finalText).split('');
    var startTime = performance.now();

    function frame(now) {
      var progress = Math.min(1, (now - startTime) / duration);
      var out = '';
      for (var i = 0; i < chars.length; i++) {
        var ch = chars[i];
        if (ch === ' ' || ch === '\n') { out += ch; continue; }
        var charLockAt = (i / chars.length) * 0.7;   /* 앞 글자가 먼저 확정된다 */
        if (progress >= charLockAt + 0.3) out += ch;
        else out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
      }
      el.textContent = out;
      if (progress < 1) {
        el._scrambleRAF = requestAnimationFrame(frame);
      } else {
        el.textContent = finalText;
        el._scrambleRAF = null;
      }
    }
    el._scrambleRAF = requestAnimationFrame(frame);
  }

  /* .lg-btn 안의 .lg-label 을 호버 때 스크램블한다.
     라벨에 자식 엘리먼트가 있으면 textContent 를 통째로 갈아끼울 수 없다
     (예: 시험지의 <span id="aw-next-label">, CANDIDATE WALL 의 숫자 <b>).
     그래서 자식이 있으면 .lg-word 만 대상으로 하고, 그것도 없으면 건너뛴다. */
  function bindButtons(root) {
    (root || document).querySelectorAll('.lg-btn .lg-label').forEach(function (label) {
      if (label._scrambleBound) return;
      var word = label.children.length ? label.querySelector(':scope > .lg-word') : label;
      if (!word) return;
      label._scrambleBound = true;
      var original = word.textContent;
      var btn = label.closest('.lg-btn');
      if (!btn) return;
      btn.addEventListener('mouseenter', function () { text(word, original, 360); });
    });
  }

  global.ArgoScramble = { text: text, bindButtons: bindButtons, CHARS: SCRAMBLE_CHARS };
})(window);
