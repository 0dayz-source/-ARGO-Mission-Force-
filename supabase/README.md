# Supabase — 서버에 올리는 것들

여기 있는 파일은 **브라우저가 받아가지 않는다.** Supabase 대시보드에서 사람이 직접
실행하는 것들이다. 사이트 배포(`git push`)와는 완전히 별개다.

프로젝트 : `qscaoyfkvmszyavqffwh` · 대시보드 → SQL Editor

---

## 지금 상태

| 파일 | 무엇 | 올라갔나 |
|---|---|---|
| `1-schema.sql` | 세션·이벤트·평가결과·방명록·QR열람 | ✅ **적용됨** |
| `2-migration-timeout-120s.sql` | 무활동 기준 180초 → 120초 | ❓ **확인 필요** |
| `3-photo-storage.sql` | 웹캠 사진을 서버에 저장 | ⬜ 미적용 (선택) |
| `functions/classify-guestbook/` | 방명록 AI 자동 분류 | ⬜ 미배포 (선택) |

`1-schema.sql` 이 적용된 건 실제로 확인했다 — `rpc/get_result`, `rpc/touch_session` 이
200 을 돌려준다. 이게 없으면 관람객 행동이 하나도 기록되지 않는다.

---

## 1. `1-schema.sql` — 필수, 이미 적용됨

사이트가 돌아가는 데 필요한 전부. 다시 실행할 필요 없다.
(전부 `create or replace` / `if not exists` 라 다시 돌려도 안전하긴 하다.)

## 2. `2-migration-timeout-120s.sql` — 확인해야 함

프론트(`shared/argo-track.js`)는 **120초**에 세션을 끊는다. 서버도 같은 값이어야
한쪽만 종료를 거부하는 일이 없다. 지금 값이 몇인지는 밖에서 읽을 수 없다
(anon 에게 실행 권한이 없다 — 의도된 것). SQL Editor 에서 직접 확인한다.

```sql
select argo_idle_timeout_seconds();
```

- `120` 이 나오면 → 아무것도 안 해도 된다
- `180` 이 나오면 → `2-migration-timeout-120s.sql` 전체를 붙여넣고 RUN

## 3. `3-photo-storage.sql` — 안 켜도 사이트는 정상

**지금 관람객 촬영 사진은 서버로 안 올라간다.** 그 키오스크 브라우저의
localStorage 에만 남는다 — 브라우저 데이터를 지우면 사진도 사라진다.

`1-schema.sql` 에는 사진을 담을 곳이 아예 없다. 사진을 서버에 모으려면
이 파일이 만드는 Storage 버킷과 테이블이 필요하다.

켜는 법 :
1. 이 파일 전체를 SQL Editor 에 붙여넣고 RUN
2. `shared/argo-db.js` 의 `CONFIG.url` / `CONFIG.anonKey` 를 채운다
   (지금은 비어 있어서 업로드 호출이 전부 조용히 무시된다)

전시에서 찍은 사진을 남겨야 한다면 **전시 시작 전에** 켜 둘 것.

## 4. `functions/classify-guestbook/` — 안 켜도 사이트는 정상

방명록 글을 AI 로 분류(카테고리·감정·키워드)해서 결과 컬럼만 채우는 서버 함수다.
프론트는 이 함수의 존재를 모른다 — 배포하지 않아도 방명록 저장은 정상이고,
`classification_status` 가 `pending` 으로 남을 뿐이다.

전시가 끝나고 "관람객들이 무슨 얘기를 남겼나" 분석할 때 켜면 된다.

```bash
supabase functions deploy classify-guestbook
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
```

`service_role` 키는 오직 이 함수 안에서만 쓰인다. 브라우저나 GitHub 에 절대 두지 말 것.

---

## 키에 대해

`shared/argo-track.js` 에 있는 `publishable` 키는 **공개돼도 안전하다.** 보호는
RLS 정책과 `security definer` 함수가 한다. `secret` / `service_role` 키는
프론트 어디에도 넣으면 안 된다.
