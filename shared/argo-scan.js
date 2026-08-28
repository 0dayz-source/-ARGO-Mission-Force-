/* ARGO 생체 촬영(웹캠) 로직. 11-planet-detail.html 인라인 <script id="scan-fx"> 에서 분리.
   독립 촬영 페이지와 공유하려고 분리했다. window.ARGO_SCAN_STANDALONE=true 로 두면
   genome(DNA) 연동을 끊고 독립 갤러리를 쓴다 — 아래 STORE_KEY/GALLERY_KEY 부분 참고. */

/* ============================================================
   [ADDED 2026-07 rev2] APPLICANT BIOMETRIC SCAN
   webcam capture + MediaPipe Hands (fist->open shutter) + coral particles
   + 2068 cosmic filter baked into capture. Graceful fallback; never blocks scroll.
   ============================================================ */
(function(){
  var section=document.getElementById('scan-section');
  if(!section) return;
  var video=document.getElementById('scanVideo');
  var fx=document.getElementById('scanFx');
  var cap=document.getElementById('scanCapture');
  var stage=document.getElementById('scan-stage');
  var stateEl=document.getElementById('scanState');
  var stateTxt=document.getElementById('scanStateTxt');
  var countEl=document.getElementById('scanCount');
  var preview=document.getElementById('scanPreview');
  var previewImg=document.getElementById('scanPreviewImg');
  var fallback=document.getElementById('scanFallback');
  var shutterBtn=document.getElementById('scanShutter');
  var retakeBtn=document.getElementById('scanRetake');
  var skipBtn=document.getElementById('scanSkip');
  var statusHud=document.getElementById('scanStatusHud');
  var reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;

  /* STANDALONE = 랜딩 밖에서 독립으로 띄운 촬영 페이지용 경로.
     (webcam.html 을 걷어낸 지금은 쓰는 곳이 없지만, 촬영 UI 를 다시 떼어 낼 때를 위해 남겨 둔다.)
     여기서 찍은 사진은 genome(DNA) 쪽으로 넘어가면 안 되므로
     대표 컷 키(STORE_KEY)를 쓰지 않고 갤러리도 별도 키로 분리한다.
     announceCapture / persistCapture 는 아래에서 통째로 no-op 이 된다. */
  var STANDALONE = !!window.ARGO_SCAN_STANDALONE;
  var STORE_KEY='argoCandidateCapture';       /* 최신 1장 (DNA 섹션 등 기존 소비처 호환) */
  /* STORE_KEY 에 들어 있는 컷이 갤러리의 어느 레코드인지 기억한다.
     STORE_KEY 는 1024px 로 다시 인코딩한 dataURL 이라 갤러리 썸네일과 문자열이 달라서,
     이 키가 없으면 "지운 컷이 대표 컷이었는지"를 알 수 없다 → 지워도 게놈에 계속 남는다. */
  var REP_KEY='argoCandidateCaptureId';
  var GALLERY_KEY=STANDALONE ? 'argoWebcamGallery' : 'argoCandidateGallery';  /* 포토부스 갤러리 (최대 GALLERY_MAX 장) */
  /* 갤러리를 한 번이라도 이 코드가 건드렸다는 표시.
     이게 찍혀 있으면 아래 restore() 의 "구버전 단일 캡처 승격"을 돌리지 않는다.
     (승격이 계속 살아 있으면 마지막 한 장을 지워도 새로고침 때 되살아난다) */
  var SEED_KEY=GALLERY_KEY+':seeded';
  /* 960px q0.72 썸네일이 장당 ~120KB 라 20장이면 ~2.4MB. 쿼터를 넘기면
     writeGallery 의 폴백이 오래된 것부터 떨군다. */
  /* 저장 상한 — photo-wall(CANDIDATE GALLERY)이 같은 키를 읽으므로 여기서 줄이면
     그쪽 갤러리까지 깎인다. 원래대로 30 을 유지한다. */
  var GALLERY_MAX=30;
  /* 웹캠 페이지 아래 '촬영 기록' 스트립에만 걸리는 표시 상한 — 저장·DB 와 무관하다. */
  var STRIP_MAX=20;
  /* CYBERCORE 룩 — .pd-scan-video 의 CSS filter 와 같은 값(왜곡만 제외).
     노출을 올리고 sepia→hue-rotate 로 청록/시안 쪽으로 민다. 색수차/주사선은 vhsBake 가 굽는다. */
  /* .pd-scan-video 의 CSS filter 와 동일(왜곡만 제외). 물빠진 VHS 톤. */
  /* [단일 출처] 값은 shared/pd-skin.css 의 --cam-filter 하나뿐이다. 라이브 프리뷰가 쓰는
     바로 그 값을 읽어 캡처에도 굽는다 — 두 색감이 다시 갈라질 수 없다.
     (토큰을 못 읽는 상황에서만 아래 폴백을 쓴다) */
  var CAM_FILTER=(function(){
    try{
      var v=getComputedStyle(document.documentElement).getPropertyValue('--cam-filter').trim();
      if(v) return v;
    }catch(e){}
    return 'saturate(.72) contrast(.82) brightness(1.16) sepia(.12)';
  })();
  var ctx=fx.getContext('2d');
  var stream=null, hands=null, handsScriptLoaded=false, handsReady=false;
  var active=false, rafFx=null, rafPump=null, pumping=false;
  var landmarks=null, particles=[], rings=[], codes=[];
  var captured=false, capturing=false;
  /* 셔터가 눌린 순간의 코드 조각을 떠 둔다 — 아래 startCountdown 주석 참고 */
  var capCodes=null;
  var lowPerf=false, frameCount=0, fpsT0=0;
  var poseHeld=0, poseFirstAt=0;
  var poseEl=document.getElementById('scanPose'), poseTxt=document.getElementById('scanPoseTxt');
  var booth=document.getElementById('scanBooth'), boothStrip=document.getElementById('boothStrip'), boothCount=document.getElementById('boothCount');
  /* 손 트래킹 이펙트 컬러 — 전부 화이트 계열 (영상 필터는 그대로 유지) */
  var LIME=[[255,255,255],[236,240,236],[255,255,255],[214,220,214],[248,250,246]];
  var CORAL=LIME;   /* 기존 참조 호환 */

  function setState(txt,show){ if(txt!=null) stateTxt.textContent=txt; stateEl.classList.toggle('hide',!show); }
  function setHud(t){ if(statusHud) statusHud.textContent=t; }
  function sizeFx(){ var r=stage.getBoundingClientRect(); fx.width=Math.max(2,r.width); fx.height=Math.max(2,r.height); }
  addEventListener('resize',function(){ if(active) sizeFx(); },{passive:true});

  /* 손을 들면 랜딩 히어로에 떠다니는 것과 같은 계열의 코드 조각이 피어오른다.
     예전에는 별 파티클과 원형 선이 주역이었는데, 그 둘은 양을 대폭 줄이고
     거들기만 하게 남겼다. */
  var CODE_LINES=[
    '[ATMOS]  0.6% Earth', '[THERM] -63C avg', '[ROT]    24.6 hrs',
    '[STATUS] IN PROGRESS', 'relay ORBIT-3 ... ok', 'latency 12m40s',
    'link established · SOL-0687', 'biometric: \'sealed\'', 'genome: \'locked\'',
    'hash: sha256(frame)', 'scope: \'committee-only\'', 'archive.seal({ ... })',
    'scan sequence 03/06', 'surface dust ...... ok', 'pressure .......... ok',
    'mineral trace ..... ok', 'score(c.cognitive)', 'if (s < THRESHOLD) reject(c)',
    'return admit(c)', 'SELECT * FROM candidates', 'ORDER BY sealed_at DESC',
    'adaptation_score > 0.82', 'col = dither(col, bayer8)', 'fragColor = vec4(col, 1.0)',
    'vec3 col = texture(uCapture, uv).rgb', 'phase 02 · running',
    'mirrors   deployed', 'nanoswarm active', 'id: \'TFSC-04\''
  ];
  /* 코드 색 팔레트 — 레드가 기본이고 민트·오렌지가 가끔 섞인다.
     비율을 배열 길이로 준다: 레드 6 / 민트 1 / 오렌지 1 ≈ 75% / 12.5% / 12.5%.
     색은 생성할 때 한 번 정해 두고 수명 내내 유지한다(매 프레임 바뀌면 깜빡인다). */
  /* 조각 색 — 전부 ARGO 팔레트에서만 가져온다(크리드 글자에 쓰는 것과 같은 계열).
     예전엔 8개 중 6개가 같은 레드라 사실상 단색으로 보였다. 코랄을 중심에 두되
     로즈·핑크·페일핑크·오렌지·민트·화이트까지 펼쳐 한 화면에 여러 색이 섞이게 한다. */
  var CODE_COLORS=[
    [255, 107, 102],   /* --neon-coral */
    [255, 107, 102],
    [249, 54, 42],   /* 딥 레드 */
    [255, 77,122],   /* 로즈 */
    [255,128,152],   /* 핑크 */
    [255,176,192],   /* 페일 핑크 */
    [255,154,122],   /* --neon-coral-soft */
    [252,105, 38],   /* 오렌지 */
    [255, 45, 130],   /* --orange (= --red 와 같은 핑크) */
    [ 90,235,221],   /* --cyan 민트 */
    [255,254,255]    /* 하이라이트 */
  ];
  function spawnCode(x,y){
    /* 동시 표시 상한. 16 → 34 로 올렸다 — 손을 들고 있어도 화면이 너무 비어 보였다.
       저성능 기기에서는 절반 정도로만 (lowPerf 는 fps 측정으로 자동 판정). */
    if(codes.length > (lowPerf?14:34)) return;
    codes.push({
      /* 뿌려지는 범위도 넓혔다(120×70 → 190×110) — 상한만 올리면 손 주변에 뭉친다 */
      x:x + (Math.random()-.5)*190,
      y:y + (Math.random()-.5)*110,
      vx:(Math.random()-.5)*0.22,
      vy:-(0.28+Math.random()*0.42),      /* 천천히 떠오른다 */
      life:1,
      /* 수명을 늘려(2.2초 → 3.3초) 한 화면에 겹쳐 보이는 양을 키운다 */
      decay:0.0036+Math.random()*0.0028,
      txt:CODE_LINES[(Math.random()*CODE_LINES.length)|0],
      col:CODE_COLORS[(Math.random()*CODE_COLORS.length)|0],
      size:(Math.random()*3+10)|0
    });
  }

  /* 별 파티클 — 양을 대폭 줄였다(5개 → 1개, 상한 620 → 70) */
  function spawnSpark(x,y,color){
    if(Math.random()>0.35) return;                 /* 매 프레임 뿌리지 않는다 */
    particles.push({
      x:x,y:y,
      vx:(Math.random()-.5)*2.4, vy:(Math.random()-.5)*2.4-0.4,
      life:1, r:Math.random()*2+0.8,
      color:color, spin:Math.random()*6.283
    });
    var maxP=lowPerf?30:70; if(particles.length>maxP) particles.splice(0,particles.length-maxP);
  }
  /* 포즈가 잡히는 순간 — 예전엔 44개 방사형 버스트였다. 지금은 코드가 주역이고
     파티클은 몇 알만 튄다. */
  function burst(x,y){
    var n=lowPerf?4:8;
    for(var i=0;i<n;i++){
      var a=(i/n)*6.283+Math.random()*0.2, sp=1.4+Math.random()*2.2;
      particles.push({
        x:x,y:y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,
        life:1,r:Math.random()*2+1,
        color:LIME[(Math.random()*LIME.length)|0],spin:a
      });
    }
    for(var c=0;c<(lowPerf?4:9);c++) spawnCode(x,y);   /* 찰칵 순간의 폭발 : 4 → 9 */
    emitRing(x,y);
  }
  /* 원형 선도 최소만 (10개 → 2개) */
  function emitRing(x,y){ if(rings.length>2) return; rings.push({x:x,y:y,r:8,life:1}); }

  function drawFx(ts){
    if(!active){ rafFx=null; return; }
    frameCount++; if(!fpsT0)fpsT0=ts;
    if(ts-fpsT0>=1000){ if(frameCount<34)lowPerf=true; else if(frameCount>50)lowPerf=false; frameCount=0; fpsT0=ts; }
    var W=fx.width,H=fx.height; ctx.clearRect(0,0,W,H);
    var i,p;
    for(i=particles.length-1;i>=0;i--){ p=particles[i]; p.x+=p.vx;p.y+=p.vy;p.vy+=0.03;p.vx*=0.98;p.vy*=0.98;p.life-=0.02;
      if(p.life<=0){particles.splice(i,1);continue;}
      ctx.globalAlpha=Math.max(0,p.life);
      var col='rgb('+p.color[0]+','+p.color[1]+','+p.color[2]+')';
      ctx.shadowColor=col; ctx.shadowBlur=lowPerf?0:12;   /* 네온 글로우 */
      ctx.fillStyle=col;
      ctx.beginPath();ctx.arc(p.x,p.y,Math.max(.4,p.r*p.life),0,6.283);ctx.fill();
      ctx.shadowBlur=0; }
    for(i=rings.length-1;i>=0;i--){ var rg=rings[i]; rg.r+=3.4; rg.life-=0.012;
      if(rg.life<=0){rings.splice(i,1);continue;}
      ctx.globalAlpha=Math.max(0,rg.life)*0.7; ctx.strokeStyle='rgb(255,255,255)'; ctx.lineWidth=2.4;
      ctx.beginPath();ctx.arc(rg.x,rg.y,rg.r,0,6.283);ctx.stroke(); }
    /* 코드 조각 — 랜딩 히어로의 떠다니는 스니펫과 같은 결. 모노 서체로 위로 흐른다. */
    if(codes.length){
      ctx.textAlign='left'; ctx.textBaseline='middle';
      for(i=codes.length-1;i>=0;i--){
        var cd=codes[i];
        cd.x+=cd.vx; cd.y+=cd.vy; cd.life-=cd.decay;
        if(cd.life<=0){ codes.splice(i,1); continue; }
        /* 들어올 때 살짝 밝아지고 나갈 때 사그라든다 */
        var a=cd.life>0.85 ? (1-cd.life)/0.15 : cd.life/0.85;
        /* 0.85 → 0.58 : 꽉 찬 불투명이라 영상 위에 판때기처럼 얹혔다.
           채도는 유지한 채 알파만 내려 "떠 있는 데이터" 로 보이게 한다. */
        ctx.globalAlpha=Math.max(0,Math.min(1,a))*0.58;
        ctx.font='500 '+cd.size+'px "IBM Plex Mono", ui-monospace, monospace';
        /* 색은 조각마다 물려 둔 것을 쓴다(레드 기본 · 민트/오렌지 약간).
           글로우는 같은 색으로 깔아 번지면서 채도가 살게 한다 — 알파를 내린 만큼
           글로우가 색을 붙잡아 줘야 흐릿해 보이지 않는다. */
        var col=cd.col||[255,45,45];
        var rgb=col[0]+','+col[1]+','+col[2];
        ctx.shadowColor='rgba('+rgb+',.85)'; ctx.shadowBlur=lowPerf?0:12;
        ctx.fillStyle='rgba('+rgb+',1)';
        ctx.fillText(cd.txt, cd.x, cd.y);
        ctx.shadowBlur=0;
      }
    }
    if(landmarks){ var tips=[4,8,12,16,20]; ctx.globalAlpha=.72; ctx.fillStyle='rgb(255,255,255)';
      for(i=0;i<tips.length;i++){ var lm=landmarks[tips[i]]; if(!lm)continue; ctx.beginPath();ctx.arc((1-lm.x)*W,lm.y*H,3,0,6.283);ctx.fill(); } }
    ctx.globalAlpha=1; rafFx=requestAnimationFrame(drawFx);
  }

  function ext(lm,tip,pip){ return lm[tip].y < lm[pip].y; }
  function isOpen(lm){ return ext(lm,8,6)&&ext(lm,12,10)&&ext(lm,16,14)&&ext(lm,20,18); }
  function dist(a,b){ var dx=a.x-b.x, dy=a.y-b.y; return Math.sqrt(dx*dx+dy*dy); }

  /* --- 찰칵(카메라 프레임) 포즈 판정 ---
     예전 판정은 lm[tip].y < lm[pip].y 로 "위로 폈는지"만 봐서, 손을 눕히거나 기울이는
     실제 찰칵 포즈에서는 거의 인식이 안 됐다. 이제 손목에서의 거리로 판정한다 →
     손이 어느 방향을 향하든(회전 불변) 동일하게 동작한다. */
  function fingerOut(lm,pip,tip){
    var w=lm[0];
    return dist(w,lm[tip]) > dist(w,lm[pip])*1.06;
  }
  function isLShape(lm){
    var indexOut = fingerOut(lm,6,8);
    if(!indexOut) return false;
    /* 중지·약지·새끼 중 2개만 접혀 있어도 인정 (엄격하게 3개 다 요구하면 잘 안 잡힌다) */
    var folded=0;
    if(!fingerOut(lm,10,12))folded++;
    if(!fingerOut(lm,14,16))folded++;
    if(!fingerOut(lm,18,20))folded++;
    if(folded<2) return false;
    /* 엄지가 검지 뿌리에서 벌어져 'ㄱ' 를 만드는가 (주먹의 접힌 엄지와 구분) */
    var palm = dist(lm[0],lm[9]) || 0.001;
    return (dist(lm[4],lm[5])/palm) > 0.45;
  }
  function isCameraFrame(hands){
    if(!hands||!hands.length)return false;
    if(hands.length>=2){
      /* 두 손이 잡히면: 둘 다 ㄱ자면 바로 인정. 한쪽만 ㄱ자여도 서로 가까우면 인정 */
      var a=isLShape(hands[0]), b=isLShape(hands[1]);
      if(a&&b) return true;
      if(a||b){
        var palm=(dist(hands[0][0],hands[0][9])+dist(hands[1][0],hands[1][9]))/2 || 0.001;
        var near=Math.min(dist(hands[0][4],hands[1][4]), dist(hands[0][8],hands[1][8]));
        return (near/palm) < 3.6;
      }
      return false;
    }
    return isLShape(hands[0]);
  }
  function setPose(txt,armed){
    if(poseTxt&&txt!=null)poseTxt.textContent=txt;
    if(poseEl)poseEl.classList.toggle('armed',!!armed);
  }
  /* 손이 잡히면 스테이지의 위치 가이드가 밝아진다 (얼굴 위에는 아무것도 안 그린다) */
  /* 원형 가이드 프레임을 없애면서 sc-hand 로 스타일이 바뀌는 대상이 사라졌다.
     호출부는 여러 곳이라 함수는 남기되 no-op 으로 둔다. */
  function setHand(on){ /* no-op */ }
  /* 좌측 상태 카드 */
  function setStat(key,txt,ok){
    var el=document.querySelector('[data-stat="'+key+'"]');
    if(!el)return;
    el.textContent=txt;
    var card=el.closest('.sc-stat'); if(card)card.classList.toggle('ok',!!ok);
  }

  var HOLD_MS=420;   /* 찰칵 포즈를 이만큼 유지하면 카운트다운 시작 */
  var poseLastSeen=0;
  function onResults(res){
    if(!active) return;
    var hs=res && res.multiHandLandmarks;
    setHand(!!(hs && hs.length));
    setStat('face', (hs&&hs.length)?'GOOD':'SEARCHING', !!(hs&&hs.length));
    if(hs && hs.length){
      landmarks=hs[0]; var W=fx.width,H=fx.height;
      /* 손을 들면 코드가 피어오른다 — 손바닥 중심에서 꾸준히, 손끝에서는 가끔.
         예전에는 손끝 5개에서 매 프레임 스파크가 쏟아졌다(가장 큰 양). */
      var TIPS=[4,8,12,16,20];
      for(var hi=0;hi<hs.length;hi++){
        var pc=hs[hi][9];
        /* 손바닥 중심 : 0.16 → 0.34 (프레임당 확률) */
        if(pc && Math.random()<0.34) spawnCode((1-pc.x)*W,pc.y*H);
        for(var ti=0;ti<TIPS.length;ti++){
          var lmp=hs[hi][TIPS[ti]];
          if(!lmp) continue;
          if(Math.random()<0.12) spawnCode((1-lmp.x)*W,lmp.y*H);   /* 손끝 5곳 : 0.05 → 0.12 */
          spawnSpark((1-lmp.x)*W,lmp.y*H,LIME[ti%LIME.length]);   /* 내부에서 65% 는 건너뛴다 */
        }
      }
      /* 원형 선은 아주 가끔만 (0.35 → 0.06) */
      if(isOpen(landmarks)){ var c=landmarks[9]; if(c && Math.random()<0.06) emitRing((1-c.x)*W,c.y*H); }

      if(!captured && !capturing){
        var now=performance.now();
        if(isCameraFrame(hs)){
          if(!poseFirstAt) poseFirstAt=now;
          poseLastSeen=now;
          poseHeld=now-poseFirstAt;
          if(poseHeld>=HOLD_MS){
            poseFirstAt=0; poseHeld=0;
            setHud('FRAME LOCKED · CAPTURE');
            setPose('찰칵! 촬영합니다',true);
            var cc=landmarks[9]; if(cc){ emitRing((1-cc.x)*W,cc.y*H); burst((1-cc.x)*W,cc.y*H); }
            startCountdown();
          } else {
            setHud('FRAME POSE '+Math.round(poseHeld/HOLD_MS*100)+'%');
            setPose('그대로! 잠깐만 유지하세요',true);
          }
        } else if(poseFirstAt && now-poseLastSeen < 350){
          /* 트래킹이 한두 프레임 튀어도 진행도를 날리지 않는다 (히스테리시스) */
          setHud('FRAME POSE '+Math.round(poseHeld/HOLD_MS*100)+'%');
        } else {
          poseFirstAt=0; poseHeld=0;
          setHud('TRACKING');
          setPose('손가락으로 사각 프레임(찰칵 포즈)을 만들어 보세요',false);
        }
      }
    } else {
      landmarks=null;
      if(performance.now()-poseLastSeen>350){ poseFirstAt=0; poseHeld=0; }
      if(!capturing&&!captured){ setHud('SEARCHING'); setPose('손을 화면 안으로 들어 올리세요',false); }
    }
  }

  function flashCount(n){ countEl.textContent=n; countEl.classList.remove('show'); void countEl.offsetWidth; countEl.classList.add('show'); }
  function startCountdown(){
    if(capturing||captured) return;
    capturing=true; shutterBtn.disabled=true; setHud('CAPTURING');
    /* [중요] 코드 조각의 수명은 약 2.2초(decay 0.0055~0.0095/프레임)인데 셔터는 3초 뒤에
       터진다. 그 사이 손을 내리면 코드가 전부 사그라들어 저장본에 아무것도 안 남았다.
       → 포즈가 잡힌 '지금' 의 코드를 떠 두고, 저장본에는 이걸 굽는다.
       화면에서는 그대로 흐르게 두므로 라이브 연출은 달라지지 않는다. */
    capCodes = codes.map(function(c){
      /* life 는 있는 그대로 뜬다. 예전엔 Math.max(life,0.55) 로 바닥을 깔았는데,
         화면에서 거의 사그라든 조각(life 0.1 → 알파 0.07)이 저장본에서 0.38 로
         다섯 배 넘게 진해졌다. "보이는 대로 찍히게" 하려면 손대면 안 된다. */
      return {x:c.x, y:c.y, size:c.size, txt:c.txt, col:c.col, life:c.life};
    });
    var n=3; flashCount(n);
    var iv=setInterval(function(){ n--; if(n<=0){ clearInterval(iv); doCapture(); return; } flashCount(n); },1000);
  }
  function drawPlaceholder(cx,w,h){
    var g=cx.createLinearGradient(0,0,w,h); g.addColorStop(0,'#2a0f10'); g.addColorStop(1,'#0b0708');
    cx.fillStyle=g; cx.fillRect(0,0,w,h);
    cx.fillStyle='rgba(255,61,104,0.5)'; cx.textAlign='center'; cx.font='90px sans-serif'; cx.fillText('◎',w/2,h/2+30);
    cx.fillStyle='rgba(212,250,255,0.62)'; cx.font='22px "Noto Sans KR",sans-serif'; cx.fillText('생체 데이터 미등록',w/2,h/2+92);
  }
  function cosmicOverlay(cx,w,h){
    /* --- 블랙 리프트 ---
       VHS 의 "빛바랜" 느낌은 대비를 낮추는 것만으로는 안 나온다. 어두운 영역이
       검정이 아니라 뿌연 연회록으로 떠 있어야 한다 → screen 으로 밝은 회록을 얹는다. */
    cx.save(); cx.globalCompositeOperation='screen'; cx.globalAlpha=0.17;
    cx.fillStyle='#9A8E96'; cx.fillRect(0,0,w,h); cx.restore();

    /* 하이라이트에 도는 분홍기 */
    cx.save(); cx.globalCompositeOperation='soft-light'; cx.globalAlpha=0.30;
    var hg=cx.createRadialGradient(w/2,h*0.38,h*0.06,w/2,h*0.5,h*0.95);
    hg.addColorStop(0,'rgba(212,250,255,1)'); hg.addColorStop(1,'rgba(212,250,255,0)');
    cx.fillStyle=hg; cx.fillRect(0,0,w,h); cx.restore();

    /* 가장자리는 아주 옅게만 (VHS 는 강한 비네트가 아니라 뿌연 감쇠) */
    var og=cx.createRadialGradient(w/2,h/2,h*0.42,w/2,h/2,h*0.95);
    og.addColorStop(0,'rgba(70,64,68,0)'); og.addColorStop(1,'rgba(70,64,68,0.26)');
    cx.fillStyle=og; cx.fillRect(0,0,w,h);
  }

  /* --- VHS 굽기 ---
     라이브 프리뷰의 CSS 필터는 캔버스에 남지 않으므로, 저장본에도 같은 룩을 직접 그린다.
       1) 색수차: 원본을 R/B 로 걸러 좌우로 몇 px 어긋나게 스크린 합성
       2) 트래킹 왜곡: 임의 높이의 가로 밴드를 몇 개 골라 좌우로 밀어버림
       3) 주사선 + 노이즈 + 비네트 */
  function vhsBake(cx,w,h,srcCanvas){
    /* 1) 색수차 */
    var off=Math.round(w*0.005)+3;
    cx.save(); cx.globalCompositeOperation='screen'; cx.globalAlpha=0.42;
    cx.filter='url(#vhsMag)';   try{ cx.drawImage(srcCanvas,-off,0,w,h); }catch(e){}
    cx.filter='url(#vhsGrn)';   try{ cx.drawImage(srcCanvas, off,0,w,h); }catch(e){}
    cx.filter='none'; cx.restore();
    /* 얼굴 영역의 색 갈라짐만 되돌려 이목구비가 또렷하게 남게 한다.
       원본을 중앙 밴드에만 옅게 다시 얹는 방식 — 프레임 전체 VHS 룩은 그대로. */
    var fy=Math.round(h*0.30), fh=Math.round(h*0.40);
    cx.save(); cx.globalAlpha=0.34;
    try{ cx.drawImage(srcCanvas, 0,fy,w,fh, 0,fy,w,fh); }catch(e){}
    cx.restore();

    /* 2) 트래킹 밴드 — 몇 줄을 통째로 좌우로 민다.
       예전엔 by 를 0~h 균일 난수로 뽑아서 밴드 절반가량이 세로 중앙,
       즉 얼굴 위에 얹혔다. 얼굴이 밀려 결과물이 아깝게 나오던 원인.
       FACE_TOP~FACE_BOT(중앙 40%)을 "보호 구역"으로 두고 그 밖에서만 뽑는다. */
    var FACE_TOP=0.30, FACE_BOT=0.70;
    var topRoom=FACE_TOP*h, botRoom=(1-FACE_BOT)*h;
    var bands=3+((Math.random()*3)|0);
    for(var b=0;b<bands;b++){
      var bh=Math.max(3,Math.floor(Math.random()*h*0.035));
      /* 위/아래 구역 중 하나를 면적 비율대로 골라 그 안에서만 위치를 잡는다 */
      var by, r=Math.random()*(topRoom+botRoom);
      if(r<topRoom) by=Math.floor(r);
      else          by=Math.floor(FACE_BOT*h+(r-topRoom));
      if(by+bh>h) bh=h-by;
      /* 보호 구역을 침범하면 그 경계에서 자른다 */
      if(by<FACE_TOP*h && by+bh>FACE_TOP*h) bh=Math.floor(FACE_TOP*h)-by;
      if(bh<=0)continue;
      var shift=Math.round((Math.random()-0.5)*w*0.035);
      try{ cx.drawImage(srcCanvas, 0,by,w,bh, shift,by,w,bh); }catch(e){}
      cx.save(); cx.globalCompositeOperation='screen'; cx.globalAlpha=0.12;
      cx.fillStyle='#9A8E96'; cx.fillRect(0,by,w,bh); cx.restore();
    }

    /* 3) 주사선 */
    cx.save(); cx.globalAlpha=0.08; cx.fillStyle='#000';
    for(var y=0;y<h;y+=3) cx.fillRect(0,y,w,1);
    cx.restore();

    /* 4) 노이즈 */
    cx.save(); cx.globalAlpha=0.055;
    for(var i=0;i<Math.round(w*h/900);i++){
      var v=(Math.random()*255)|0;
      cx.fillStyle='rgb('+v+','+v+','+v+')';
      cx.fillRect((Math.random()*w)|0,(Math.random()*h)|0,1,1);
    }
    cx.restore();

    /* 5) 비네트는 cosmicOverlay 쪽에서 옅게 처리한다 (여기서 또 넣으면 물빠진 톤이 죽는다) */
  }

  /* 저장본에 '손 움직임을 따라 흐르던 코드' 만 굽는다.
     fx 캔버스를 통째로 blit 하면 파티클·링·지문점까지 딸려 오므로, codes 배열만
     저장본 좌표계로 다시 그린다. fx 는 화면(거울상) 좌표계이고 저장본 src 도 같은
     거울상이라 반전 없이 배율만 맞추면 위치가 그대로 맞는다. */
  function bakeHandCode(cx,w,h){
    var list = (capCodes && capCodes.length) ? capCodes : codes;
    if(!fx || !fx.width || !fx.height || !list.length) return;
    var sx=w/fx.width, sy=h/fx.height;
    cx.save();
    /* [핵심] 화면의 fx 캔버스는 CSS 로 mix-blend-mode:screen 이 걸려 있다.
       저장본에서는 기본 source-over 로 얹고 있어서, 화면에서는 영상에 스며들던
       코드가 사진에서만 또렷한 판때기로 찍혔다(사용자 지적). 같은 블렌드를 준다. */
    cx.globalCompositeOperation='screen';
    cx.textAlign='left'; cx.textBaseline='middle';
    for(var i=0;i<list.length;i++){
      var cd=list[i];
      /* 화면에서 쓰던 페이드 곡선 그대로 — 막 뜬 것/사그라드는 것의 밝기가 같아야
         "그 순간을 그대로 찍었다" 는 인상이 된다. */
      var a=cd.life>0.85 ? (1-cd.life)/0.15 : cd.life/0.85;
      cx.globalAlpha=Math.max(0,Math.min(1,a))*0.58;
      cx.font='500 '+Math.round(cd.size*sy)+'px "IBM Plex Mono", ui-monospace, monospace';
      var bcol=cd.col||[255,107,102], brgb=bcol[0]+','+bcol[1]+','+bcol[2];
      /* 글로우도 화면과 같은 값(12)을 저장 해상도 배율만큼 키운다 — 9 로 고정돼 있어
         글자만 커지고 번짐은 그대로라 윤곽이 화면보다 날카로웠다. */
      cx.shadowColor='rgba('+brgb+',.85)'; cx.shadowBlur=lowPerf?0:12*sy;
      cx.fillStyle='rgba('+brgb+',1)';
      cx.fillText(cd.txt, cd.x*sx, cd.y*sy);
    }
    cx.restore();
  }

  /* 저장본 하단/상단의 ARGO 프레임 각인 (날짜는 2068 고정) */
  function brandFrame(cx,w,h){
    cx.save();
    cx.strokeStyle='rgba(212,250,255,0.34)'; cx.lineWidth=2; cx.strokeRect(16,16,w-32,h-32);
    cx.fillStyle='rgba(212,250,255,0.85)'; cx.font='14px "IBM Plex Mono",monospace';
    cx.textBaseline='top'; cx.textAlign='left';
    cx.fillText('ARGO · BIOMETRIC INTAKE',30,28);
    /* 연도 2068 고정 + 한국 시간 — 규칙은 shared/argo-date.js */
    var stamp=window.ArgoDate?ArgoDate.dot():'2068.01.01';
    cx.textAlign='right'; cx.fillText('SOL-0687 · '+stamp,w-30,28);
    cx.textAlign='left'; cx.textBaseline='bottom'; cx.fillText('CANDIDATE INTAKE',30,h-28);
    cx.textAlign='right'; cx.fillText('23.4°N 137.2°E',w-30,h-28);
    cx.restore();
  }

  function doCapture(){
    var w=cap.width=1280, h=cap.height=720, cx=cap.getContext('2d');
    if(stream && video.readyState>=2){
      /* 색수차/밴드 왜곡이 "이미 보정된 원본"을 다시 샘플링해야 하므로 오프스크린에 먼저 그린다 */
      var src=document.createElement('canvas'); src.width=w; src.height=h;
      var sx=src.getContext('2d');
      sx.save(); sx.translate(w,0); sx.scale(-1,1);
      try{ sx.filter=CAM_FILTER; }catch(e){}
      try{ sx.drawImage(video,0,0,w,h); }catch(e){}
      sx.restore();

      cx.drawImage(src,0,0);
      vhsBake(cx,w,h,src);
      cosmicOverlay(cx,w,h);
      bakeHandCode(cx,w,h);        /* 손 움직임을 따라 흐르던 코드까지 저장본에 남긴다 */
    } else { drawPlaceholder(cx,w,h); }
    brandFrame(cx,w,h);
    var url; try{ url=cap.toDataURL('image/jpeg',0.86); }catch(e){ url=null; }
    captured=true; capturing=false;
    if(url){
      /* 세션 중에는 원본을 그대로 쓰고(아스키·확대 보기 품질),
         localStorage 에는 중간 해상도만 넣는다 — 원본 base64 는 쿼터를 넘긴다. */
      if(!STANDALONE) window.ARGO_CAPTURE=url;   /* STANDALONE: genome 으로 새지 않게 */
      /* [추적] 첫 정상 촬영에서 candidate_id 가 생기고, 이후 재촬영은 같은 값을 유지한다. */
      try{
        if(window.ArgoTrack){
          var _first=!ArgoTrack.candidateId();
          ArgoTrack.ensureCandidate();
          ArgoTrack.act('photo_captured',{page:'webcam',first_capture:_first});
        }
      }catch(e){}
      var rec=pushToGallery(url);
      announceCapture(url);
      persistCapture(url,rec.id);                /* 방금 찍은 컷이 대표 — 갤러리 레코드와 묶어 둔다 */
      /* Supabase 로 올린 뒤 public URL 을 같은 레코드에 적어 둔다.
         나중에 갤러리를 완전히 DB 로 옮길 때, 이 remote 값이 있는 컷은 그대로 재사용하면 된다. */
      if(window.ArgoDB && ArgoDB.uploadCapture){
        ArgoDB.uploadCapture(url).then(function(remote){
          if(remote) markGalleryRemote(rec.id, remote);
        });
      }
      showPreview(url);
    }
    setHud('CAPTURED'); setPose('촬영 완료 · 갤러리에 저장했습니다',false);   /* Genome 보관은 갤러리에서 선택 */
    scheduleAutoReset();
  }

  /* ---- BOOTH LIGHTBOX ---------------------------------------------------
     카드 위치/크기에서 최종 위치/크기로 FLIP 전환해 "카드가 펼쳐지는" 인상을 만든다.
     ESC · 바깥 클릭 · 닫기 버튼 모두로 닫히고, 열려 있는 동안 배경 스크롤을 막는다. */
  var lb=document.getElementById('boothLb');
  var lbCard=document.getElementById('boothLbCard');
  var lbImg=document.getElementById('boothLbImg');
  var lbCap=document.getElementById('boothLbCap');
  var lbSet=document.getElementById('boothLbSet');
  var lbClose=document.getElementById('boothLbClose');
  var lbItem=null, lbIdx=-1, lbOpen=false;

  function openLightbox(item,idx,fromImg){
    if(!lb)return;
    lbItem=item; lbIdx=idx;
    var src=bestUrl(item);
    /* 표시 크기: 가로·세로 어느 쪽도 잘리지 않게 두 한계를 함께 본다.
       카드는 [이미지 + 하단 메타바] 세로 스택이므로 메타바 높이까지 빼고 계산해야
       카드 전체가 화면에 들어온다. 예전엔 폭만 정하고 세로는 CSS max-height 로
       잘라서, 원본 비율과 어긋난 박스가 생기고 메타바가 밖으로 밀렸다. */
    lbImg.style.removeProperty('--lb-w');
    lbImg.onload=function(){
      var nw=lbImg.naturalWidth||0, nh=lbImg.naturalHeight||0;
      if(!nw||!nh)return;
      var meta=lbCard?lbCard.querySelector('.booth-lb-meta'):null;
      var metaH=meta?meta.offsetHeight:0;
      var maxW=Math.min(1440, innerWidth*0.92);
      var maxH=innerHeight*0.92 - metaH;
      /* 2.6배 상한 : 갤러리 썸네일(384px)이 소스일 때 과확대로 뭉개지는 걸 막는다 */
      var s=Math.min(maxW/nw, maxH/nh, 2.6);
      lbImg.style.setProperty('--lb-w', Math.max(280, Math.round(nw*s))+'px');
    };
    lbImg.src=src;
    var d=new Date(item.t||Date.now());
    lbCap.textContent='FRAME '+String(idx+1).padStart(2,'0')+' · '+
      (window.ArgoDate?ArgoDate.stamp(d.getTime()).slice(-5):'');

    lb.classList.add('on');
    lb.setAttribute('aria-hidden','false');
    lbOpen=true;
    document.documentElement.style.overflow='hidden';
    document.documentElement.classList.add('lb-open');   /* 커스텀 커서를 오버레이 위로 */

    /* FLIP: 최종 배치가 잡힌 뒤 카드 위치에서 시작하도록 역변환을 걸고 되돌린다 */
    if(fromImg && !reduce){
      requestAnimationFrame(function(){
        var a=fromImg.getBoundingClientRect(), b=lbCard.getBoundingClientRect();
        if(!b.width||!b.height)return;
        var sx=a.width/b.width, sy=a.height/b.height;
        lbCard.style.transition='none';
        lbCard.style.transform='translate('+(a.left-b.left)+'px,'+(a.top-b.top)+'px) scale('+sx+','+sy+')';
        lbCard.style.opacity='.4';
        requestAnimationFrame(function(){
          lbCard.style.transition='transform .46s cubic-bezier(.22,1,.36,1),opacity .3s ease-out';
          lbCard.style.transform='none';
          lbCard.style.opacity='1';
        });
      });
    }
  }
  function closeLightbox(){
    if(!lb||!lbOpen)return;
    lbOpen=false;
    lb.classList.remove('on');
    lb.setAttribute('aria-hidden','true');
    document.documentElement.style.overflow='';
    document.documentElement.classList.remove('lb-open');
    lbCard.style.transition='';lbCard.style.transform='';lbCard.style.opacity='';
  }
  if(lb){
    /* STANDALONE 은 genome 연동을 끊은 페이지다. "Genome에 보관" 은 눌러도
       아무 일이 없으므로(persistCapture/announceCapture 가 no-op) 아예 감춘다. */
    if(STANDALONE && lbSet){
      var lbAct=lbSet.closest('.booth-lb-act')||lbSet;
      lbAct.style.display='none';
    }
    lbClose.addEventListener('click',closeLightbox);
    lb.addEventListener('click',function(e){ if(!e.target.closest('.booth-lb-card')) closeLightbox(); });
    addEventListener('keydown',function(e){ if(e.key==='Escape') closeLightbox(); });
    lbSet.addEventListener('click',function(){
      if(!lbItem)return;
      var best=bestUrl(lbItem);
      if(!STANDALONE) window.ARGO_CAPTURE=best;   /* 아스키·캡슐은 가장 좋은 소스로 (STANDALONE 제외) */
      announceCapture(best);
      persistCapture(best,lbItem.id);
      renderGallery(lbIdx);
      closeLightbox();
    });
  }

  /* ---- PHOTO BOOTH ----------------------------------------------------
     맥북 포토부스처럼 촬영본이 아래 스트립에 쌓인다.
     localStorage 는 용량이 빠듯해서(보통 5MB) 갤러리용은 썸네일로 줄여 저장하고,
     넘치면 오래된 것부터 버린다. */
  /* STORE_KEY 는 게놈 아스키(196열 샘플링)와 DNA 캡슐 썸네일이 읽는다.
     1024px 면 두 용도 모두 충분하고 base64 도 수백 KB 로 떨어진다. */
  /* 대표 컷이 바뀐 걸 소비처(게놈 아스키 등)에 알린다.
     STANDALONE 에서는 이 두 함수가 genome 연동의 유일한 통로라 통째로 막는다.
     (window.ARGO_CAPTURE 대입도 호출부에서 함께 건너뛴다) */
  function announceCapture(url){
    if(STANDALONE) return;
    try{ dispatchEvent(new CustomEvent('argo:capture',{detail:url})); }catch(e){}
  }
  function persistCapture(fullUrl,repId){
    if(STANDALONE) return;
    /* 어느 갤러리 컷이 대표인지 먼저 적어 둔다 — 이미지 인코딩은 비동기라
       여기서 미루면 그 사이에 삭제가 들어왔을 때 짝이 어긋난다. */
    try{
      if(repId) localStorage.setItem(REP_KEY,repId);
      else localStorage.removeItem(REP_KEY);
    }catch(e){}
    var im=new Image();
    im.onload=function(){
      var tw=Math.min(1024,im.width), th=Math.round(tw*im.height/im.width);
      var c=document.createElement('canvas');c.width=tw;c.height=th;
      c.getContext('2d').drawImage(im,0,0,tw,th);
      var mid; try{ mid=c.toDataURL('image/jpeg',0.8); }catch(e){ return; }
      try{ localStorage.setItem(STORE_KEY,mid); }
      catch(e){ try{ localStorage.setItem(STORE_KEY,''); }catch(e2){} }
    };
    im.src=fullUrl;
  }
  /* 대표 컷(STORE_KEY)을 통째로 걷어낸다. 갤러리에서 마지막 컷까지 지웠을 때 쓴다.
     이걸 안 하면 게놈 아스키/DNA 캡슐/게스트북 업로드가 지워진 사진을 계속 물고 있다. */
  function clearCapture(){
    if(STANDALONE) return;
    try{ localStorage.removeItem(STORE_KEY); localStorage.removeItem(REP_KEY); }catch(e){}
    window.ARGO_CAPTURE=null;
    announceCapture('');
  }
  /* 삭제된 컷이 대표였다면 남아 있는 최신 컷으로 대표를 옮기고, 하나도 없으면 비운다. */
  function syncRepresentative(removedId,rest){
    if(STANDALONE) return;
    var repId=null; try{ repId=localStorage.getItem(REP_KEY); }catch(e){}
    /* REP_KEY 가 아직 없는 예전 데이터: 갤러리가 비었으면 대표도 함께 정리한다. */
    if(repId && repId!==removedId) return;
    if(!repId && rest.length) return;
    var next=rest.length?rest[rest.length-1]:null;
    if(!next){ clearCapture(); return; }
    var best=bestUrl(next);
    if(!best){ clearCapture(); return; }
    window.ARGO_CAPTURE=best;
    announceCapture(best);
    persistCapture(best,next.id);
  }
  function makeThumb(url,cb){
    var im=new Image();
    im.onload=function(){
      /* [FIX] 384 -> 960. 크게 띄우려면 소스 해상도가 그만큼 있어야 한다.
         960px JPEG q0.72 ≈ base64 120KB, 12장이면 ~1.5MB 로 쿼터 안에 들어온다. */
      var tw=960, th=Math.round(tw*im.height/im.width);
      var c=document.createElement('canvas'); c.width=tw; c.height=th;
      c.getContext('2d').drawImage(im,0,0,tw,th);
      try{ cb(c.toDataURL('image/jpeg',0.72)); }catch(e){ cb(url); }
    };
    im.onerror=function(){ cb(url); };
    im.src=url;
  }
  function readGallery(){
    var list;
    try{ var raw=localStorage.getItem(GALLERY_KEY); list=raw?JSON.parse(raw):[]; }catch(e){ return []; }
    if(!Array.isArray(list)) return [];
    /* 구버전 레코드({u,t})를 DB 이관용 스키마로 승격 — 전부 id/sid/remote 를 갖게 한다 */
    for(var i=0;i<list.length;i++){
      var r=list[i];
      if(!r||typeof r!=='object'){ list.splice(i--,1); continue; }
      if(!r.id) r.id='cap_'+(r.t||Date.now()).toString(36)+'_'+i;
      if(r.sid===undefined) r.sid=(window.ArgoDB&&ArgoDB.sid)?ArgoDB.sid():null;
      if(r.remote===undefined) r.remote=null;
    }
    return list;
  }
  function writeGallery(list){
    /* 한 번이라도 갤러리를 쓴 이상 "구버전 단일 캡처 승격"은 다시 돌면 안 된다.
       빈 배열을 쓰는 경우(=마지막 컷 삭제)에도 반드시 찍어야 되살아나지 않는다. */
    try{ localStorage.setItem(SEED_KEY,'1'); }catch(e){}
    /* 용량 초과 시 오래된 것부터 떨궈가며 재시도 */
    var copy=list.slice();
    while(copy.length){
      try{ localStorage.setItem(GALLERY_KEY, JSON.stringify(copy)); return copy; }
      catch(e){ copy.shift(); }
    }
    try{ localStorage.removeItem(GALLERY_KEY); }catch(e){}
    return [];
  }
  /* 갤러리 레코드 스키마 (localStorage → 나중에 Supabase captures 테이블로 이관 예정)
       id     : 클라이언트 생성 고유키 (이관 후에도 중복 업로드 방지용)
       sid    : ArgoDB.sid() 세션 아이디 — captures.session_id 와 1:1
       t      : 촬영 시각(ms)
       u      : 로컬 썸네일 dataURL (이관되면 버려도 되는 캐시)
       remote : Storage public URL — 채워져 있으면 이미 DB 에 올라간 컷 */
  /* 확대 보기용 원본은 이 세션 동안만 메모리에 둔다.
     localStorage 에는 384px 썸네일만 저장하므로 그걸 키우면 뭉개진다.
     새로고침으로 캐시가 비면 썸네일로 폴백하고, 그때는 확대 배율을 낮춘다. */
  var FULLRES=Object.create(null);
  function bestUrl(rec){ return (rec&&FULLRES[rec.id])||(rec&&rec.u)||''; }

  function pushToGallery(fullUrl){
    var rec={
      id:'cap_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8),
      sid:(window.ArgoDB&&ArgoDB.sid)?ArgoDB.sid():null,
      t:Date.now(), u:'', remote:null
    };
    FULLRES[rec.id]=fullUrl;
    makeThumb(fullUrl,function(thumb){
      rec.u=thumb;
      var list=readGallery();
      list.push(rec);
      if(list.length>GALLERY_MAX) list=list.slice(list.length-GALLERY_MAX);
      list=writeGallery(list);
      renderGallery(list.length-1);
    });
    return rec;
  }
  function markGalleryRemote(id,remote){
    var list=readGallery(),hit=false;
    for(var i=0;i<list.length;i++){ if(list[i].id===id){ list[i].remote=remote; hit=true; break; } }
    if(hit) writeGallery(list);
  }
  function renderGallery(currentIdx){
    if(!booth||!boothStrip)return;
    var list=readGallery();
    /* [FIX] 예전엔 컷이 없으면 booth.hidden=true 로 패널을 통째로 감췄다.
       그러면 갤러리가 차지하던 높이가 사라지면서 왼쪽 안내 칼럼의 하단 정렬이
       한 번에 무너진다(상태 박스가 위로 튄다). 패널은 항상 띄워 두고,
       비었을 때는 자리만 잡는 빈 프레임을 깔아 높이를 그대로 유지한다. */
    booth.hidden = false;
    /* [표시 상한] 이 스트립에만 최신 STRIP_MAX 장을 보여 준다.
       저장소(photo-wall 이 함께 읽는다)와 DB 에는 전부 그대로 남는다. */
    var shown = list.length>STRIP_MAX ? list.slice(list.length-STRIP_MAX) : list;
    var offset = list.length - shown.length;
    booth.classList.toggle('is-empty', shown.length===0);
    if(boothCount) boothCount.textContent=list.length;
    boothStrip.innerHTML='';
    if(shown.length===0){
      for(var e=0;e<5;e++){
        var ph=document.createElement('div');
        ph.className='booth-card booth-card--empty';
        ph.setAttribute('aria-hidden','true');
        ph.innerHTML='<span class="booth-empty-mark">'+String(e+1).padStart(2,'0')+'</span>';
        boothStrip.appendChild(ph);
      }
    }
    shown.forEach(function(item,si){
      var i = si + offset;                 /* 원본 목록 기준 인덱스(삭제·대표지정이 이걸 쓴다) */
      var d=new Date(item.t||Date.now());
      var stamp=window.ArgoDate?ArgoDate.stamp(d.getTime()).slice(-5):'';
      var card=document.createElement('div');
      card.className='booth-card'+(i===currentIdx?' is-current':'');
      card.innerHTML=
        '<img alt="촬영 컷 '+(i+1)+'">'+
        '<span class="rc-noise"></span><span class="rc-sheen"></span><span class="rc-border"></span>'+
        '<span class="rc-meta"><span class="idx">FRAME '+String(i+1).padStart(2,'0')+'</span><span>'+stamp+'</span></span>'+
        '<button class="booth-del" type="button" aria-label="이 컷 삭제">✕</button>';
      card.querySelector('img').src=item.u;
      /* 클릭하면 확대 보기. 대표 지정은 라이트박스 안 버튼으로 옮겼다. */
      card.addEventListener('click',function(e){
        if(e.target.closest('.booth-del'))return;
        openLightbox(item, i, card.querySelector('img'));
      });
      card.querySelector('.booth-del').addEventListener('click',function(e){
        e.stopPropagation();
        var cur=readGallery();
        /* 인덱스가 아니라 id 로 지운다. 렌더 이후 다른 컷이 들어오면(촬영 비동기 저장)
           i 가 밀려서 엉뚱한 컷이 지워진다. */
        var pos=-1;
        for(var k=0;k<cur.length;k++){ if(cur[k].id===item.id){ pos=k; break; } }
        if(pos<0) pos=i;
        var gone=cur.splice(pos,1)[0];
        cur=writeGallery(cur);
        if(gone){ delete FULLRES[gone.id]; syncRepresentative(gone.id,cur); }
        if(lbOpen && lbItem && gone && lbItem.id===gone.id) closeLightbox();
        renderGallery(-1);
      });
      boothStrip.appendChild(card);
    });
    if(currentIdx>=0){
      var el=boothStrip.children[currentIdx];
      if(el&&el.scrollIntoView) el.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
    }
  }
  function showPreview(url){ previewImg.src=url; preview.classList.add('show'); preview.setAttribute('aria-hidden','false'); retakeBtn.hidden=false; shutterBtn.hidden=true; }

  /* 프리뷰를 걷고 라이브 촬영 상태로 되돌린다.
       restartCamera=true  : [다시 촬영] 버튼 — 스트림까지 새로 잡는다(기존 동작 그대로)
       restartCamera=false : 3초 자동 리셋 — doCapture 는 카메라를 끄지 않으므로
                             살아 있는 스트림을 재사용한다. 매번 재시작하면 깜빡인다. */
  function resetToLive(restartCamera){
    clearAutoReset();
    captured=false; capturing=false; poseFirstAt=0; poseHeld=0; capCodes=null;
    setPose('손가락으로 사각 프레임(찰칵 포즈)을 만들어 보세요',false);
    preview.classList.remove('show'); preview.setAttribute('aria-hidden','true');
    fallback.classList.remove('show');
    retakeBtn.hidden=true; shutterBtn.hidden=false; shutterBtn.disabled=false;
    if(poseTxt) poseTxt.textContent='촬영';
    active=true; sizeFx(); if(!rafFx) rafFx=requestAnimationFrame(drawFx);
    if(restartCamera){
      stopCamera();
      startCamera().then(function(ok){ if(ok){ loadHands(); if(handsReady && !pumping) pump(); } });
    } else if(handsReady && !pumping){ pump(); }
    setHud('TRACKING');
  }

  /* 촬영본을 3초간 보여준 뒤 자동으로 프레임을 비운다.
     사진 자체는 doCapture 에서 이미 갤러리에 들어가 있으므로, 여기서는 프레임만 되돌린다. */
  var autoResetT=null;
  function clearAutoReset(){ if(autoResetT){ clearTimeout(autoResetT); autoResetT=null; } }
  function scheduleAutoReset(){
    clearAutoReset();
    autoResetT=setTimeout(function(){ autoResetT=null; resetToLive(false); }, 3000);
  }

  retakeBtn.addEventListener('click',function(){
    /* [추적] 재촬영. candidate_id 를 새로 만들지 않는다 — 같은 사람의 다시 찍기다. */
    try{ if(window.ArgoTrack) ArgoTrack.act('photo_retaken',{page:'webcam',button_id:'scanRetake'}); }catch(e){}
    resetToLive(true);
  });
  /* genome 섹션의 "GENOME 재촬영" 버튼이 호출한다 — 스크롤만 옮기면 촬영 완료 상태가
     그대로 남아 카메라가 꺼진 화면을 보게 되므로, 라이브로 되돌리는 것까지 함께 한다. */
  window.__argoRetakeGenome=function(){
    var sec=document.getElementById('scan-section');
    if(sec){
      var doc=document.documentElement;
      var to=Math.round(sec.getBoundingClientRect().top+(doc.scrollTop||window.scrollY));
      /* 스크롤을 우리가 직접 쓰면(즉시 이동이든 rAF 애니메이션이든) 이 페이지의 휠 스무스
         스크롤 루프와 매 프레임 싸워서 화면이 튄다. 그래서 그 루프와 싸우는 대신 '태워' 준다 —
         루프의 핸들러는 wheel 의 deltaY 를 자기 target 에 더하므로, 필요한 만큼의 deltaY 를
         가진 wheel 이벤트를 한 번 보내면 루프가 스스로 부드럽게 그 위치까지 스크롤한다. */
      var delta=to-(doc.scrollTop||window.scrollY);
      var ev;
      try{ ev=new WheelEvent('wheel',{deltaY:delta,bubbles:true,cancelable:true}); }
      catch(_){ ev=null; }
      if(ev) document.documentElement.dispatchEvent(ev);
      /* 휠 훅이 없는 환경(모바일 등)이나 이벤트가 먹히지 않은 경우에만 직접 이동 */
      setTimeout(function(){
        if(Math.abs((doc.scrollTop||window.scrollY)-to)>innerHeight*0.6) doc.scrollTop=to;
      },520);
    }
    resetToLive(true);
  };
  shutterBtn.addEventListener('click',function(){ startCountdown(); });
  /* [다음으로] — 다음 섹션 상단까지 자동으로 스크롤해서 넘겨준다.
     이 페이지는 wheel 을 가로채는 커스텀 스무스 스크롤을 쓰므로,
     네이티브 scrollIntoView 대신 직접 이징을 돌려 target 과 어긋나지 않게 한다. */
  function smoothScrollTo(destY,dur){
    var startY=window.pageYOffset, delta=destY-startY, t0=null;
    var max=document.documentElement.scrollHeight-innerHeight;
    delta=Math.max(0,Math.min(max,destY))-startY;
    function step(ts){
      if(t0===null)t0=ts;
      var k=Math.min(1,(ts-t0)/dur);
      var e=k<0.5 ? 4*k*k*k : 1-Math.pow(-2*k+2,3)/2;   /* easeInOutCubic */
      window.scrollTo(0,startY+delta*e);
      if(k<1)requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  /* [다음으로] 버튼은 제거됨 — 남아 있는 경우에만 바인딩한다 */
  if(skipBtn) skipBtn.addEventListener('click',function(){
    var next=section.nextElementSibling;
    while(next && next.nodeType!==1) next=next.nextSibling;
    var y = next ? (next.getBoundingClientRect().top+window.pageYOffset)
                 : (section.getBoundingClientRect().bottom+window.pageYOffset);
    smoothScrollTo(y,1100);
  });

  function showFallback(){ fallback.classList.add('show'); setState(null,false); setHud('OFFLINE');
    shutterBtn.disabled=false; setStat('camera','OFFLINE',false); setStat('light','—',false); setStat('face','—',false);
    if(poseTxt) poseTxt.textContent='대체 이미지로 등록'; }
  function startCamera(){
    if(stream) return Promise.resolve(true);
    /* [추적] 카메라 실행은 의미 있는 행동이다 — 여기서 세션이 없으면 생긴다. */
    try{ if(window.ArgoTrack) ArgoTrack.act('camera_started',{page:'webcam'}); }catch(e){}
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      try{ if(window.ArgoTrack) ArgoTrack.error('camera_load_failed','getUserMedia unavailable'); }catch(e){}
      showFallback(); return Promise.resolve(false); }
    setState('생체 스캐너를 초기화하는 중입니다…',true);
    return navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},audio:false})
      .then(function(sm){ stream=sm; video.srcObject=sm; return video.play().catch(function(){}); })
      .then(function(){ setState(null,false); setHud('TRACKING'); shutterBtn.disabled=false;
        setStat('camera','LIVE',true); setStat('light','GOOD',true); return true; })
      .catch(function(err){
        /* 오류 '종류' 만 남긴다 — 전체 스택이나 기기 정보는 저장하지 않는다 */
        try{ if(window.ArgoTrack) ArgoTrack.error(
          (err&&(err.name==='NotAllowedError'||err.name==='SecurityError'))?'camera_permission_denied':'camera_load_failed',
          err&&err.name||''); }catch(e){}
        showFallback(); return false; });
  }
  function stopCamera(){ if(stream){ stream.getTracks().forEach(function(t){t.stop();}); stream=null; video.srcObject=null; } }
  /* [추적] 3분 무활동 종료 시 추적 계층이 스트림을 확실히 끄기 위한 훅. UI 는 건드리지 않는다. */
  try{ window.ArgoScanStop = stopCamera; }catch(e){}

  function loadHands(){
    if(handsScriptLoaded||reduce) return;
    handsScriptLoaded=true; setHud('INIT SCANNER…');
    var s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js'; s.crossOrigin='anonymous';
    var to=setTimeout(function(){ if(!handsReady) setHud('MANUAL MODE'); },9000);
    s.onload=function(){ try{
      if(typeof Hands==='undefined'){ clearTimeout(to); setHud('MANUAL MODE'); return; }
      hands=new Hands({locateFile:function(f){ return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/'+f; }});
      hands.setOptions({maxNumHands:2,modelComplexity:0,minDetectionConfidence:0.6,minTrackingConfidence:0.5});
      hands.onResults(onResults); handsReady=true; clearTimeout(to); setHud('TRACKING'); pump();
    }catch(e){ clearTimeout(to); setHud('MANUAL MODE'); } };
    s.onerror=function(){ clearTimeout(to); setHud('MANUAL MODE'); };
    document.head.appendChild(s);
  }
  function pump(){
    if(!active||!handsReady||!hands){ pumping=false; return; }
    pumping=true;
    if(stream && video.readyState>=2){
      hands.send({image:video}).then(function(){ if(active&&handsReady) rafPump=requestAnimationFrame(pump); else pumping=false; })
                               .catch(function(){ if(active&&handsReady) rafPump=requestAnimationFrame(pump); else pumping=false; });
    } else { rafPump=requestAnimationFrame(pump); }
  }

  var vio=new IntersectionObserver(function(es){ es.forEach(function(en){
    document.documentElement.classList.toggle('sc-zone',en.isIntersecting);
    if(en.isIntersecting){
      if(captured) return;
      active=true; sizeFx(); if(!rafFx) rafFx=requestAnimationFrame(drawFx);
      startCamera().then(function(ok){ if(ok){ loadHands(); if(handsReady && !pumping) pump(); } });
    } else {
      active=false; clearAutoReset();
      if(rafFx){ cancelAnimationFrame(rafFx); rafFx=null; }
      if(rafPump){ cancelAnimationFrame(rafPump); rafPump=null; } pumping=false;
      stopCamera();
    }
  }); },{threshold:0});
  vio.observe(section);

  /* 복원 정책 —
     이전에 찍은 컷은 메인 스테이지(프리뷰)에 다시 띄우지 않는다. 페이지에 들어오면
     스캐너는 항상 라이브 상태로 열려 바로 다시 찍을 수 있고, 지난 컷은 아래 갤러리에만 남는다.
     (게놈 캡슐 이미지는 별개 섹션이라 가장 최근 컷을 그대로 유지) */
  /* 세션 표기 + HUD 날짜(2068 고정) */
  (function stamp(){
    var se=document.getElementById('boothSession');
    if(se){ var sid=(window.ArgoDB&&ArgoDB.sid)?String(ArgoDB.sid()):String(Date.now()); se.textContent=sid.replace(/\D/g,'').slice(-6)||'246730'; }
    var de=document.getElementById('scanHudDate');
    if(de){ de.textContent='SOL-0687 · '+(window.ArgoDate?ArgoDate.dot():'2068.01.01'); }
  })();

  (function restore(){
    try{
      /* STANDALONE 은 genome 쪽 대표 컷을 읽지도 쓰지도 않는다 — 완전히 분리 */
      var saved=STANDALONE ? null : localStorage.getItem(STORE_KEY);
      var seeded=false; try{ seeded=!!localStorage.getItem(SEED_KEY); }catch(e){}
      /* 갤러리가 비어 있는데 대표 컷만 남아 있는 경우가 둘이다.
           1) 갤러리 도입 전 데이터  → 첫 컷으로 승격해 준다
           2) 사용자가 갤러리에서 다 지움 → 승격하면 지운 사진이 되살아난다 (버그)
         SEED_KEY 로 둘을 가른다. 2)면 대표 컷도 같이 정리한다. */
      if(saved && !seeded && readGallery().length===0){
        window.ARGO_CAPTURE=saved; announceCapture(saved);
        var legacyId='cap_legacy_'+Date.now().toString(36);
        makeThumb(saved,function(thumb){
          writeGallery([{
            id:legacyId,
            sid:(window.ArgoDB&&ArgoDB.sid)?ArgoDB.sid():null,
            t:Date.now(), u:thumb, remote:null
          }]);
          try{ localStorage.setItem(REP_KEY,legacyId); }catch(e){}
          renderGallery(-1);
        });
      } else if(saved && seeded && readGallery().length===0){
        clearCapture();
        renderGallery(-1);
      } else {
        if(saved){ window.ARGO_CAPTURE=saved; announceCapture(saved); }
        renderGallery(-1);
      }
    }catch(e){ try{ renderGallery(-1); }catch(e2){} }
  })();
})();

