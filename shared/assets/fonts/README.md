# 폰트 — 전부 로컬 (외부 CDN 의존 없음)

전시장 네트워크가 끊겨도 글자가 깨지지 않도록 4종 전부 이 폴더에 두고 직접 서빙한다.
**구글폰트·jsDelivr 링크를 다시 넣지 말 것.**

## 서체 4종

| # | 역할 | 서체 | 파일 | 라이선스 |
|---|---|---|---|---|
| 1 | 타이틀 | Syne 400/700/800 | `syne.css` + `syne/` (3개, 59KB) | OFL |
| 2 | 기본 영문 | 시스템 산세리프 (`-apple-system` …) | 없음 — OS 내장 | — |
| 3 | 코딩 영문 | IBM Plex Mono 300~600 | `ibmplexmono.css` + `ibmplexmono/` (20개, 128KB) | OFL |
| 4 | 한글 | Pretendard Variable 45~920 | `pretendard.css` + `pretendard/` (92개, 3.0MB) | OFL |

Syne 은 `.lp-h`(MISSION FORCE ARGO)와 `.dw-en`(시스템 6페이지 상단 제목)에서만 쓴다.

## Pretendard 가 92개 파일인 이유

**dynamic subset** 이다. 유니코드 구간별로 쪼개 두고 `unicode-range` 로 필요한 것만 받는다.
합계는 3MB 지만 **실제로 받는 건 보통 3~6개(≈100KB)** — 화면에 뜬 글자가 속한 구간만 로드된다.
방명록에 드문 한자를 입력해도 해당 서브셋이 그때 로컬에서 로드되므로 글자가 깨지지 않는다.
(단일 `PretendardVariable.woff2` 는 2MB 를 통째로 받아야 해서 쓰지 않는다.)

## 어디서 불러오는가

각 HTML `<head>` 에서 세 CSS 를 직접 링크한다. 예 (`_shell.html`):

```html
<link rel="stylesheet" href="shared/assets/fonts/pretendard.css">
<link rel="stylesheet" href="shared/assets/fonts/syne.css">
<link rel="stylesheet" href="shared/assets/fonts/ibmplexmono.css">
```

`pages/*.html` 은 한 단계 위이므로 `../shared/assets/fonts/…` 를 쓴다.
경로는 각 CSS 안의 `url()` 이 자기 폴더 기준 상대경로라, 폴더째 옮기면 그대로 따라간다.

## 한글이 OS 기본 글꼴로 새지 않게

`--disp` · `--mono` 스택 **맨 뒤**에 `'Pretendard Variable', Pretendard` 를 붙여 뒀다.
라틴은 앞의 폰트가 잡고, 한글은 그 폰트에 글리프가 없어 Pretendard 로 떨어진다(글리프 단위 폴백).
이게 없으면 `--disp` 만 선언한 요소의 한글이 Apple SD Gothic Neo 로 렌더된다.

## KHTeka-Regular.*

StringTune 이 쓰는 상용 폰트(Kometa). Regular 한 벌뿐이라 800 에서 가짜 볼드가 나 채택하지 않았다.
**어느 스택에도 걸려 있지 않아 다운로드되지 않는다.** Medium/Bold 를 구하면 다시 검토할 것.
