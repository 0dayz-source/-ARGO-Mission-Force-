/* ============================================================================
   FoldText — React Bits <FoldText /> 바닐라 이식.
   원본: npx shadcn@latest add @react-bits/FoldText-JS-CSS  (React + GSAP)
   이 프로젝트는 React 가 아니라서 MetaBalls·WavePath 와 같은 방식으로 옮겼다.
   DOM 구조와 CSS 클래스명은 원본 그대로, GSAP 타임라인만 CSS transition 으로 바꿨다.
     gsap fromTo(opacity 0→1, rotateX -92→0, --fold-crease .55→0, stagger)
       → 조각마다 transition-delay = index * stagger

   쓰는 법 — 요소에 data-foldtext 를 붙이면 된다:
     <h2 data-foldtext data-fold-split="word">첫 줄<br>둘째 줄</h2>
   옵션(모두 생략 가능, 괄호 안이 기본값):
     data-fold-split       char | word | line        (char)
     data-fold-hinge       top | bottom | left | right (top)
     data-fold-duration    초                          (0.65)
     data-fold-stagger     초                          (0.045)
     data-fold-perspective px                          (700)
     data-fold-crease      0~1                         (0.55)
     data-fold-trigger     mount | scroll | hover | loop (scroll)
   ============================================================================ */
(function () {
  'use strict';

  var HINGE = {
    top:    { origin: '50% 0%',   rotateX: -92, rotateY:   0 },
    bottom: { origin: '50% 100%', rotateX:  92, rotateY:   0 },
    left:   { origin: '0% 50%',   rotateX:   0, rotateY:  92 },
    right:  { origin: '100% 50%', rotateX:   0, rotateY: -92 }
  };
  /* gsap 'power3.out'(easeOutQuart) 에 대응하는 베지어 */
  var EASE = 'cubic-bezier(.165,.84,.44,1)';
  var NBSP = ' ';

  function clamp(v, lo, hi){ return Math.min(hi, Math.max(lo, v)); }
  function num(el, name, dflt){
    var raw = el.getAttribute(name);
    if (raw == null || raw === '') return dflt;
    var v = parseFloat(raw);
    return isNaN(v) ? dflt : v;
  }

  /* <br> 과 개행을 \n 으로 통일한 평문을 얻는다 */
  function readText(el){
    var html = el.innerHTML
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    var d = document.createElement('textarea');
    d.innerHTML = html;
    return d.value.replace(/[ \t]+\n/g, '\n').trim();
  }

  function build(el){
    var splitBy  = el.getAttribute('data-fold-split') || 'char';
    var hingeKey = el.getAttribute('data-fold-hinge') || 'top';
    var hinge    = HINGE[hingeKey] || HINGE.top;
    var persp    = Math.max(120, num(el, 'data-fold-perspective', 700));
    var text     = readText(el);

    var pieces = [];

    function segment(content, split){
      var seg = document.createElement('span');
      seg.className = 'fold-text-segment';
      seg.setAttribute('data-fold-split', split || splitBy);
      seg.style.setProperty('--fold-perspective', persp + 'px');

      var piece = document.createElement('span');
      piece.className = 'fold-text-piece';
      piece.setAttribute('data-fold-hinge', hingeKey);
      piece.style.transformOrigin = hinge.origin;
      piece.style.setProperty('--fold-crease', '0');
      piece.textContent = content || NBSP;

      seg.appendChild(piece);
      pieces.push(piece);
      return seg;
    }

    var visual = document.createElement('span');
    visual.className = 'fold-text-visual';
    visual.setAttribute('aria-hidden', 'true');

    if (splitBy === 'line') {
      text.split('\n').forEach(function(line){
        var wrap = document.createElement('span');
        wrap.className = 'fold-text-line';
        wrap.appendChild(segment(line || NBSP, 'line'));
        visual.appendChild(wrap);
      });
    } else if (splitBy === 'word') {
      text.split(/(\s+)/).forEach(function(part){
        if (!part) return;
        if (/^\s+$/.test(part)) {
          part.split(/(\n)/).forEach(function(bit){
            if (bit === '\n') { visual.appendChild(document.createElement('br')); return; }
            if (!bit) return;
            var ws = document.createElement('span');
            ws.className = 'fold-text-whitespace';
            ws.textContent = bit.replace(/ /g, NBSP);
            visual.appendChild(ws);
          });
          return;
        }
        visual.appendChild(segment(part));
      });
    } else {
      Array.from(text).forEach(function(ch){
        if (ch === '\n') { visual.appendChild(document.createElement('br')); return; }
        visual.appendChild(segment(ch === ' ' ? NBSP : ch));
      });
    }

    var sr = document.createElement('span');
    sr.className = 'fold-text-sr-only';
    sr.textContent = text;

    el.classList.add('fold-text');
    el.innerHTML = '';
    el.appendChild(sr);
    el.appendChild(visual);

    el.__fold = { pieces: pieces, hinge: hinge };
  }

  function play(el){
    var st = el.__fold;
    if (!st || !st.pieces.length) return;

    var reduce   = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dur      = num(el, 'data-fold-duration', 0.65);
    var stagger  = num(el, 'data-fold-stagger', 0.045);
    var crease   = clamp(num(el, 'data-fold-crease', 0.55), 0, 1);
    if (reduce) { dur = Math.min(dur, 0.22); stagger = Math.min(stagger, 0.02); crease = 0; }

    var rx = reduce ? 0 : st.hinge.rotateX;
    var ry = reduce ? 0 : st.hinge.rotateY;

    /* from : 접힌 상태 */
    st.pieces.forEach(function(p){
      p.style.transition = 'none';
      p.style.opacity = '0';
      p.style.transform = 'rotateX(' + rx + 'deg) rotateY(' + ry + 'deg)';
      p.style.setProperty('--fold-crease', String(crease));
    });
    void el.offsetWidth;   /* 위 초기값을 확정시킨 뒤 전환을 건다 */

    /* to : 펼쳐진 상태. stagger 는 조각별 transition-delay 로 준다. */
    st.pieces.forEach(function(p, i){
      var d = (i * stagger).toFixed(3) + 's';
      var t = dur + 's ' + EASE + ' ' + d;
      p.style.transition = 'opacity ' + t + ', transform ' + t + ', --fold-crease ' + t;
      p.style.opacity = '1';
      p.style.transform = 'rotateX(0deg) rotateY(0deg)';
      p.style.setProperty('--fold-crease', '0');
    });
  }

  function settle(el){
    var st = el.__fold; if (!st) return;
    st.pieces.forEach(function(p){
      p.style.transition = 'none';
      p.style.opacity = '1';
      p.style.transform = 'rotateX(0deg) rotateY(0deg)';
      p.style.setProperty('--fold-crease', '0');
    });
  }

  function init(){
    var els = [].slice.call(document.querySelectorAll('[data-foldtext]'));
    if (!els.length) return;
    els.forEach(build);

    var scrollEls = [];
    els.forEach(function(el){
      var trigger = el.getAttribute('data-fold-trigger') || 'scroll';
      if (trigger === 'hover') {
        settle(el);
        el.addEventListener('mouseenter', function(){ play(el); });
      } else if (trigger === 'loop') {
        play(el);
        var st = el.__fold;
        var period = (num(el,'data-fold-duration',0.65) + st.pieces.length * num(el,'data-fold-stagger',0.045) + 0.75) * 1000;
        setInterval(function(){ play(el); }, period);
      } else if (trigger === 'mount') {
        play(el);
      } else {
        /* scroll : 화면에 들어올 때 재생. 벗어나면 접어 두어 다시 들어올 때 또 펼쳐진다
           — 기존 encrypt 연출과 같은 상하 양방향 동작. */
        st_fold_from(el);
        scrollEls.push(el);
      }
    });

    function st_fold_from(el){
      var st = el.__fold; if (!st) return;
      var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      var crease = reduce ? 0 : clamp(num(el, 'data-fold-crease', 0.55), 0, 1);
      var rx = reduce ? 0 : st.hinge.rotateX, ry = reduce ? 0 : st.hinge.rotateY;
      st.pieces.forEach(function(p){
        p.style.transition = 'none';
        p.style.opacity = '0';
        p.style.transform = 'rotateX(' + rx + 'deg) rotateY(' + ry + 'deg)';
        p.style.setProperty('--fold-crease', String(crease));
      });
    }

    if (scrollEls.length) {
      var io = new IntersectionObserver(function(entries){
        entries.forEach(function(en){
          if (en.isIntersecting) play(en.target);
          else st_fold_from(en.target);
        });
      }, { threshold: 0.25 });
      scrollEls.forEach(function(el){ io.observe(el); });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
