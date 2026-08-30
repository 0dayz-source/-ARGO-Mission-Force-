-- ============================================================================
-- ARGO — 익명 이용 세션 · 행동 분석 : 스키마 + RLS + RPC
-- ----------------------------------------------------------------------------
-- 신규 Supabase 프로젝트의 SQL Editor 에 이 파일 하나를 통째로 붙여넣고 RUN.
-- 재실행해도 안전하다(모든 DDL 이 if not exists / or replace / drop-then-create).
--
-- 기존 argo-db.setup.sql(guestbook / captures / assessment) 은 건드리지 않는다.
--
-- [ 보안 모델 ]
--   브라우저에는 publishable(anon) 키만 있다. 인증이 없으므로 "자기 행" 을 증명할 수단이
--   없다 → anon 에게 UPDATE 를 직접 주면 남의 세션까지 고칠 수 있다.
--   그래서 상태 변경은 전부 SECURITY DEFINER RPC 로만 하고, 허용 조건은 서버가 강제한다.
--     · anon 직접 권한 : sessions/events/assessment_results/guestbook_entries INSERT 뿐
--     · UPDATE 경로   : touch_session / end_session / flag_session
--     · QR 기록       : record_qr_open  (qr_opens 직접 INSERT 는 막혀 있다)
--     · 결과 조회     : get_result      (session_id 를 반환하지 않는다)
--
-- [ 개인정보 ] 실명·이메일·얼굴 사진·IP·정밀 기기정보·브라우저 지문 컬럼이 없다.
--              기기 구분은 qr_opens.coarse_device_type(mobile/tablet/desktop) 뿐이다.
-- [ 키 ]       service_role 키는 절대 프론트/깃허브에 넣지 말 것 — 아래 정책이 전부 무의미해진다.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ════════════════════════════════════════════════════════════════════════════
-- 1. 테이블
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.sessions (
  session_id        uuid primary key,
  kiosk_id          text        not null default 'KIOSK-01',
  app_version       text        not null default '1.0.0',
  entry_page        text,
  started_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now(),
  ended_at          timestamptz,
  end_reason        text,
  -- active | ended. 종료 판정을 ended_at 하나에만 의존하지 않게 상태를 따로 둔다.
  status            text        not null default 'active',
  -- high | medium | ambiguous. 서버 규칙으로만 바뀐다(flag_session).
  confidence        text        not null default 'high',
  ambiguity_flags   jsonb       not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  constraint sessions_status_chk     check (status in ('active','ended')),
  constraint sessions_confidence_chk check (confidence in ('high','medium','ambiguous'))
);
-- 기존 프로젝트에 이미 테이블이 있으면 status 만 보강한다.
alter table public.sessions add column if not exists status text not null default 'active';
create index if not exists sessions_started_idx on public.sessions (started_at desc);
create index if not exists sessions_kiosk_idx   on public.sessions (kiosk_id, app_version);

create table if not exists public.events (
  event_id        bigint generated always as identity primary key,
  -- 오프라인 큐 재전송이 중복 INSERT 가 되지 않게 하는 유일한 방어선.
  client_event_id uuid        not null unique,
  session_id      uuid        references public.sessions(session_id) on delete set null,
  candidate_id    uuid,
  result_id       uuid,
  kiosk_id        text        not null default 'KIOSK-01',
  app_version     text        not null default '1.0.0',
  event_name      text        not null,
  page_name       text,
  metadata        jsonb       not null default '{}'::jsonb,
  queued_at       timestamptz,          -- 기기에서 발생한 시각(오프라인이면 전송보다 이르다)
  created_at      timestamptz not null default now()
);
create index if not exists events_session_idx on public.events (session_id, queued_at);
create index if not exists events_name_idx    on public.events (event_name, created_at desc);
create index if not exists events_result_idx  on public.events (result_id);

create table if not exists public.assessment_results (
  result_id     uuid primary key,
  session_id    uuid references public.sessions(session_id) on delete set null,
  candidate_id  uuid,                          -- 사진 없이 시험만 본 경우 null 허용
  assigned_role text,
  scores        jsonb not null default '{}'::jsonb,
  completed_at  timestamptz not null default now()
);
create index if not exists assessment_session_idx on public.assessment_results (session_id);

-- message 는 원문 그대로 보존한다. AI 분류 결과가 원문을 덮어쓰지 않도록 컬럼을 분리했다.
create table if not exists public.guestbook_entries (
  guestbook_id              uuid primary key,
  session_id                uuid references public.sessions(session_id) on delete set null,
  result_id                 uuid,
  message                   text        not null,
  submitted_at              timestamptz not null default now(),
  primary_category          text,
  secondary_categories      jsonb       not null default '[]'::jsonb,
  sentiment                 text,
  keywords                  jsonb       not null default '[]'::jsonb,
  classification_confidence numeric,
  classification_version    text,
  -- AI 설정이 없어도 저장은 정상 완료되고 여기에 pending 으로 남는다.
  classification_status     text        not null default 'pending',
  manual_reviewed           boolean     not null default false,
  constraint gb_status_chk  check (classification_status in ('pending','completed','failed')),
  constraint gb_primary_chk check (primary_category is null or primary_category in
    ('EXHIBITION_EXPERIENCE','MARS_OPINION','DESIGN_INTERACTION','EMOTIONAL_REACTION','SUGGESTION','OTHER'))
);
create index if not exists gb_status_idx  on public.guestbook_entries (classification_status);
create index if not exists gb_session_idx on public.guestbook_entries (session_id);

-- qr_visit_id 는 QR 을 연 '기기' 안에서만 유지되는 값이다.
-- 이 사람이 시험을 본 본인이라는 근거가 아니다 — original_session_id 와 동일인으로 보지 말 것.
-- original_session_id 는 클라이언트가 아니라 서버(record_qr_open)가 채운다.
create table if not exists public.qr_opens (
  qr_open_id          uuid primary key default gen_random_uuid(),
  -- QR 페이지 '한 번의 로드' 를 가리키는 고유 id. 그 로드의 모든 재시도가 같은 값을 보내므로
  -- unique + ON CONFLICT DO NOTHING 으로 정확히 1행이 된다.
  -- 진짜 재방문은 새 로드 = 새 id = 새 행이라 재방문 집계가 망가지지 않는다.
  client_qr_open_id   uuid not null unique,
  result_id           uuid not null,
  original_session_id uuid,
  qr_visit_id         uuid not null,
  opened_at           timestamptz not null default now(),
  coarse_device_type  text,
  referrer            text,                    -- 출처 도메인까지만(전체 URL 아님)
  constraint qr_device_chk check (coarse_device_type is null or coarse_device_type in ('mobile','tablet','desktop'))
);
-- 기존 프로젝트 보강용(신규 프로젝트에서는 위 create table 이 이미 만든다)
alter table public.qr_opens add column if not exists client_qr_open_id uuid;
create unique index if not exists qr_client_uidx on public.qr_opens (client_qr_open_id);
create index if not exists qr_result_idx on public.qr_opens (result_id);
create index if not exists qr_visit_idx  on public.qr_opens (qr_visit_id, result_id, opened_at desc);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. RLS — 전부 활성화. anon 에게는 INSERT 만 남긴다.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.sessions           enable row level security;
alter table public.events             enable row level security;
alter table public.assessment_results enable row level security;
alter table public.guestbook_entries  enable row level security;
alter table public.qr_opens           enable row level security;

-- ── 테이블 권한 : Supabase 기본 GRANT 에 의존하지 않는다 ────────────────────
--    Supabase 는 public 스키마의 새 테이블에 anon/authenticated SELECT 등을 기본 부여한다.
--    필요한 것만 남기려면 '먼저 전부 회수하고 필요한 것만 다시 준다'.
--    RLS 는 GRANT 위에서 한 겹 더 거르는 것이므로 둘을 함께 구성한다.
revoke all on public.sessions           from anon, authenticated;
revoke all on public.events             from anon, authenticated;
revoke all on public.assessment_results from anon, authenticated;
revoke all on public.guestbook_entries  from anon, authenticated;
revoke all on public.qr_opens           from anon, authenticated;

--    anon 이 직접 하는 일은 INSERT 네 가지뿐이다.
grant insert on public.sessions           to anon;
grant insert on public.events             to anon;
grant insert on public.assessment_results to anon;
grant insert on public.guestbook_entries  to anon;

--    qr_opens : 직접 권한을 하나도 주지 않는다. record_qr_open(SECURITY DEFINER)만 쓴다.
--               클라이언트가 original_session_id 를 직접 넣지 못하게 하는 것이 목적이다.
--    authenticated : 이 프로젝트는 로그인 기능이 없다 — 테이블 직접 권한을 주지 않는다.
--    events.event_id 는 GENERATED ALWAYS AS IDENTITY 다. identity 시퀀스는 내부적으로
--    소유자 권한으로 진행되므로 anon 에게 시퀀스 USAGE 를 따로 줄 필요가 없다.

-- ── 예전 정책 정리 ──────────────────────────────────────────────────────────
drop policy if exists sessions_anon_update on public.sessions;
drop policy if exists qr_opens_anon_insert on public.qr_opens;

-- ── INSERT 정책 ─────────────────────────────────────────────────────────────
--    sessions : 최초 INSERT 를 '깨끗한 활성 세션' 으로만 제한한다.
--    클라이언트가 처음부터 confidence 나 ambiguity_flags 를 심을 수 없다 —
--    이후 두 값은 flag_session 만 바꾼다.
drop policy if exists sessions_anon_insert on public.sessions;
create policy sessions_anon_insert on public.sessions
  for insert to anon
  with check (
        status          = 'active'
    and ended_at        is null
    and end_reason      is null
    and confidence      = 'high'
    and ambiguity_flags = '[]'::jsonb
  );

drop policy if exists events_anon_insert on public.events;
create policy events_anon_insert on public.events
  for insert to anon with check (true);

--    assessment_results / guestbook_entries : SELECT 정책은 만들지 않는다.
--    RLS 가 켜져 있고 SELECT 정책이 없으면 anon 은 한 행도 못 읽는다.
--    결과 개별 조회는 get_result RPC 로만 가능하다.
drop policy if exists assessment_anon_insert on public.assessment_results;
create policy assessment_anon_insert on public.assessment_results
  for insert to anon with check (true);

drop policy if exists guestbook_entries_anon_insert on public.guestbook_entries;
create policy guestbook_entries_anon_insert on public.guestbook_entries
  for insert to anon with check (true);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. RPC — 허용된 상태 변경만 서버가 수행한다.
--    공통 규칙 : security definer + search_path 고정 + schema-qualified 이름 +
--                동적 SQL 없음. 권한은 함수마다 아래 4절에서 따로 준다.
-- ════════════════════════════════════════════════════════════════════════════

-- 무활동 판정 기준(초) — 정확히 120. 프론트 CONFIG.sessionTimeoutMs 와 같은 값이다.
-- 두 함수가 이 상수 하나만 보게 해서 기준이 갈라지지 않게 한다.
--   touch_session : idle < 120  → 허용
--   end_session   : idle >= 120 → inactivity_2m 허용
-- 정확히 120.0 인 순간 touch 는 거절되고 종료는 허용된다(빈틈도 겹침도 없다).
-- 브라우저 타이머가 120초 전에 발화해도 서버 조건을 낮추지 않는다 —
-- 클라이언트가 남은 시간을 다시 계산해 120초 이후에 다시 호출한다(shared/argo-track.js).
-- (경고는 90초에 뜬다 — 표시 시점이라 서버 조건과 무관하다.)
create or replace function public.argo_idle_timeout_seconds()
returns integer language sql immutable as $$ select 120 $$;

-- ── touch_session : 활동 갱신. last_activity_at 하나만 건드린다. ────────────
--    · ended_at is null 이고 status='active' 인 세션만
--    · idle 이 120초에 도달한 세션은 되살리지 않는다(지연 도착한 touch 방어)
--    · 갱신 성공 여부를 boolean 으로 돌려준다(false = 무시됨)
create or replace function public.touch_session(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_hit integer;
begin
  if p_session_id is null then
    return false;
  end if;

  update public.sessions
     set last_activity_at = now()          -- 서버 시계만 신뢰한다
   where session_id = p_session_id
     and ended_at is null
     and status = 'active'
     -- idle < 120 초일 때만 갱신한다. 120 에 도달하면 여기서 걸려 되살아나지 않는다.
     and last_activity_at > now() - make_interval(secs => public.argo_idle_timeout_seconds());

  get diagnostics v_hit = row_count;
  return v_hit > 0;
end;
$$;

-- ── end_session : 한 번만 종료. ended_at / status / end_reason 만 바꾼다. ───
--    · inactivity_2m 은 서버 기준 무활동이 120초 이상일 때만 허용
--      (구 클라이언트가 보내는 inactivity_3m 도 같은 조건으로 받아 준다 — 이름만 옛것이다)
--    · 그 밖의 사유(수동 종료 등)는 무활동 조건 없이 허용
--    · 이미 종료된 세션에 다시 호출하면 아무것도 바꾸지 않고 true 를 돌려준다(완전 멱등)
--    · 존재하지 않는 세션은 false — 세션 INSERT 가 늦게 도착할 수 있으므로 재시도 대상이다
create or replace function public.end_session(p_session_id uuid, p_end_reason text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_hit    integer;
  v_reason text;
begin
  if p_session_id is null then
    return false;
  end if;

  -- [멱등] 이미 종료된 세션이면 아무것도 바꾸지 않고 true 를 돌려준다.
  -- 클라이언트 큐가 '완료' 로 보고 op 를 지울 수 있어야 하기 때문이다.
  -- (존재하지 않는 세션은 false — 세션 INSERT 가 아직 안 올라온 상태이므로 재시도해야 한다.)
  if exists (select 1 from public.sessions
             where session_id = p_session_id and ended_at is not null) then
    return true;
  end if;

  -- 사유는 서버가 아는 값으로만 정규화한다(임의 문자열 주입 방지).
  v_reason := case
                -- inactivity_3m 은 구 클라이언트 호환용으로만 받는다. 저장은 신규 이름으로.
                when p_end_reason in ('inactivity_2m','inactivity_3m') then 'inactivity_2m'
                when p_end_reason in ('manual','navigated_away')       then p_end_reason
                else 'unspecified'
              end;

  update public.sessions
     set ended_at   = now(),
         status     = 'ended',
         end_reason = v_reason
   where session_id = p_session_id
     and ended_at is null
     and (
           v_reason <> 'inactivity_2m'
           -- inactivity_2m 은 idle >= 120 초일 때만 허용한다.
           or last_activity_at <= now() - make_interval(secs => public.argo_idle_timeout_seconds())
         );

  get diagnostics v_hit = row_count;
  return v_hit > 0;
end;
$$;

-- ── flag_session : 허용된 플래그만, 중복 없이 추가. confidence 는 서버가 정한다. ──
--    임의 JSON 이나 임의 confidence 를 클라이언트가 넣을 수 없다.
create or replace function public.flag_session(p_session_id uuid, p_flag text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_allowed constant text[] := array[
    'odd_page_order',          -- 비정상적인 페이지 순서 반복
    'photo_after_result',      -- 시험 완료 후 새 웹캠 촬영
    'multiple_candidates',     -- 재촬영이 아닌 복수 candidate_id 생성 시도
    'assessment_restarted',    -- 동일 세션에서 시험을 처음부터 반복
    'multiple_results',        -- 결과 생성 후 새로운 평가 시작
    'idle_jump'                -- 긴 무활동 직후 전혀 다른 단계로 이동
  ];
  v_hit integer;
begin
  if p_session_id is null or p_flag is null or not (p_flag = any(v_allowed)) then
    return false;   -- 허용 목록에 없으면 조용히 거절한다(관람 흐름을 막지 않는다)
  end if;

  update public.sessions
     set ambiguity_flags =
           case
             when ambiguity_flags @> jsonb_build_array(jsonb_build_object('flag', p_flag))
               then ambiguity_flags                       -- 이미 있으면 그대로(중복 없음)
             else ambiguity_flags || jsonb_build_array(
                    jsonb_build_object('flag', p_flag, 'at', now()))
           end,
         -- confidence 는 서버 규칙으로만 바뀐다 : 플래그가 하나라도 있으면 ambiguous
         confidence = 'ambiguous'
   where session_id = p_session_id
     and ended_at is null;

  get diagnostics v_hit = row_count;
  return v_hit > 0;
end;
$$;

-- ── get_result : QR 결과 화면에 실제로 필요한 값만. ─────────────────────────
--    session_id 를 돌려주지 않는다 — 돌려주면 그것이 세션 조작의 입력이 된다.
--    candidate_id 도 결과 화면에 표시하지 않으므로 제외한다.
create or replace function public.get_result(p_result_id uuid)
returns table (
  result_id     uuid,
  assigned_role text,
  scores        jsonb,
  completed_at  timestamptz
)
language sql
security definer
set search_path = pg_catalog
as $$
  select r.result_id, r.assigned_role, r.scores, r.completed_at
  from public.assessment_results r
  where r.result_id = p_result_id
  limit 1;
$$;

-- ── record_qr_open : QR 열람 기록. original_session_id 는 서버가 연결한다. ──
--    · 존재하지 않는 result_id 는 아무것도 기록하지 않는다
--    · coarse_device_type 은 세 값만, referrer 는 길이 제한
--    · 멱등은 client_qr_open_id unique + ON CONFLICT DO NOTHING 으로 정확히 처리한다
--      (예전의 '60초 창' 추정 방식은 긴 오프라인 재전송·동시 호출에서 중복이 났다)
create or replace function public.record_qr_open(
  p_result_id          uuid,
  p_qr_visit_id        uuid,
  p_coarse_device_type text,
  p_referrer           text,
  p_client_qr_open_id  uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_session uuid;
  v_found   boolean := false;
  v_device  text;
  v_ref     text;
begin
  if p_result_id is null or p_qr_visit_id is null or p_client_qr_open_id is null then
    return false;
  end if;

  select r.session_id, true into v_session, v_found
  from public.assessment_results r
  where r.result_id = p_result_id
  limit 1;

  if not coalesce(v_found, false) then
    return false;               -- 존재하지 않는 result_id 는 기록하지 않는다
  end if;

  v_device := case when p_coarse_device_type in ('mobile','tablet','desktop')
                   then p_coarse_device_type else null end;
  v_ref    := left(nullif(p_referrer, ''), 200);

  insert into public.qr_opens
    (client_qr_open_id, result_id, original_session_id, qr_visit_id, opened_at, coarse_device_type, referrer)
  values
    (p_client_qr_open_id, p_result_id, v_session, p_qr_visit_id, now(), v_device, v_ref)
  on conflict (client_qr_open_id) do nothing;

  return true;                  -- 새로 넣었든 이미 있었든 '완료' 다
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. 함수 실행 권한 — 정확한 시그니처로 회수 후, 필요한 것만 anon 에 부여
-- ════════════════════════════════════════════════════════════════════════════
revoke all on function public.argo_idle_timeout_seconds()              from public, anon, authenticated;
revoke all on function public.touch_session(uuid)                    from public, anon, authenticated;
revoke all on function public.end_session(uuid, text)                from public, anon, authenticated;
revoke all on function public.flag_session(uuid, text)               from public, anon, authenticated;
revoke all on function public.get_result(uuid)                       from public, anon, authenticated;
revoke all on function public.record_qr_open(uuid, uuid, text, text, uuid) from public, anon, authenticated;

-- 실제로 브라우저가 호출하는 것만 열어 준다.
-- argo_idle_timeout_seconds 는 내부 헬퍼라 아무에게도 주지 않는다
-- (security definer 함수 본문은 소유자 권한으로 돌므로 내부 호출은 그대로 된다).
-- 예전 4인자 버전이 남아 있으면 지운다(권한이 붙은 채로 남는 것을 막는다).
drop function if exists public.record_qr_open(uuid, uuid, text, text);

grant execute on function public.touch_session(uuid)                    to anon;
grant execute on function public.end_session(uuid, text)                to anon;
grant execute on function public.flag_session(uuid, text)               to anon;
grant execute on function public.get_result(uuid)                       to anon;
grant execute on function public.record_qr_open(uuid, uuid, text, text, uuid) to anon;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. 분석 뷰 — Dashboard 전용.
-- [중요] Supabase 는 public 스키마의 새 객체에 anon SELECT 를 기본으로 준다.
--        게다가 뷰는 소유자 권한으로 실행돼 하위 테이블의 RLS 를 우회한다
--        → 회수하지 않으면 이 뷰들로 events/sessions 전체가 그대로 읽힌다.
--        생성 '뒤에' 회수해야 실제로 지워진다(아래 순서를 바꾸지 말 것).
-- ════════════════════════════════════════════════════════════════════════════

create or replace view public.v_session_path as
select
  s.session_id, s.kiosk_id, s.app_version, s.entry_page,
  s.started_at, s.ended_at, s.end_reason, s.status, s.confidence,
  array_agg(e.event_name order by coalesce(e.queued_at, e.created_at)) as event_path,
  count(*) filter (where e.event_name = 'photo_captured')       as photos,
  count(*) filter (where e.event_name = 'photo_retaken')        as retakes,
  count(*) filter (where e.event_name = 'assessment_started')   as assess_starts,
  count(*) filter (where e.event_name = 'assessment_completed') as assess_done,
  count(*) filter (where e.event_name = 'guestbook_submitted')  as guestbook,
  count(*) filter (where e.event_name = 'gallery_viewed')       as gallery,
  count(*) filter (where e.event_name = 'mars_viewed')          as mars,
  count(*) filter (where e.event_name = 'skip_clicked')         as skips,
  count(*) filter (where e.event_name = 'technical_error')      as errors,
  -- page_exited 를 못 남긴 세션의 종료 기준 : 마지막 의미 있는 이벤트 시각
  max(coalesce(e.queued_at, e.created_at))                      as last_event_at
from public.sessions s
left join public.events e on e.session_id = s.session_id
group by s.session_id;

-- full / partial / dropoff / ambiguous
--   · ambiguous 는 플래그가 붙은 세션만 (정상적인 부분 이용은 partial 이다)
--   · 사진만 / 시험만 / 방명록만 / 갤러리만 = partial
create or replace view public.v_session_outcome as
select p.*,
  case
    when p.confidence = 'ambiguous'                             then 'ambiguous'
    when p.assess_done > 0 and p.guestbook > 0                  then 'full'
    when p.assess_done > 0
      or p.guestbook   > 0
      or p.photos      > 0
      or p.gallery     > 0
      or p.mars        > 0                                      then 'partial'
    else 'dropoff'
  end as outcome,
  -- 기술 오류로 끊긴 이탈을 콘텐츠 이탈과 분리해서 볼 수 있게 한다
  (p.errors > 0 and p.assess_done = 0) as error_affected
from public.v_session_path p;

-- 페이지별 체류시간 : 평균뿐 아니라 중앙값·90백분위수까지.
-- 원본 duration_ms 는 events.metadata 에 그대로 남는다.
create or replace view public.v_page_dwell as
-- [방어] metadata->>'duration_ms' 를 바로 numeric 으로 cast 하면 잘못된 문자열 하나에
-- 뷰 조회 전체가 실패한다. 정규식으로 '음수 없는 정수' 만 통과시킨 뒤 CASE 안에서만
-- 변환하고, 하루(86,400,000ms) 를 넘는 값은 오염으로 보고 제외한다.
with d as (
  select page_name,
         case when metadata->>'duration_ms' ~ '^[0-9]{1,9}$'
              then (metadata->>'duration_ms')::numeric
         end as ms
  from public.events
  where event_name = 'page_exited'
),
ok as (
  select page_name, ms from d
  where ms is not null and ms between 0 and 86400000
)
select
  page_name,
  count(*) as n,
  round(avg(ms))                                         as avg_ms,
  round(percentile_cont(0.5) within group (order by ms)) as median_ms,
  round(percentile_cont(0.9) within group (order by ms)) as p90_ms
from ok
group by page_name;

-- QR : 전체 접속 횟수 + 최소 1회 열린 고유 result_id 수 + 재방문
create or replace view public.v_qr_summary as
select
  (select count(*)                    from public.qr_opens) as total_opens,
  (select count(distinct result_id)   from public.qr_opens) as unique_results_opened,
  (select count(distinct qr_visit_id) from public.qr_opens) as unique_devices,
  (select count(*) from (
     select qr_visit_id, result_id from public.qr_opens
     group by qr_visit_id, result_id having count(*) > 1) t) as revisits,
  (select count(*)                    from public.assessment_results) as total_results;

-- ── 종료 사유 정규화 ────────────────────────────────────────────────────────
-- 과거 행은 inactivity_3m(180초), 이후 행은 inactivity_2m(120초)로 남는다.
-- 과거 행을 고치지 않고, 분석에서 둘을 같은 '무활동 종료' 로 읽게 해 주는 뷰다.
-- (기존 v_session_path / v_session_outcome 의 컬럼 순서는 건드리지 않는다 —
--  create or replace view 는 중간 컬럼 추가를 거부하므로 별도 뷰로 둔다.)
create or replace function public.argo_end_reason_group(p_reason text)
returns text language sql immutable as $$
  select case
           when p_reason in ('inactivity_2m','inactivity_3m') then 'inactivity'
           when p_reason is null                              then 'unknown'
           else p_reason
         end
$$;

create or replace view public.v_session_end_reason as
select
  s.session_id,
  s.kiosk_id,
  s.app_version,
  s.started_at,
  s.ended_at,
  s.end_reason,                                              -- 원본은 그대로 남긴다
  public.argo_end_reason_group(s.end_reason) as end_reason_group,
  -- 어느 타임아웃 세대에서 끝난 세션인지 (전시 회차 비교용)
  case s.end_reason
    when 'inactivity_3m' then 180
    when 'inactivity_2m' then 120
  end                                        as timeout_seconds
from public.sessions s;

-- 스킵률 / 스킵 후 완료율
create or replace view public.v_skip_summary as
select
  count(*)                                                  as sessions_with_activity,
  count(*) filter (where skips > 0)                         as sessions_with_skip,
  round(100.0 * count(*) filter (where skips > 0) / nullif(count(*),0), 1) as skip_rate_pct,
  round(100.0 * count(*) filter (where skips > 0 and assess_done > 0)
        / nullif(count(*) filter (where skips > 0), 0), 1)  as completion_after_skip_pct
from public.v_session_path;

-- 분석 뷰 권한 회수 (위 [중요] 참고). Dashboard 는 service_role 로 접속하므로 영향 없다.
revoke all on public.v_session_end_reason from anon, authenticated;
revoke all on function public.argo_end_reason_group(text) from public, anon, authenticated;
revoke all on public.v_session_path    from anon, authenticated;
revoke all on public.v_session_outcome from anon, authenticated;
revoke all on public.v_page_dwell      from anon, authenticated;
revoke all on public.v_qr_summary      from anon, authenticated;
revoke all on public.v_skip_summary    from anon, authenticated;

-- 참고: 앞으로 public 스키마에 뷰를 더 만들면 같은 회수를 반복해야 한다.
--       (default privileges 를 전역으로 바꾸면 다른 테이블까지 영향을 받으므로 여기서는 하지 않는다.)

-- ════════════════════════════════════════════════════════════════════════════
-- 6. 적용 후 자가 점검 — (a)(b)(c) 는 0행, (d) 는 아래 표와 정확히 일치해야 한다.
-- ════════════════════════════════════════════════════════════════════════════
-- (a) anon/authenticated 에 INSERT 외의 테이블 권한이 남아 있는가  → 0행이어야 정상
--   select table_name, grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public'
--     and table_name in ('sessions','events','assessment_results','guestbook_entries','qr_opens')
--     and grantee in ('anon','authenticated')
--     and privilege_type <> 'INSERT';
--
-- (b) qr_opens 에 anon/authenticated 권한이 하나라도 있는가        → 0행이어야 정상
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema='public' and table_name='qr_opens'
--     and grantee in ('anon','authenticated');
--
-- (c) 분석 뷰에 anon/authenticated 권한이 남아 있는가              → 0행이어야 정상
--   select table_name, grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema='public' and table_name like 'v\_%'
--     and grantee in ('anon','authenticated');
--
-- (d) 남아 있어야 할 권한은 정확히 이 네 줄뿐이다
--     sessions/INSERT, events/INSERT, assessment_results/INSERT, guestbook_entries/INSERT
--   select table_name, grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema='public'
--     and table_name in ('sessions','events','assessment_results','guestbook_entries','qr_opens')
--     and grantee in ('anon','authenticated')
--   order by table_name;
--
-- (e) anon 이 실행할 수 있는 함수는 정확히 이 다섯 개뿐이다
--     touch_session, end_session, flag_session, get_result, record_qr_open
--   select p.proname, pg_get_function_identity_arguments(p.oid) as args
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname='public' and has_function_privilege('anon', p.oid, 'execute')
--   order by p.proname;
