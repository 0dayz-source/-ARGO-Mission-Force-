/* ============================================================================
   ARGO — Supabase persistence layer  (guestbook messages + webcam captures)
   ----------------------------------------------------------------------------
   정적 사이트에서 방명록 텍스트와 웹캠 사진을 한 곳(Supabase)에 모읍니다.
   · guestbook 테이블  : 방명록 글 (사진 URL 포함)
   · captures  테이블  : 웹캠 촬영 기록
   · captures  Storage : 실제 이미지 파일(JPEG)

   [ 활성화 — 딱 2분 ]
   1) https://supabase.com 에서 무료 프로젝트 생성 (직접 하셔야 합니다).
   2) 프로젝트의 SQL Editor 에 supabase/3-photo-storage.sql 전체를 붙여넣고 RUN.
   3) Settings → API 에서 값 2개를 아래 CONFIG 에 붙여넣기:
        · Project URL      → url
        · anon public key  → anonKey
      (둘 다 클라이언트에 노출돼도 안전한 공개 키입니다. RLS/Storage 정책으로 보호)

   CONFIG 가 비어 있으면 자동으로 localStorage 전용(오프라인) 모드로 조용히 폴백하며,
   콘솔 에러를 내지 않습니다. 값만 채우면 즉시 DB 저장이 켜집니다.
   ============================================================================ */
(function () {
  'use strict';

  var CONFIG = {
    /* [의도적으로 비워 둠 — 채우지 말 것]
       이 레거시 계층은 guestbook / captures / assessment 테이블과 captures Storage 버킷을
       쓴다. 현재 Supabase 프로젝트(argo-exhibition)에는 그 세 테이블도 버킷도 없고,
       만들지 않기로 했다. 값이 비어 있으면 아래 init() 이 configured() 에서 걸려
       SDK 조차 내려받지 않고, 모든 메서드가 네트워크 없이 조용히 null/false 를 돌려준다.
       → 화면의 방명록·사진·시험 동작은 localStorage 로 그대로 유지된다.
       분석·저장은 새 계층(shared/argo-track.js)이 전담한다.
       특히 웹캠 사진은 이 파일의 uploadCapture() 가 유일한 업로드 경로였다 —
       비워 둠으로써 얼굴 이미지가 어떤 서버로도 나가지 않는다. */
    url:     '',
    anonKey: '',
    bucket:  'captures'   // (미사용 — url/anonKey 가 비어 있어 도달하지 않는다)
  };

  var SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  var client = null;
  var readyResolve;
  var whenReady = new Promise(function (res) { readyResolve = res; });

  function configured() { return !!(CONFIG.url && CONFIG.anonKey); }

  /* ---- persistent anonymous session id : 방명록 글 ↔ 웹캠 사진 연결용 ---- */
  function sid() {
    try {
      var k = 'argo_sid', v = localStorage.getItem(k);
      if (!v) {
        v = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).toUpperCase();
        localStorage.setItem(k, v);
      }
      return v;
    } catch (e) { return 'NA'; }
  }

  function loadSdk() {
    return new Promise(function (resolve, reject) {
      if (window.supabase && window.supabase.createClient) return resolve();
      var s = document.createElement('script');
      s.src = SDK_URL; s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('supabase sdk load failed')); };
      document.head.appendChild(s);
    });
  }

  function init() {
    if (!configured()) { readyResolve(false); return; }
    loadSdk().then(function () {
      try {
        client = window.supabase.createClient(CONFIG.url, CONFIG.anonKey);
        readyResolve(true);
      } catch (e) { console.warn('[ArgoDB] init failed, offline fallback:', e); readyResolve(false); }
    }).catch(function (e) {
      console.warn('[ArgoDB] SDK unavailable, offline fallback:', e);
      readyResolve(false);
    });
  }

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(','), mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    var bin = atob(parts[1]), n = bin.length, u8 = new Uint8Array(n);
    while (n--) u8[n] = bin.charCodeAt(n);
    return new Blob([u8], { type: mime });
  }

  /* ---- upload one webcam capture (dataURL) → Storage + captures row ---- */
  function uploadCapture(dataUrl) {
    return whenReady.then(function (ok) {
      if (!ok || !client || !dataUrl) return null;
      var path = sid() + '/' + Date.now() + '.jpg';
      return client.storage.from(CONFIG.bucket)
        .upload(path, dataUrlToBlob(dataUrl), { contentType: 'image/jpeg', upsert: false })
        .then(function (r) {
          if (r.error) throw r.error;
          var pub = client.storage.from(CONFIG.bucket).getPublicUrl(path);
          var url = pub && pub.data ? pub.data.publicUrl : null;
          return client.from('captures').insert({ photo_url: url, session_id: sid() })
            .then(function () { return url; });
        })
        .catch(function (e) { console.warn('[ArgoDB] uploadCapture failed:', e); return null; });
    });
  }

  /* ---- guestbook ---- */
  function addGuestbook(entry) {
    return whenReady.then(function (ok) {
      if (!ok || !client) return false;
      return client.from('guestbook').insert({
        name: entry.name || 'ANONYMOUS',
        msg:  entry.msg,
        time: entry.time,
        photo_url: entry.photo_url || null,
        session_id: sid()
      }).then(function (r) {
        if (r.error) { console.warn('[ArgoDB] addGuestbook error:', r.error); return false; }
        return true;
      }).catch(function (e) { console.warn('[ArgoDB] addGuestbook failed:', e); return false; });
    });
  }

  /* ---- assessment result (테스트 완료 후) ---- */
  function addAssessment(payload) {
    return whenReady.then(function (ok) {
      if (!ok || !client) return false;
      return client.from('assessment').insert({
        verdict:       payload.verdict,
        top_job:       payload.top_job,
        top_job_score: payload.top_job_score,
        total:         payload.total,
        job_scores:    payload.job_scores,
        psych_scores:  payload.psych_scores,
        answers:       payload.answers,
        photo_url:     payload.photo_url || null,
        session_id:    sid()
      }).then(function (r) {
        if (r.error) { console.warn('[ArgoDB] addAssessment error:', r.error); return false; }
        return true;
      }).catch(function (e) { console.warn('[ArgoDB] addAssessment failed:', e); return false; });
    });
  }

  function fetchGuestbook() {
    return whenReady.then(function (ok) {
      if (!ok || !client) return null;
      return client.from('guestbook')
        .select('name,msg,time,photo_url,created_at')
        .order('created_at', { ascending: true })
        .then(function (r) {
          if (r.error) { console.warn('[ArgoDB] fetchGuestbook error:', r.error); return null; }
          return (r.data || []).map(function (d) {
            return { name: d.name, msg: d.msg, time: d.time, photo_url: d.photo_url };
          });
        }).catch(function (e) { console.warn('[ArgoDB] fetchGuestbook failed:', e); return null; });
    });
  }

  window.ArgoDB = {
    whenReady: whenReady,
    configured: configured,
    sid: sid,
    uploadCapture: uploadCapture,
    addGuestbook: addGuestbook,
    fetchGuestbook: fetchGuestbook,
    addAssessment: addAssessment
  };

  init();
})();
