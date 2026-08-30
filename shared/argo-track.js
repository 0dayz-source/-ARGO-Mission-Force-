/* ============================================================================
   ARGO — 익명 이용 세션 · 행동 분석 (Supabase)
   ----------------------------------------------------------------------------
   전시 키오스크용 추적 계층. 기존 UI/씬/기능에 '연결' 만 하고 아무것도 대체하지 않는다.

   [ 설계 원칙 ]
   · 메인은 상시 전시 화면이다 — 로드·자동 모션·hover·mousemove 로는 세션을 만들지 않는다.
     세션은 '의미 있는 행동'(ArgoTrack.act) 이 처음 일어날 때만 생긴다.
   · 개인식별 정보를 저장하지 않는다 — 실명·이메일·얼굴 사진·IP·정밀 기기정보·지문 없음.
     기기 구분은 coarse_device_type(mobile/tablet/desktop) 한 칸뿐이고, QR 결과 페이지에서만 쓴다.
   · DB 저장 실패가 관람 흐름을 막지 않는다 — 모든 전송은 비동기 + 로컬 큐 폴백이고,
     큰 오류창을 띄우지 않는다.
   · Publishable(anon) 키만 브라우저에 둔다. Secret/service_role 키는 절대 여기 넣지 말 것.

   [ 활성화 ]
   1) Supabase 프로젝트 SQL Editor 에 supabase/1-schema.sql 전체를 붙여넣고 RUN.
   2) 아래 CONFIG.supabaseUrl / CONFIG.publishableKey 를 채운다.
      (Settings → API → Project URL / anon public key)
   비어 있으면 전송을 시도하지 않고 큐에만 쌓으며, 콘솔 경고 한 줄 외에 아무 일도 하지 않는다.
   ============================================================================ */
(function (global) {
  'use strict';

  /* ══ 전시 전 시험 운전 스위치 ══════════════════════════════════════════════
     'test' : 지금 찍는 사진과 남는 기록은 전부 '임시' 로 등록된다.
              · 갤러리 사진 레코드에 test:true 가 붙는다
              · 서버 기록(sessions/events)의 kiosk_id 가 'KIOSK-01-TEST' 로 들어간다
                → DB 를 뽑을 때  where kiosk_id not like '%-TEST'  한 줄로 걸러진다
     'live' : 진짜 관람객. 아무 표시도 붙지 않는다.

     ▶ 전시 시작 전에 반드시 'live' 로 바꾸고 python3 src/build.py 를 돌릴 것.
       그때 쌓인 시험용 사진은 브라우저 콘솔에서 ArgoScanClearTest() 로 지운다.
     ═══════════════════════════════════════════════════════════════════════ */
  var MODE = 'test';

  var CONFIG = {
    supabaseUrl:    'https://qscaoyfkvmszyavqffwh.supabase.co',
    publishableKey: 'sb_publishable_0ZDvEEukdO4elBYXAKcDAQ_qIqRuGOY',   // publishable 전용 — secret/service_role 금지
    /* 시험 운전 중에는 키오스크 이름 뒤에 -TEST 가 붙는다. 컬럼을 새로 만들지 않는 이유는
       kiosk_id 가 sessions·events 양쪽과 분석 뷰에 이미 들어가 있어서, 이 한 글자만으로
       모든 시험 기록이 한 번에 걸러지기 때문이다. */
    kioskId:        MODE === 'test' ? 'KIOSK-01-TEST' : 'KIOSK-01',
    appVersion:     '1.0.0',
    /* 무활동 임계값 — 총 이용시간이 아니라 '마지막 의미 있는 행동' 기준이다.
       90초 경고 → 120초 종료. 서버(supabase/1-schema.sql 의
       argo_idle_timeout_seconds)도 같은 120 을 본다. 한쪽만 바꾸면 안 된다. */
    sessionTimeoutMs: 120000,
    sessionWarningMs: 90000
  };

  var SS_KEY  = 'argo_track_session';   /* sessionStorage — 같은 탭에서만 유지된다.
                                           localStorage 를 쓰면 다음 관람객 탭까지 세션이
                                           이어져 '한 사람' 으로 뭉친다. */
  var QV_KEY  = 'argo_qr_visit_id';     /* localStorage  — QR 을 연 휴대폰 식별(그 기기 안에서만) */
  var DB_NAME = 'argo_track', DB_VER = 3;
  var ST_EVENTS = 'events', ST_OPS = 'ops', ST_SESSION = 'sessions', ST_WRITES = 'writes';

  /* ── 유틸 ──────────────────────────────────────────────────────────────── */
  function uuid() {
    try { if (global.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    try {
      var b = new Uint8Array(16); crypto.getRandomValues(b);
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      var h = []; for (var i = 0; i < 16; i++) h.push((b[i] + 0x100).toString(16).slice(1));
      return h.slice(0,4).join('')+'-'+h.slice(4,6).join('')+'-'+h.slice(6,8).join('')+'-'+
             h.slice(8,10).join('')+'-'+h.slice(10,16).join('');
    } catch (e) {}
    /* 최후 폴백 — 충돌 확률은 낮지만 client_event_id 의 unique 제약이 최종 방어선이다 */
    return 'f' + Date.now().toString(16) + Math.random().toString(16).slice(2, 14);
  }
  function nowISO() { return new Date().toISOString(); }
  function configured() { return !!(CONFIG.supabaseUrl && CONFIG.publishableKey); }
  function warn(m, e) { try { console.warn('[ArgoTrack] ' + m, e || ''); } catch (x) {} }

  function ssGet() {
    try { var raw = sessionStorage.getItem(SS_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function ssSet(s) { try { sessionStorage.setItem(SS_KEY, JSON.stringify(s)); } catch (e) {} }
  function ssClear() { try { sessionStorage.removeItem(SS_KEY); } catch (e) {} }

  /* 대략적인 기기 구분 — 이것 이상은 저장하지 않는다(지문 방지) */
  function coarseDevice() {
    var w = Math.min(screen.width || 0, screen.height || 0);
    var touch = ('ontouchstart' in global) || (navigator.maxTouchPoints || 0) > 1;
    if (!touch) return 'desktop';
    if (w >= 768) return 'tablet';
    return 'mobile';
  }
  /* referrer 는 출처 도메인까지만 — 전체 URL 은 개인 열람 이력이 될 수 있다 */
  function coarseReferrer() {
    try { if (!document.referrer) return null; return new URL(document.referrer).origin; }
    catch (e) { return null; }
  }

  /* ── Supabase REST 전송 (SDK 없이 fetch 만) ─────────────────────────────── */
  /* [중요] PostgREST 의 upsert(on_conflict + resolution=ignore-duplicates)는 충돌 검사를 위해
     테이블 SELECT 권한을 요구한다. 이 프로젝트는 프라이버시 때문에 anon 의 SELECT 를 전부
     회수했으므로 upsert 를 쓰면 401(42501 permission denied)이 난다.
     → 평범한 INSERT 를 쓰고, 멱등성은 '중복키(23505)는 이미 저장된 것' 으로 처리한다.
       session_id / client_event_id / result_id / guestbook_id 는 모두 클라이언트가 만든
       고유 키라, 23505 는 곧 '그 행이 이미 서버에 있다' 는 뜻이다.
     FK 위반(23503)은 진짜 오류이므로 그대로 올려 큐를 지우지 않는다. */
  function post(table, rows) {
    if (!configured()) return Promise.reject(new Error('not_configured'));
    return fetch(CONFIG.supabaseUrl + '/rest/v1/' + table, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.publishableKey,
        'Authorization': 'Bearer ' + CONFIG.publishableKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(rows),
      /* [언로드 생존] 세션 종료 직후 페이지가 바로 넘어간다. keepalive 가 없으면
         날아가던 요청이 통째로 잘리고(net::ERR_ABORTED), 실패 핸들러도 문서와 함께
         죽어 재시도 큐에조차 못 들어간다 — 마지막 기록이 영영 사라진다. */
      keepalive: true
    }).then(function (r) {
      if (r.ok) return true;
      if (r.status !== 409) throw new Error('http_' + r.status);
      /* 409 의 종류를 가른다. 본문에서 code 만 읽고 message/details 는 보지 않는다
         (개인정보가 섞일 수 있다 — 로그에도 상태 코드와 code 만 남긴다). */
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (body && body.code === '23505') {
          /* 배치 중 하나만 중복이어도 배치 전체가 실패한다.
             한 건씩 다시 넣어 진짜 중복만 성공 처리하고 나머지는 살린다. */
          if (rows.length <= 1) return true;
          var failed = 0;
          return rows.reduce(function (chain, one) {
            return chain.then(function () {
              return post(table, [one]).catch(function () { failed++; });
            });
          }, Promise.resolve()).then(function () {
            /* 한 건이라도 진짜 실패했으면 큐를 지우지 않는다.
               이미 들어간 행은 다음 시도에서 23505 로 성공 처리되므로 중복이 생기지 않는다. */
            if (failed) throw new Error('http_409_partial');
            return true;
          });
        }
        throw new Error('http_409_' + ((body && body.code) || 'unknown'));
      });
    });
  }

  /* 단건 조회 전용 RPC. assessment_results 에 공개 select 정책을 두지 않으므로
     결과 목록이 통째로 새지 않는다 — 추측 불가한 result_id 가 사실상 접근 토큰이다. */
  function rpc(fn, args) {
    if (!configured()) return Promise.reject(new Error('not_configured'));
    return fetch(CONFIG.supabaseUrl + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'apikey': CONFIG.publishableKey,
        'Authorization': 'Bearer ' + CONFIG.publishableKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args || {}),
      keepalive: true          /* 위 post() 와 같은 이유 — end_session 이 이동에 잘리지 않게 */
    }).then(function (r) { if (!r.ok) throw new Error('http_' + r.status); return r.json(); });
  }

  /* ── 영속 큐 (IndexedDB) ──────────────────────────────────────────────────
     네 개의 스토어를 쓴다. 성격과 전송 순서가 다르기 때문이다.

       sessions : 세션 행 INSERT. 이게 서버에 없으면 events 가 FK 로 계속 튕긴다.
       writes   : assessment_results / guestbook_entries 행 INSERT.
       events   : 행동 이벤트.
       ops      : 세션 상태 변경 RPC(touch/end/flag/record_qr_open).

     flush 순서 : sessions → writes → events → ops.
     events 는 '아직 서버에 없는 세션' 의 것을 건너뛴다 — FK 오류 반복을 구조적으로 없앤다.

     [개인정보] 방명록 원문은 IndexedDB 에만 두고 24시간 뒤 만료 삭제한다.
     IndexedDB 를 못 쓰는 환경에서는 localStorage 로 흘리지 않는다(원문이 남는 것을 막는다). */
  var idb = null, idbFailed = false;
  function openIdb() {
    if (idb) return Promise.resolve(idb);
    if (idbFailed || !global.indexedDB) return Promise.reject(new Error('no_idb'));
    return new Promise(function (res, rej) {
      var rq = indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = function () {
        var d = rq.result;
        if (!d.objectStoreNames.contains(ST_EVENTS))  d.createObjectStore(ST_EVENTS,  { keyPath: 'client_event_id' });
        if (!d.objectStoreNames.contains(ST_OPS))     d.createObjectStore(ST_OPS,     { keyPath: 'op_id' });
        if (!d.objectStoreNames.contains(ST_SESSION)) d.createObjectStore(ST_SESSION, { keyPath: 'session_id' });
        if (!d.objectStoreNames.contains(ST_WRITES))  d.createObjectStore(ST_WRITES,  { keyPath: 'key' });
      };
      rq.onsuccess = function () { idb = rq.result; res(idb); };
      rq.onerror = function () { idbFailed = true; rej(rq.error); };
    });
  }

  /* localStorage 폴백 — 원문이 없는 큐에만 허용한다(방명록 제외). */
  var LS = { events: 'argo_track_queue', ops: 'argo_track_ops', sessions: 'argo_track_sessions' };
  var LS_CAP = { events: 500, ops: 200, sessions: 50 };
  function lsGet(name) { try { return JSON.parse(localStorage.getItem(LS[name]) || '[]'); } catch (e) { return []; } }
  function lsSet(name, a) { try { localStorage.setItem(LS[name], JSON.stringify(a.slice(-LS_CAP[name]))); } catch (e) {} }

  function stPut(name, keyName, row, allowLs) {
    return openIdb().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(name, 'readwrite');
        tx.objectStore(name).put(row);
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error); };
      });
    }).catch(function () {
      if (!allowLs) return;      /* 방명록 원문은 여기로 오지 않는다 */
      var a = lsGet(name);
      if (!a.some(function (x) { return x[keyName] === row[keyName]; })) a.push(row);
      lsSet(name, a);
    });
  }
  function stAll(name, allowLs) {
    return openIdb().then(function (d) {
      return new Promise(function (res, rej) {
        var rq = d.transaction(name, 'readonly').objectStore(name).getAll();
        rq.onsuccess = function () { res(rq.result || []); };
        rq.onerror = function () { rej(rq.error); };
      });
    }).catch(function () { return allowLs ? lsGet(name) : []; });
  }
  function stDel(name, keyName, ids, allowLs) {
    if (!ids || !ids.length) return Promise.resolve();
    return openIdb().then(function (d) {
      return new Promise(function (res) {
        var tx = d.transaction(name, 'readwrite'), os = tx.objectStore(name);
        ids.forEach(function (id) { os.delete(id); });
        tx.oncomplete = res; tx.onerror = res;
      });
    }).catch(function () {
      if (!allowLs) return;
      lsSet(name, lsGet(name).filter(function (x) { return ids.indexOf(x[keyName]) < 0; }));
    });
  }

  /* ── 1) sessions 큐 ─────────────────────────────────────────────────────── */
  var pendingSessions = {};        /* 아직 서버에 없는 session_id — events 게이트에 쓴다 */
  function sessionQueuePut(row) {
    pendingSessions[row.session_id] = 1;
    return stPut(ST_SESSION, 'session_id', row, true);
  }
  function flushSessions() {
    return stAll(ST_SESSION, true).then(function (rows) {
      if (!rows.length) { pendingSessions = {}; return; }
      var next = {};
      rows.forEach(function (r) { next[r.session_id] = 1; });
      pendingSessions = next;
      var batch = rows.slice(0, 20);
      return post('sessions', batch)
        .then(function () {
          batch.forEach(function (r) { delete pendingSessions[r.session_id]; });
          return stDel(ST_SESSION, 'session_id', batch.map(function (r) { return r.session_id; }), true);
        }, function (e) { warn('session flush ' + (e && e.message)); });
    });
  }

  /* ── 2) writes 큐 (assessment_results / guestbook_entries) ──────────────── */
  var GUESTBOOK_TTL = 24 * 60 * 60 * 1000;
  function writePut(table, keyValue, row, ttlMs) {
    var rec = { key: table + ':' + keyValue, table: table, row: row,
                queued_at: Date.now(), expires_at: ttlMs ? Date.now() + ttlMs : null };
    /* guestbook_entries 는 원문을 담으므로 localStorage 폴백을 쓰지 않는다 */
    return stPut(ST_WRITES, 'key', rec, false);
  }
  function flushWrites() {
    return stAll(ST_WRITES, false).then(function (rows) {
      if (!rows.length) return;
      var now = Date.now(), expired = [], live = [];
      rows.forEach(function (r) {
        if (r.expires_at && now > r.expires_at) expired.push(r.key);   /* 원문 완전 삭제 */
        else live.push(r);
      });
      if (expired.length) stDel(ST_WRITES, 'key', expired, false);
      /* 결과를 먼저 보낸다 — 복구 직후 QR 조회가 가능해야 한다 */
      live.sort(function (a, b) { return (a.table === 'assessment_results' ? 0 : 1) - (b.table === 'assessment_results' ? 0 : 1); });
      return live.slice(0, 30).reduce(function (chain, r) {
        return chain.then(function () {
          return post(r.table, [r.row])
            .then(function () { return stDel(ST_WRITES, 'key', [r.key], false); },
                  function () { /* 다음 기회에 — 성공 전까지 보존한다 */ });
        });
      }, Promise.resolve());
    });
  }

  /* ── 3) events 큐 ───────────────────────────────────────────────────────── */
  function queuePut(row) { return stPut(ST_EVENTS, 'client_event_id', row, true); }
  function flushEvents() {
    return stAll(ST_EVENTS, true).then(function (rows) {
      if (!rows.length) return;
      /* 세션 행이 아직 서버에 없으면 그 세션의 이벤트는 보내지 않는다(FK 오류 반복 제거) */
      var ready = rows.filter(function (r) { return !r.session_id || !pendingSessions[r.session_id]; });
      if (!ready.length) return;
      var batch = ready.slice(0, 100);
      return post('events', batch)
        .then(function () {
          return stDel(ST_EVENTS, 'client_event_id', batch.map(function (r) { return r.client_event_id; }), true);
        }, function (e) { warn('event flush ' + (e && e.message)); });
    });
  }

  /* ── 4) ops 큐 (세션 상태 변경 RPC) ──────────────────────────────────────
     예전에는 PATCH /sessions 로 직접 UPDATE 했다. anon 에게 UPDATE 권한이 있어야
     동작하는 구조였고, 그러면 남의 session_id 까지 고칠 수 있었다.
     이제 허용 조건은 서버가 강제하고 클라이언트는 결과만 받는다.

     [중요] RPC 가 false 를 돌려준 것은 '전송 성공' 이지 '작업 완료' 가 아니다.
     함수마다 false 의 뜻이 다르므로 구분해서 삭제한다.
       touch_session   false = 만료/종료된 세션 → 정상 거절, 삭제
       flag_session    false = 종료된 세션이거나 허용 목록 밖 → 정상 거절, 삭제
       end_session     false = 아직 무활동 조건 미달 → 조건 충족까지 재시도
       record_qr_open  false = 해당 결과 행이 아직 없음 → 저장될 때까지 재시도 */
  var OP_RETRY_ON_FALSE = { end_session: 1, record_qr_open: 1 };
  var OP_TTL = 24 * 60 * 60 * 1000;

  function makeOp(fn, args) {
    return { op_id: uuid(), fn: fn, args: args, queued_at: Date.now(),
             expires_at: Date.now() + OP_TTL, attempts: 0, next_try_at: 0 };
  }
  function opBackoff(op) {
    op.attempts = (op.attempts || 0) + 1;
    op.next_try_at = Date.now() + Math.min(60000, 2000 * Math.pow(2, Math.min(op.attempts, 5)));
    return op;
  }
  function opsPut(op) { return stPut(ST_OPS, 'op_id', op, true); }

  /* fn 을 즉시 호출하고, 완료되지 않았으면 큐에 넣어 나중에 재시도한다. */
  function callOp(fn, args) {
    var op = makeOp(fn, args);
    return rpc(fn, args).then(function (v) {
      if (v === false && OP_RETRY_ON_FALSE[fn]) opsPut(opBackoff(op));
      return v;
    }, function () {
      opsPut(opBackoff(op));
      return null;
    });
  }

  /* [이관] 옛 클라이언트(180초·inactivity_3m)가 남긴 op 가 큐에 남아 있으면
     서버는 이제 그 사유의 무활동 조건을 idle >= 120 으로 본다. 이름만 신규로
     바꿔 주면 정상 처리되고, 그대로 두면 조건 불일치로 24시간 내내 재시도한다.
     원본을 지우지 않고 args 만 바꿔 다시 넣는다(= 한 번만 정규화된다). */
  function normalizeLegacyOp(o) {
    if (o && o.fn === 'end_session' && o.args && o.args.p_end_reason === 'inactivity_3m') {
      o.args = { p_session_id: o.args.p_session_id, p_end_reason: 'inactivity_2m' };
      opsPut(o);
    }
    return o;
  }

  function flushOps() {
    return stAll(ST_OPS, true).then(function (ops) {
      if (!ops.length) return;
      ops.forEach(normalizeLegacyOp);
      var now = Date.now(), drop = [], live = [];
      ops.forEach(function (o) {
        if (o.expires_at && now > o.expires_at) drop.push(o.op_id);         /* 영구 반복 방지 */
        else if (o.next_try_at && now < o.next_try_at) return;              /* 재시도 간격 */
        else live.push(o);
      });
      if (drop.length) stDel(ST_OPS, 'op_id', drop, true);
      return live.slice(0, 50).reduce(function (chain, o) {
        return chain.then(function () {
          return rpc(o.fn, o.args).then(function (v) {
            if (v === false && OP_RETRY_ON_FALSE[o.fn]) return opsPut(opBackoff(o));  /* 미완료 — 보존 */
            return stDel(ST_OPS, 'op_id', [o.op_id], true);                           /* 완료/정상 거절 */
          }, function () { return opsPut(opBackoff(o)); });
        });
      }, Promise.resolve());
    });
  }

  /* ── flush : 순서가 곧 정합성이다 ───────────────────────────────────────── */
  var flushing = false;
  function flush() {
    if (flushing || !configured() || !navigator.onLine) return Promise.resolve();
    flushing = true;
    return flushSessions()
      .then(flushWrites)
      .then(flushEvents)
      .then(flushOps)
      .catch(function (e) { warn('flush ' + (e && e.message)); })
      .then(function () { flushing = false; });
  }

  /* ── 페이지 이름 ────────────────────────────────────────────────────────── */
  var currentPage = null;
  function defaultPageName() {
    var f = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (f.indexOf('11-planet') === 0) return 'mars';
    if (f.indexOf('photo-wall') === 0) return 'photo_wall';
    return 'main';
  }

  /* ── 세션 ───────────────────────────────────────────────────────────────── */
  var warnTimer = null, endTimer = null;
  var isQrPage = false;    /* QR 결과 페이지에는 키오스크 3분 초기화를 적용하지 않는다 */
  var qrOpenClientId = null;   /* 이 페이지 로드의 QR 열람 고유 id (재시도 전체가 공유) */

  function session() { return ssGet(); }

  function startSession(entryPage) {
    var s = {
      session_id: uuid(),
      candidate_id: null,
      result_id: null,
      started_at: nowISO(),
      last_activity_at: nowISO(),
      entry_page: entryPage || currentPage || defaultPageName(),
      page_name: currentPage || defaultPageName(),
      page_entered_at: Date.now(),
      flags: []
    };
    ssSet(s);
    track('session_started', { entry_page: s.entry_page });
    /* sessions 행은 upsert — 재전송/중복 호출에도 하나만 남는다 */
    /* [수정] 예전엔 여기서 바로 POST 하고 실패하면 경고만 남겼다 — 오프라인이면 세션 행이
       영영 생기지 않고, 그 세션의 events 는 FK 로 계속 튕겼다.
       이제 큐에 먼저 넣고 flush 가 가장 먼저 보낸다.
       confidence / ambiguity_flags / status / ended_at 은 넣지 않는다 —
       전부 서버 기본값과 RPC 가 정한다(정책의 with check 도 이를 강제한다). */
    sessionQueuePut({
      session_id: s.session_id, kiosk_id: CONFIG.kioskId, app_version: CONFIG.appVersion,
      entry_page: s.entry_page, started_at: s.started_at, last_activity_at: s.last_activity_at
    });
    /* 첫 페이지 진입도 기록한다 — 세션이 없을 땐 page_entered 를 보류했기 때문 */
    track('page_entered', { page: s.page_name, navigation_type: 'direct_access' });
    armTimers();
    return s;
  }

  function armTimers() {
    if (isQrPage) return;
    clearTimeout(warnTimer); clearTimeout(endTimer);
    warnTimer = setTimeout(showWarning, CONFIG.sessionWarningMs);
    endTimer  = setTimeout(function () { endSession('inactivity_2m'); }, CONFIG.sessionTimeoutMs);
  }
  function disarmTimers() { clearTimeout(warnTimer); clearTimeout(endTimer); warnTimer = endTimer = null; }

  /* 세션 유지 전용 — 이미 세션이 있을 때만 last_activity_at 을 갱신한다.
     세션을 새로 만들지는 않는다. 그래서 상시 전시 중의 클릭/키 입력이
     빈 세션을 만들어 내지 않는다. */
  var lastTouch = 0;
  function touch() {
    var s = session(); if (!s) return;
    var t = Date.now();
    if (t - lastTouch < 1000) { armTimers(); hideWarning(); return; }  /* 호출 폭주 방지 */
    lastTouch = t;
    s.last_activity_at = nowISO(); ssSet(s);
    callOp('touch_session', { p_session_id: s.session_id });
    armTimers(); hideWarning();
  }

  /* 의미 있는 행동 — 세션을 만들거나 유지하는 유일한 입구 */
  function act(kind, meta) {
    var s = session();
    if (!s) { s = startSession(); }
    else {
      s.last_activity_at = nowISO(); ssSet(s);
      callOp('touch_session', { p_session_id: s.session_id });   /* 실패해도 흐름을 막지 않는다 */
      armTimers();
    }
    hideWarning();
    if (kind) track(kind, meta);
    flush();
    return s;
  }

  function endSession(reason, opts) {
    var s = session();
    if (!s) { disarmTimers(); hideWarning(); return; }

    /* [120초 정합] 서버는 idle >= 120 일 때만 inactivity_2m 종료를 허용한다.
       setTimeout 은 백그라운드 스로틀·시계 보정 때문에 드물게 120초 전에 발화한다.
       그때 서버 조건을 낮추는 대신, 남은 시간을 다시 계산해 그만큼 뒤에 다시 부른다.
       (경고는 이미 90초에 떠 있고 종료만 미뤄지므로 30초 유지 규칙도 지켜진다.) */
    if (reason === 'inactivity_2m') {
      var idle = Date.now() - new Date(s.last_activity_at).getTime();
      if (idle < CONFIG.sessionTimeoutMs) {
        clearTimeout(endTimer);
        endTimer = setTimeout(function () { endSession('inactivity_2m'); },
                              CONFIG.sessionTimeoutMs - idle);
        return;                       /* 아직 종료하지 않는다 — 화면도 그대로 둔다 */
      }
    }

    disarmTimers(); hideWarning();
    track('session_ended', { end_reason: reason, duration_ms: Date.now() - new Date(s.started_at).getTime() });
    /* 종료는 서버가 한 번만 반영한다(멱등). confidence/flags 는 여기서 건드리지 않는다 —
       flag_session 이 이미 서버 규칙대로 정해 두었다. */
    callOp('end_session', { p_session_id: s.session_id, p_end_reason: reason });
    ssClear();
    /* [마지막 기록 보장] track/callOp 는 IndexedDB 적재도 전송도 비동기다.
       바로 화면을 넘기면 session_ended 와 end_session 이 적재되기 전에 문서가 죽는다.
       flush 가 끝나면 곧장 이동하고, 느리면 1.2초에서 끊는다(전시장 네트워크가
       나빠도 다음 관람객을 기다리게 하지 않는다). 그때 못 나간 것은 IndexedDB 에
       남아 다음 로드의 boot() → flush() 가 이어서 보낸다. */
    var moved = false;
    var go = function () { if (moved) return; moved = true; resetKiosk(opts); };
    setTimeout(go, 1200);
    flush().then(go, go);
  }

  /* 종료 시 초기화 — 사진·시험·후보자 임시 상태, 웹캠, 오버레이, 메인 복귀 */
  function resetKiosk(opts) {
    /* 1) 임시 상태 제거. 방명록 글(전시물)과 QR 방문 id 는 건드리지 않는다.
       갤러리(argoCandidateGallery / argoWebcamGallery)도 전시물이다 —
       CANDIDATE WALL·HALL OF FAME·촬영 기록 스트립이 읽는 누적본이라
       관람객이 바뀌어도 상한(GALLERY_MAX)까지 그대로 쌓아 둔다.
       바뀌는 것은 '이번 관람객의 대표 컷'뿐이다(STORE_KEY + 그 포인터 REP_KEY). */
    try {
      ['argoCandidateCapture', 'argoCandidateCaptureId',
       'argo_assessment_progress', 'argo_candidate_id', 'argo_result_id'
      ].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    } catch (e) {}
    try { delete global.ARGO_CAPTURE; } catch (e) { global.ARGO_CAPTURE = null; }

    /* 2) 웹캠 스트림 중지 — 전용 훅이 있으면 그것을 쓰고, 없으면 video 를 훑는다 */
    try {
      if (typeof global.ArgoScanStop === 'function') global.ArgoScanStop();
      Array.prototype.forEach.call(document.querySelectorAll('video'), function (v) {
        var st = v.srcObject;
        if (st && st.getTracks) { st.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); v.srcObject = null; }
      });
    } catch (e) {}

    /* 3) 오버레이 닫기 — 기존 API 만 호출하고 DOM 을 직접 뜯지 않는다 */
    try { if (global.ArgoOperator && ArgoOperator.close) ArgoOperator.close(); } catch (e) {}
    try {
      Array.prototype.forEach.call(document.querySelectorAll('.is-open[data-argo-overlay]'), function (el) {
        el.classList.remove('is-open');
      });
    } catch (e) {}

    /* 4) 메인으로 복귀 — 씬만 되돌리는 게 아니라 문서를 다시 읽는다.
       goScene(0) 은 3D·오버레이·폼에 남은 이전 관람객 상태를 전부 지우지 못한다.
       재로딩 시점에는 ssClear() 가 이미 끝나 있어(위 endSession 참고) 새 문서에는
       세션이 없다 → 아무도 안 만진 화면에서는 타이머 자체가 안 걸리므로
       경고가 다시 뜨지 않는다. */
    /* navigate:false — 이미 메인 화면에 서 있는 경우다(스스로 돌아온 관람객).
       상태만 정리하고 화면은 건드리지 않는다. 여기서 재로딩하면 그냥 메인을
       한 번 들렀을 뿐인 사람의 화면이 통째로 날아간다. */
    if (opts && opts.navigate === false) return;
    try {
      if (defaultPageName() === 'main') location.reload();
      else location.href = 'index.html';
    } catch (e) {}
  }

  /* ── 경고 오버레이 ────────────────────────────────────────────────────────
     화면은 shared/argo-warn.js(ArgoWarn)가 그린다. 여기서는 '언제 띄우고 언제 닫나'
     와 '연장은 기존 활동 경로로' 만 정한다. 종료 판정은 아래 endTimer 하나뿐이다. */
  var warnEl = null, warnTick = null;
  var warnShown = false;      /* session_warning_shown 은 경고 1회당 정확히 한 번 */
  function showWarning() {
    if (isQrPage || !session()) return;
    if (warnShown) return;                    /* 중복 렌더·중복 이벤트 방지 */
    warnShown = true;
    track('session_warning_shown', {});
    if (global.ArgoWarn) {
      global.ArgoWarn.show({
        ms: CONFIG.sessionTimeoutMs - CONFIG.sessionWarningMs,
        /* [기존 후보자] 화면 클릭 — 새 경로를 만들지 않는다. 기존 touch() 하나로 간다.
           touch() 는 세션이 살아 있을 때만 동작하므로(종료 뒤엔 session()===null)
           종료 직후의 지연 터치가 세션을 부활시키지 못한다. */
        onKeep: function () { touch(); },
        /* [새 관람객] 하단 버튼 — 남은 30초를 기다리지 않고 지금 끊는다.
           사유는 'manual' 이다. 서버는 manual 에 무활동 조건을 걸지 않으므로
           idle 이 120초 미만이어도 정상 종료된다(inactivity_2m 은 걸린다).
           그 뒤는 기존 종료 경로 그대로 — 대표 사진·Genome·시험 상태만 초기화되고
           누적 사진과 방명록은 남는다. */
        onNew: function () { endSession('manual'); }
      });
      return;
    }
    /* [안내 주체] 메인에는 OPERATOR·07 챗이 있다 — 좌하단 알약 대신
       화면 중앙에서 말로 안내한다. 남은 시간 표시만 넘기고 종료 판단은
       여기(endTimer) 하나가 계속 쥔다 — 타이머를 둘로 나누면 어긋난다.
       오퍼레이터가 없는 페이지(photo-wall 등)는 기존 알약으로 떨어진다. */
    if (global.ArgoOperator && global.ArgoOperator.idle) {
      global.ArgoOperator.idle({
        seconds: (CONFIG.sessionTimeoutMs - CONFIG.sessionWarningMs) / 1000,
        onCancel: touch                 /* '계속 보기' — 세션 연장 + 안내 닫기 */
      });
      return;
    }
    if (!warnEl) {
      warnEl = document.createElement('div');
      warnEl.className = 'argo-track-warn';
      warnEl.setAttribute('role', 'status');
      warnEl.setAttribute('aria-live', 'polite');
      warnEl.innerHTML = '<i class="atw-dot" aria-hidden="true"></i>' +
                         '<span class="atw-txt">SESSION LINK UNSTABLE — <b class="atw-n">30</b> SEC</span>';
      document.body.appendChild(warnEl);
    }
    warnEl.classList.add('is-on');
    var left = Math.round((CONFIG.sessionTimeoutMs - CONFIG.sessionWarningMs) / 1000);
    var n = warnEl.querySelector('.atw-n'); if (n) n.textContent = left;
    clearInterval(warnTick);
    warnTick = setInterval(function () {
      left--; if (n) n.textContent = left > 0 ? left : 0;
      if (left <= 0) clearInterval(warnTick);
    }, 1000);
  }
  function hideWarning() {
    warnShown = false;
    clearInterval(warnTick);
    if (warnEl) warnEl.classList.remove('is-on');
    try { if (global.ArgoWarn) global.ArgoWarn.hide(); } catch (e) {}
  }

  /* ── 이벤트 ─────────────────────────────────────────────────────────────── */
  var lastFire = {};   /* 중복 리스너·연타로 같은 이벤트가 겹쳐 들어오는 것만 막는다 */
  var DEDUP_MS = 300;  /* 정상적인 반복 행동(문항 재선택 등)은 이 창을 넘으므로 살아남는다 */

  function track(eventName, metadata) {
    var s = session();
    var key = eventName + '|' + ((metadata && (metadata.button_id || metadata.question_id || metadata.page)) || '');
    var t = Date.now();
    if (lastFire[key] && t - lastFire[key] < DEDUP_MS) return null;
    lastFire[key] = t;

    var row = {
      client_event_id: uuid(),
      session_id:   s ? s.session_id : null,
      candidate_id: s ? s.candidate_id : null,
      result_id:    s ? s.result_id : null,
      kiosk_id:     CONFIG.kioskId,
      app_version:  CONFIG.appVersion,
      event_name:   eventName,
      page_name:    (metadata && metadata.page) || currentPage || defaultPageName(),
      metadata:     metadata || {},
      queued_at:    nowISO()
    };
    queuePut(row).then(flush);
    return row.client_event_id;
  }

  /* ── 페이지/씬 체류시간 ─────────────────────────────────────────────────── */
  function setPage(name, navType) {
    if (name === currentPage) return;
    var prev = currentPage, s = session();
    if (s && prev) {
      var ms = Date.now() - (s.page_entered_at || Date.now());
      track('page_exited', { page: prev, from_page: prev, to_page: name, duration_ms: ms });
    }
    currentPage = name;
    if (s) {
      s.page_name = name; s.page_entered_at = Date.now(); ssSet(s);
      track('page_entered', { page: name, from_page: prev, to_page: name,
                              navigation_type: navType || 'normal_next' });
      /* [관람 종료로 본다] 스스로 메인 전시 화면으로 돌아왔다 = 볼 것을 다 봤다.
         여기서 세션을 닫으면 그 뒤로는 타이머가 없어 경고가 뜨지 않고,
         다음 의미 있는 행동이 새 관람객의 새 session_id 를 만든다.
         [주의] setPage 는 씬 전환에서만 불린다 — 새로고침은 boot() 가 처리하므로
         '메인에서 새로고침하면 세션이 죽는다' 가 되지 않는다(120초 유지 규칙 유지). */
      if (name === 'main') endSession('navigated_away', { navigate: false });
    }
  }

  /* 하드 페이지 이동 보완 — 이전 페이지의 page_exited 를 다음 로드에서 채운다.
     탭 강제 종료로 이것마저 못 남기면, 분석 시 '마지막 의미 있는 이벤트' 를 종료 기준으로 쓴다. */
  function repairPendingExit() {
    var s = session(); if (!s || !s.page_entered_at || !s.page_name) return;
    if (s.page_name === defaultPageName()) return;      /* 같은 페이지 새로고침 — 이어서 센다 */
    track('page_exited', {
      page: s.page_name, from_page: s.page_name, to_page: defaultPageName(),
      duration_ms: Date.now() - s.page_entered_at, repaired: true
    });
  }

  /* ── 세션 신뢰도 ────────────────────────────────────────────────────────── */
  function flag(name, detail) {
    var s = session(); if (!s) return;
    s.flags = s.flags || [];
    if (s.flags.some(function (f) { return f.flag === name; })) return;
    s.flags.push({ flag: name, at: nowISO(), detail: detail || null });
    ssSet(s);
    /* 새 사람으로 쪼개지 않는다 — 플래그만 붙이고 세션은 그대로 이어 간다.
       허용 플래그 목록과 confidence 규칙은 서버(flag_session)에 있다. */
    callOp('flag_session', { p_session_id: s.session_id, p_flag: name });
  }

  /* ── 후보자 / 결과 ──────────────────────────────────────────────────────── */
  function ensureCandidate() {
    var s = act(null);
    if (s.candidate_id) return s.candidate_id;        /* 재촬영은 같은 candidate_id 를 유지한다 */
    s.candidate_id = uuid(); ssSet(s);
    try { localStorage.setItem('argo_candidate_id', s.candidate_id); } catch (e) {}
    return s.candidate_id;
  }
  function saveResult(payload) {
    var s = act(null);
    if (s.result_id) flag('multiple_results', 'result created twice in one session');
    s.result_id = uuid(); ssSet(s);
    try { localStorage.setItem('argo_result_id', s.result_id); } catch (e) {}
    var row = {
      result_id: s.result_id, session_id: s.session_id, candidate_id: s.candidate_id,
      assigned_role: (payload && payload.assigned_role) || null,
      scores: (payload && payload.scores) || {},
      completed_at: nowISO()
    };
    /* 성공할 때까지 보존한다(만료 없음) — 결과가 없으면 QR 조회가 불가능하다.
       result_id 가 고유 재전송 키다. */
    writePut('assessment_results', row.result_id, row, null);
    flush();
    return s.result_id;
  }

  /* ── 방명록 ─────────────────────────────────────────────────────────────── */
  /* 원문(message)을 그대로 보존한다. 분류는 Edge Function 이 나중에 채우고,
     AI 설정이 없어도 저장은 정상 완료되며 classification_status 는 pending 으로 남는다. */
  function saveGuestbook(message) {
    var s = act(null);
    var row = {
      guestbook_id: uuid(), session_id: s.session_id, result_id: s.result_id,
      message: message, submitted_at: nowISO(),
      classification_status: 'pending', classification_version: null, manual_reviewed: false
    };
    /* 원문은 IndexedDB 큐에만 두고 24시간 뒤 만료 삭제한다(localStorage 로 흘리지 않는다).
       저장에 성공하면 즉시 삭제된다. guestbook_id 가 고유 재전송 키다. */
    return writePut('guestbook_entries', row.guestbook_id, row, GUESTBOOK_TTL).then(function () {
      return flush();
    });
  }

  /* ── QR 결과 페이지 ─────────────────────────────────────────────────────── */
  function qrVisitId() {
    try {
      var v = localStorage.getItem(QV_KEY);
      if (!v) { v = uuid(); localStorage.setItem(QV_KEY, v); }
      return v;
    } catch (e) { return uuid(); }
  }
  function initQr(resultId) {
    isQrPage = true; disarmTimers();      /* 키오스크 3분 초기화 미적용 */
    var visit = qrVisitId();
    /* [보안] 클라이언트는 session_id 를 알지 못한다.
       get_result 는 더 이상 session_id 를 돌려주지 않고, original_session_id 는
       서버(record_qr_open)가 result_id 로 직접 찾아 채운다.
       QR 을 연 사람이 시험을 본 본인이라고 단정하지 않는다 — 연결은 '결과' 기준일 뿐이다. */
    /* [멱등] 이 페이지 로드에 대한 고유 id 를 한 번만 만든다.
       같은 로드의 모든 재시도는 이 값을 그대로 쓰므로 서버에서 1행으로 수렴한다
       (unique + ON CONFLICT DO NOTHING). 진짜 재방문은 새 로드 = 새 id = 새 행이다. */
    if (!qrOpenClientId) qrOpenClientId = uuid();
    callOp('record_qr_open', {
      p_result_id: resultId, p_qr_visit_id: visit,
      p_coarse_device_type: coarseDevice(), p_referrer: coarseReferrer(),
      p_client_qr_open_id: qrOpenClientId
    });
    rpc('get_result', { p_result_id: resultId })
      .then(function (rows) {
        var r = rows && rows[0];
        if (!r) throw new Error('not_found');
        api.onQrResult && api.onQrResult(r);
      })
      .catch(function (e) {
        track('technical_error', { error_type: 'qr_result_load_failed', error_message: String(e && e.message).slice(0, 120) });
      });
  }

  /* ── 부팅 ───────────────────────────────────────────────────────────────── */
  var api = {
    /* 설정 */
    config: CONFIG,
    configured: configured,
    isTest: function () { return MODE === 'test'; },   /* 시험 운전 중인가 — 사진 레코드가 본다 */
    /* 핵심 */
    act: act,                  /* 의미 있는 행동 — 세션 생성/유지의 유일한 입구 */
    track: track,              /* trackEvent(eventName, metadata) */
    trackEvent: track,
    setPage: setPage,
    flag: flag,
    /* 상태 */
    session: session,
    sessionId: function () { var s = session(); return s ? s.session_id : null; },
    candidateId: function () { var s = session(); return s ? s.candidate_id : null; },
    resultId: function () { var s = session(); return s ? s.result_id : null; },
    ensureCandidate: ensureCandidate,
    saveResult: saveResult,
    saveGuestbook: saveGuestbook,
    /* 오류 */
    error: function (type, msg) {
      track('technical_error', { error_type: type, error_message: String(msg || '').slice(0, 120) });
    },
    /* QR */
    initQr: initQr,
    qrVisitId: qrVisitId,
    onQrResult: null,          /* 결과 페이지가 여기에 렌더 콜백을 붙인다 */
    /* 종료(수동) */
    endSession: endSession,
    flush: flush,
    touch: touch
  };
  global.ArgoTrack = api;

  function boot() {
    currentPage = defaultPageName();

    var qp = null;
    try { qp = new URLSearchParams(location.search).get('result'); } catch (e) {}
    if (qp) { initQr(qp); return; }     /* QR 결과 페이지는 키오스크 로직을 타지 않는다 */

    var s = session();
    if (s) {
      /* 120초 이내면 기존 세션을 유지한다 — 새로고침·하드 페이지 이동 모두 여기로 온다 */
      var idle = Date.now() - new Date(s.last_activity_at).getTime();
      if (idle >= CONFIG.sessionTimeoutMs) { endSession('inactivity_2m'); }
      else {
        repairPendingExit();
        s.page_name = currentPage; s.page_entered_at = Date.now(); ssSet(s);
        track('page_entered', { page: currentPage, navigation_type: 'normal_next' });
        armTimers();
      }
    }
    /* 세션이 없으면 아무것도 만들지 않는다 — 메인은 상시 전시 화면이다. */

    /* 하드 이동/탭 종료 직전 : 마지막 page_exited 를 남길 기회 */
    global.addEventListener('pagehide', function () {
      var cur = session(); if (!cur) return;
      track('page_exited', { page: currentPage, duration_ms: Date.now() - (cur.page_entered_at || Date.now()) });
    });
    /* 의미 있는 입력만 세션을 '유지' 시킨다.
       mousemove·hover·scroll·wheel 은 일부러 뺐다 — 자동 모션과 지나가는 사람의
       마우스만으로 세션이 3분마다 무한 연장되면 안 된다. */
    ['click', 'pointerdown', 'keydown', 'input', 'change'].forEach(function (t) {
      document.addEventListener(t, function (e) {
        /* 실제 조작 대상이 있는 이벤트만 — 배경 클릭도 조작으로 본다(키오스크라 오작동이 적다) */
        if (e && e.isTrusted === false) return;
        /* [경고 오버레이는 건너뛴다] 이 리스너는 캡처 단계라 오버레이 자신의 핸들러보다
           먼저 돈다. 여기서 touch() 를 부르면 '새 후보자로 시작' 을 누른 순간
           세션이 연장되고 hideWarning() 이 ArgoWarn 의 onNew 콜백을 지워 버려,
           정작 버튼 핸들러가 돌 때는 콜백이 null 이라 아무 일도 일어나지 않는다
           (버튼이 먹통이 되고 화면도 그대로 남는 증상의 원인).
           오버레이 안쪽은 ArgoWarn 이 이미 두 갈래로 나눠 처리한다 —
           화면 클릭 → onKeep → touch(), 버튼 → onNew → endSession('manual'). */
        if (e.target && e.target.closest && e.target.closest('#argo-session-warn')) return;
        touch();
      }, true);
    });
    global.addEventListener('online', flush);
    flush();
    if (!configured()) warn('CONFIG 미설정 — 이벤트는 로컬 큐에만 쌓입니다(관람 흐름에는 영향 없음).');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window);
