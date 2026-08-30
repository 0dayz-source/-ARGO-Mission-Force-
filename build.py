#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build.py — pages/* 를 _shell.html 에 합쳐 index.html 생성.

동작:
  1) pages/*.html 에서 <!-- PAGE-START:id --> ~ <!-- PAGE-END:id --> 사이 내용을 추출
  2) _shell.html 의 <!--INCLUDE:id--> 자리에 그 내용을 끼워넣음
  3) 끼워넣는 조각의 ../shared/ 경로를 shared/ 로 보정 (index.html 은 루트에 위치)
     ※ ../pages/ 링크는 그대로 둠
  4) 결과를 index.html 로 저장

사용:  python3 build.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PAGES_DIR = ROOT / "pages"
SHELL = ROOT / "_shell.html"
OUT = ROOT / "index.html"

VER_RE = re.compile(r"\?v=\d+")
# ?v= 를 새로 찍을 파일. index.html 은 생성물이고, 나머지 둘은 독립 페이지다.
STAMP_FILES = ["index.html", "11-planet-detail.html", "photo-wall.html"]

START_RE = re.compile(r"<!--\s*PAGE-START:([A-Za-z0-9_-]+)\s*-->")
END_TMPL = "<!--\\s*PAGE-END:{id}\\s*-->"
INCLUDE_RE = re.compile(r"<!--\s*INCLUDE:([A-Za-z0-9_-]+)\s*-->")


def collect_sections():
    """pages/*.html 를 훑어 id -> 마커 사이 내용 dict 생성."""
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
        print("ERROR: _shell.html 없음", file=sys.stderr)
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


def stamp_version():
    """shared/ 안에서 가장 최근 수정시각으로 ?v= 를 새로 찍는다.

    _shell.html 에 ?v=1794600103 이 상수로 박혀 있어서, CSS/JS 를 고쳐도 브라우저가
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
