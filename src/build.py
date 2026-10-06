#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build.py — src/scenes/* 를 src/shell.html 에 합쳐 index.html 생성.

동작:
  1) src/scenes/*.html 에서 <!-- PAGE-START:id --> ~ <!-- PAGE-END:id --> 사이 내용을 추출
  2) src/shell.html 의 <!--INCLUDE:id--> 자리에 그 내용을 끼워넣음
  3) 끼워넣는 조각의 ../shared/ 경로를 shared/ 로 보정 (index.html 은 루트에 위치)
     ※ ../scenes/ 링크는 그대로 둠
  4) 결과를 index.html 로 저장

사용:  python3 src/build.py   (어느 위치에서 실행해도 된다)
"""
import re
import shutil
import sys
from pathlib import Path

# 이 파일은 src/ 안에 있고, 결과물 index.html 은 저장소 루트에 놓인다.
#   src/scenes/*.html  +  src/shell.html   →   <루트>/index.html
ROOT = Path(__file__).resolve().parent.parent      # 저장소 루트 (= 사이트 루트)
SRC = ROOT / "src"
PAGES_DIR = SRC / "scenes"
SHELL = SRC / "shell.html"
OUT = ROOT / "index.html"

VER_RE = re.compile(r"\?v=\d+")
# ?v= 를 새로 찍을 파일. index.html 은 생성물이고, 나머지 둘은 독립 페이지다.
STAMP_FILES = ["index.html", "11-planet-detail.html", "photo-wall.html"]

START_RE = re.compile(r"<!--\s*PAGE-START:([A-Za-z0-9_-]+)\s*-->")
END_TMPL = "<!--\\s*PAGE-END:{id}\\s*-->"
INCLUDE_RE = re.compile(r"<!--\s*INCLUDE:([A-Za-z0-9_-]+)\s*-->")


def collect_sections():
    """src/scenes/*.html 를 훑어 id -> 마커 사이 내용 dict 생성."""
    sections = {}
    for page in sorted(PAGES_DIR.glob("*.html")):
        text = page.read_text(encoding="utf-8")
        for m in START_RE.finditer(text):
            sid = m.group(1)
            end_re = re.compile(END_TMPL.format(id=re.escape(sid)))
            em = end_re.search(text, m.end())
            if not em:
                print(f"  ! {page.name}: PAGE-END:{sid} 없음 — 건너뜀", file=sys.stderr)
                continue
            content = text[m.end():em.start()].strip()
            # index.html 은 루트에 위치하므로 ../shared/ -> shared/
            content = content.replace("../shared/", "shared/")
            if sid in sections:
                print(f"  ! id 중복: {sid} ({page.name}) — 마지막 것으로 덮어씀", file=sys.stderr)
            sections[sid] = content
    return sections


def main():
    if not SHELL.exists():
        print("ERROR: src/shell.html 없음", file=sys.stderr)
        sys.exit(1)
    shell = SHELL.read_text(encoding="utf-8")
    sections = collect_sections()

    missing = []

    def repl(m):
        sid = m.group(1)
        if sid not in sections:
            missing.append(sid)
            return m.group(0)
        return sections[sid]

    out = INCLUDE_RE.sub(repl, shell)

    if missing:
        print(f"  ! INCLUDE 대상 누락: {', '.join(missing)}", file=sys.stderr)

    OUT.write_text(out, encoding="utf-8")
    left = len(INCLUDE_RE.findall(out))
    stamped = stamp_version()
    print(f"빌드 완료 → {OUT.name}  (병합 {len(sections)}개, 미치환 INCLUDE {left}개, ?v={stamped})")
    build_lite()
    print("저사양판 → lite/")


def build_lite():
    """lite/ — 사이트 통째 복사본에 해상도 상한(shared/argo-dpr.js)만 끼운 저사양판.

    JS 가 'assets/…' 'shared/assets/…' 를 문서 기준 상대경로로 읽어서, HTML 만 옮기면
    경로가 깨진다. 그래서 shared/·assets/ 까지 같이 복사한다. 매 빌드마다 새로 만들므로
    lite/ 는 직접 고치지 말 것.
    """
    lite = ROOT / "lite"
    shutil.rmtree(lite, ignore_errors=True)
    for d in ("shared", "assets"):
        shutil.copytree(ROOT / d, lite / d, ignore=shutil.ignore_patterns(".DS_Store"))
    for name in STAMP_FILES:
        text = (ROOT / name).read_text(encoding="utf-8")
        tag = '<meta charset="UTF-8">'
        assert text.count(tag) >= 1, f"{name}: {tag} 없음"
        text = text.replace(tag, tag + '<script src="shared/argo-dpr.js"></script>', 1)
        (lite / name).write_text(text, encoding="utf-8")
    # 메인 3D 배경의 MSAA 를 끈다 — 5K 에서 눈에 거의 안 띄고 비용은 크다
    app = lite / "shared" / "app.js"
    src = app.read_text(encoding="utf-8")
    old = "new THREE.WebGLRenderer({canvas,antialias:true})"
    assert src.count(old) == 1, "app.js: 렌더러 생성 줄이 바뀌었다 — build_lite 를 고칠 것"
    app.write_text(src.replace(old, old.replace("true", "false")), encoding="utf-8")


def stamp_version():
    """shared/ 안에서 가장 최근 수정시각으로 ?v= 를 새로 찍는다.

    src/shell.html 에 ?v=1794600103 이 상수로 박혀 있어서, CSS/JS 를 고쳐도 브라우저가
    캐시된 옛 파일을 계속 썼다(고친 게 화면에 안 나타나는 원인). 빌드할 때마다
    실제 파일 시각으로 바꿔 준다 — 안 바뀌었으면 번호도 그대로라 캐시는 그대로 산다.
    """
    ver = 0
    for f in (ROOT / "shared").rglob("*"):
        if f.is_file() and f.suffix in (".css", ".js"):
            ver = max(ver, int(f.stat().st_mtime))
    for name in STAMP_FILES:
        path = ROOT / name
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        new = VER_RE.sub(f"?v={ver}", text)
        if new != text:
            path.write_text(new, encoding="utf-8")
    return ver


if __name__ == "__main__":
    main()
