-- ============================================================================
-- ARGO — Supabase 초기 설정 (한 번만 실행)
-- Supabase 프로젝트 → SQL Editor → 새 쿼리에 전체 붙여넣기 → RUN
-- 방명록(guestbook) + 웹캠 촬영(captures) 테이블/스토리지/공개 정책을 만듭니다.
-- ============================================================================

-- 1) 방명록 테이블 -----------------------------------------------------------
create table if not exists public.guestbook (
  id          bigint generated always as identity primary key,
  name        text,
  msg         text not null,
  time        text,
  photo_url   text,
  session_id  text,
  created_at  timestamptz not null default now()
);
alter table public.guestbook enable row level security;

drop policy if exists "guestbook anon insert" on public.guestbook;
create policy "guestbook anon insert" on public.guestbook
  for insert to anon with check (true);

drop policy if exists "guestbook anon read" on public.guestbook;
create policy "guestbook anon read" on public.guestbook
  for select to anon using (true);

-- 2) 웹캠 촬영 기록 테이블 ---------------------------------------------------
create table if not exists public.captures (
  id          bigint generated always as identity primary key,
  photo_url   text not null,
  session_id  text,
  created_at  timestamptz not null default now()
);
alter table public.captures enable row level security;

drop policy if exists "captures anon insert" on public.captures;
create policy "captures anon insert" on public.captures
  for insert to anon with check (true);

drop policy if exists "captures anon read" on public.captures;
create policy "captures anon read" on public.captures
  for select to anon using (true);

-- 3) 심리 평가(테스트) 결과 테이블 ------------------------------------------
create table if not exists public.assessment (
  id             bigint generated always as identity primary key,
  verdict        text,
  top_job        text,
  top_job_score  integer,
  total          integer,
  job_scores     jsonb,
  psych_scores   jsonb,
  answers        jsonb,
  photo_url      text,
  session_id     text,
  created_at     timestamptz not null default now()
);
alter table public.assessment enable row level security;

drop policy if exists "assessment anon insert" on public.assessment;
create policy "assessment anon insert" on public.assessment
  for insert to anon with check (true);

drop policy if exists "assessment anon read" on public.assessment;
create policy "assessment anon read" on public.assessment
  for select to anon using (true);

-- 4) 사진 파일용 Storage 버킷 (공개 읽기) ------------------------------------
insert into storage.buckets (id, name, public)
values ('captures', 'captures', true)
on conflict (id) do update set public = true;

drop policy if exists "captures storage anon upload" on storage.objects;
create policy "captures storage anon upload" on storage.objects
  for insert to anon with check (bucket_id = 'captures');

drop policy if exists "captures storage public read" on storage.objects;
create policy "captures storage public read" on storage.objects
  for select to anon using (bucket_id = 'captures');

-- 5) 세션 단위로 묶어보기 (방명록 + 웹캠 + 평가결과) -------------------------
--    한 방문자(session_id)의 방명록/사진/테스트 결과를 한 줄로 모아 보는 뷰.
create or replace view public.session_bundle as
select
  coalesce(g.session_id, c.session_id, a.session_id) as session_id,
  g.name        as guest_name,
  g.msg         as guest_msg,
  g.time        as guest_time,
  coalesce(g.photo_url, a.photo_url, c.photo_url) as photo_url,
  a.verdict, a.top_job, a.total, a.job_scores, a.psych_scores, a.answers,
  greatest(coalesce(g.created_at, a.created_at, c.created_at)) as latest_at
from public.guestbook g
full outer join public.assessment a on a.session_id = g.session_id
full outer join public.captures  c on c.session_id = coalesce(g.session_id, a.session_id);

-- 완료. 이제 shared/argo-db.js 의 CONFIG(url, anonKey)만 채우면 저장이 켜집니다.
-- 수집된 데이터 보기:
--   · Table Editor → guestbook / captures / assessment
--   · Storage → captures (사진 파일)
--   · SQL:  select * from session_bundle order by latest_at desc;  (세션별 묶음)
