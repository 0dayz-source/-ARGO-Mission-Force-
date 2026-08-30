# 배포 메모 (GitHub Pages)

## 무엇이 서비스되는가
저장소 루트가 그대로 사이트 루트다. 진입점은 `index.html`.
경로가 전부 상대경로라 `사용자.github.io/저장소이름/` 같은 하위 경로에서도 그대로 동작한다.

- `index.html` — 빌드 결과물. **직접 고치지 말 것.**
- `src/scenes/*.html` + `src/shell.html` — 실제 소스. 고친 뒤 `python3 src/build.py` 를 돌린다.
- `11-planet-detail.html`, `photo-wall.html` — 독립 페이지(빌드 대상 아님)
- `.nojekyll` — Jekyll 이 `_` 로 시작하는 파일·폴더를 건너뛰지 않게 한다
- `src/` `db/` `docs/` — 백업용으로 함께 올라가지만 브라우저가 열어보지 않는다

## 고칠 때마다
```bash
python3 src/build.py   # index.html 재생성 + ?v= 캐시 버전 갱신
git add -A && git commit -m "..." && git push
```
`src/build.py` 가 `shared/**` 의 최신 수정시각으로 `?v=` 를 다시 찍는다. 이걸 건너뛰면
브라우저가 옛 CSS/JS 를 계속 쓴다.

## 배포 후 반드시 확인
1. **웹캠** — `getUserMedia` 는 HTTPS 에서만 된다. GitHub Pages 는 HTTPS 라 정상.
   단, 방문자가 카메라 권한을 허용해야 한다.
2. **Supabase** — `shared/argo-track.js` 의 키는 publishable(anon) 이라 공개돼도 안전하다.
   보호는 RLS 와 SECURITY DEFINER 함수가 한다. secret/service_role 키는 절대 넣지 말 것.
   Supabase 대시보드에서 배포 도메인을 허용 목록에 추가해야 할 수 있다.
3. **외부 CDN** — three.js·model-viewer(unpkg), supabase-js·mediapipe(jsdelivr).
   전시장 인터넷이 끊기면 3D 배경이 죽는다. 오프라인 전시라면 `shared/vendor/` 로
   내려받아 경로를 바꾸는 것을 권한다.
4. **세션 타임아웃** — 90초 경고 / 120초 종료. 서버(Supabase)도 120초로 맞춰야 한다.
   `supabase/2-migration-timeout-120s.sql` 을 SQL Editor 에서 한 번 실행.
   (`supabase/README.md` 에 확인 방법과 나머지 서버 작업이 정리돼 있다)

## 개발용
- 로컬: `python3 -m http.server 8899` → `http://localhost:8899/`
  (`file://` 로 열면 스크립트·폰트가 안 붙는다)
- 경고 화면 미리보기: `http://localhost:8899/src/preview-warning.html` (localhost 전용)
