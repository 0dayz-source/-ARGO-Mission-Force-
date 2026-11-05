-- ════════════════════════════════════════════════════════════════════════════
--  ARGO — 방명록 공개 읽기 (2026-11-05)
--
--  [무엇을 하는가]
--    · guestbook_entries 에 author_name(작성자 이름, 선택) 컬럼을 더한다
--    · public_guestbook() RPC : 이름·본문·작성시각만 돌려준다
--      (session_id / result_id / 분류 결과는 내보내지 않는다)
--    · 전시 시작(2026-11-03 00:00 KST) 이후 글 전부. 그날 12:57 까지 사이트가 시험 모드라
--      실제 관람객 글에도 -TEST 가 붙어 있어서 키오스크 이름으로는 거르지 않는다.
--
--  [무엇을 하지 않는가]
--    · 테이블 SELECT 권한/정책은 여전히 없다 — 읽기는 이 RPC 하나로만 된다
--    · 기존 행을 수정하지 않는다
--
--  [순서] 이 SQL 을 먼저 실행한 뒤에 사이트를 배포한다 — 사이트가 author_name 을 보내기 때문.
--  여러 번 실행해도 결과가 같다.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.guestbook_entries add column if not exists author_name text;
alter table public.guestbook_entries drop constraint if exists gb_author_len_chk;
alter table public.guestbook_entries add constraint gb_author_len_chk
  check (author_name is null or char_length(author_name) <= 40);

create or replace function public.public_guestbook()
returns table (
  guestbook_id uuid,
  author_name  text,
  message      text,
  submitted_at timestamptz
)
language sql
security definer
set search_path = pg_catalog
stable
as $$
  select g.guestbook_id, g.author_name, g.message, g.submitted_at
  from public.guestbook_entries g
  where g.submitted_at >= timestamptz '2026-11-03 00:00:00+09'
  order by g.submitted_at desc
  limit 500
$$;

revoke all on function public.public_guestbook() from public, anon, authenticated;
grant execute on function public.public_guestbook() to anon;
