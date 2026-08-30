-- ════════════════════════════════════════════════════════════════════════════
--  ARGO — 세션 타임아웃 180초 → 120초 최소 마이그레이션
--  (이미 shared/argo-track.sql 을 적용해 둔 Supabase 프로젝트 전용)
--
--  [무엇을 하는가]
--    · 무활동 기준 상수를 180 → 120 으로 내린다
--    · touch_session : idle < 120 에서만 허용
--    · end_session   : inactivity_2m 을 idle >= 120 에서만 허용
--                      (구 클라이언트의 inactivity_3m 도 같은 조건으로 받아 신규 이름으로 저장)
--    · 구·신 종료 사유를 한 버킷으로 읽는 분석 뷰를 추가
--
--  [무엇을 하지 않는가]
--    · 테이블 / 기존 행 / RLS 정책 / 인덱스를 건드리지 않는다 (drop·recreate 없음)
--    · 과거 inactivity_3m 행을 수정하거나 삭제하지 않는다
--    · Edge Function 을 배포하지 않는다
--
--  [안전]
--    · 전부 create or replace — 여러 번 실행해도 결과가 같다(멱등)
--    · security definer + set search_path = pg_catalog + schema-qualified 이름
--    · dynamic SQL(EXECUTE) 없음
--    · 함수 권한은 회수 후 정확한 시그니처만 anon 에 부여
--
--  사용 : Supabase SQL Editor 에 전체를 붙여넣고 RUN.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) 무활동 기준 상수 (단일 출처) ─────────────────────────────────────────
-- 프론트 shared/argo-track.js 의 CONFIG.sessionTimeoutMs(120000) 와 같은 값이다.
-- 정확히 120.0 초인 순간 : touch 거절, 종료 허용 (빈틈도 겹침도 없다).
create or replace function public.argo_idle_timeout_seconds()
returns integer language sql immutable as $$ select 120 $$;

-- ── 2) touch_session : idle < 120 에서만 갱신 ───────────────────────────────
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

-- ── 3) end_session : inactivity_2m 은 idle >= 120 에서만 ────────────────────
--    구 클라이언트가 보내는 inactivity_3m 은 이름만 옛것이므로 같은 조건으로 받아
--    신규 이름(inactivity_2m)으로 저장한다 — 큐에 남은 옛 요청이 영원히 재시도되지 않는다.
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
  if exists (select 1 from public.sessions
             where session_id = p_session_id and ended_at is not null) then
    return true;
  end if;

  -- 사유는 서버가 아는 값으로만 정규화한다(임의 문자열 주입 방지).
  v_reason := case
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

-- ── 4) 분석 : 구(inactivity_3m) · 신(inactivity_2m) 을 모두 인식 ────────────
--    과거 행은 그대로 둔다. 읽는 쪽에서 한 버킷으로 묶어 준다.
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
  s.end_reason,                                              -- 원본 보존
  public.argo_end_reason_group(s.end_reason) as end_reason_group,
  case s.end_reason
    when 'inactivity_3m' then 180
    when 'inactivity_2m' then 120
  end                                        as timeout_seconds
from public.sessions s;

-- ── 5) 권한 : 불필요한 것은 회수하고 정확한 시그니처만 anon 에 ───────────────
--    (security definer 함수 본문은 소유자 권한으로 돌므로 내부 조회는 그대로 된다.)
revoke all on function public.argo_idle_timeout_seconds()   from public, anon, authenticated;
revoke all on function public.touch_session(uuid)           from public, anon, authenticated;
revoke all on function public.end_session(uuid, text)       from public, anon, authenticated;
revoke all on function public.argo_end_reason_group(text)   from public, anon, authenticated;

grant execute on function public.touch_session(uuid)        to anon;
grant execute on function public.end_session(uuid, text)    to anon;
-- argo_idle_timeout_seconds / argo_end_reason_group 은 내부 전용 — anon 에 주지 않는다.

-- 분석 뷰는 대시보드(service_role)만 읽는다.
revoke all on public.v_session_end_reason from anon, authenticated;

-- ── 확인용 (선택) ───────────────────────────────────────────────────────────
-- select public.argo_idle_timeout_seconds();            -- 120 이어야 한다
-- select end_reason_group, count(*) from public.v_session_end_reason group by 1;
