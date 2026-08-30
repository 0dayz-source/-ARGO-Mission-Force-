# ARGO — TERRAFORMING SELECTION COMMITTEE

전시 키오스크용 웹사이트. GitHub Pages 로 서비스된다.
공개 주소 : https://0dayz-source.github.io/-ARGO-Mission-Force-/

---

## 폴더가 무슨 뜻인가

### 관람객이 실제로 여는 주소 — 딱 3개
| 파일 | 화면 |
|---|---|
| `index.html` | 메인. 스크롤·씬 전환형 SPA (12개 씬이 이 파일 하나에 들어 있다) |
| `11-planet-detail.html` | MARS 기록 열람 + 후보자 촬영 |
| `photo-wall.html` | CANDIDATE WALL |

**`index.html` 은 사람이 쓰는 파일이 아니다.** `src/` 의 재료를 `build.py` 가 합쳐 만든
결과물이다. 직접 고치면 다음 빌드에 덮어써진다.

### 브라우저가 받아가는 짐 — 경로를 바꾸면 안 되는 곳
| 폴더 | 내용 |
|---|---|
| `shared/` | 공통 JS 19개 · CSS 7개 · 폰트 · OPERATOR·07 캐릭터 |
| `assets/` | 우주 사진 61장 · SYSTEM INDEX 썸네일 15장 |

### 사람이 고치는 곳
| 폴더 | 내용 |
|---|---|
| `src/scenes/` | `index.html` 의 재료 15개. 여기를 고친다 |
| `src/shell.html` | 재료를 끼워 넣는 틀 (`<head>`, 스크립트 태그, 씬 뼈대) |
| `src/build.py` | 재료 + 틀 → `index.html` 을 만드는 스크립트 |
| `db/` | Supabase 서버측 SQL. 브라우저와 무관 |
| `docs/` | 이 문서와 배포 메모 |

`_trash/` 는 버린 파일 모음이다. git 에 올라가지 않고 이 맥북에만 있다.

---

## 왜 MARS 와 WALL 은 `src/scenes/` 에 없나

`src/scenes/` 는 "사이트의 페이지들"이 아니라 **`index.html` 한 장을 만들기 위한 조각**이다.

```
src/scenes/01-main.html  ─┐
src/scenes/02-about.html  ├─ src/build.py ─→ index.html
… 15개 ──────────────────┘
```

`11-planet-detail.html` 과 `photo-wall.html` 은 `index.html` 의 일부가 아니라
자기 주소를 가진 별개 페이지다. 합쳐지는 재료가 아니므로 재료 폴더에 두지 않는다.

---

## 고치는 방법

```bash
# 1) src/scenes/*.html · src/shell.html · shared/* 중 필요한 것을 고친다
python3 src/build.py            # index.html 재생성 + ?v= 캐시 번호 갱신
git add -A && git commit -m "..." && git push
```

`build.py` 를 건너뛰면 `index.html` 이 옛날 것으로 남고 `?v=` 도 그대로라
브라우저가 캐시된 CSS/JS 를 계속 쓴다. 반영까지 1~2분 걸린다.

로컬 확인 : `python3 -m http.server 8899` → `http://localhost:8899/`
(`file://` 로 열면 스크립트·폰트가 안 붙는다)

운영·배포 상세는 [DEPLOY.md](DEPLOY.md) 참고.
