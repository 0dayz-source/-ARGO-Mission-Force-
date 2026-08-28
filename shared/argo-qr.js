/* ARGO QR — 의존성 없는 최소 QR 인코더 (byte 모드, EC level M, version 1~10).
   외부 라이브러리를 붙이지 않는 이 프로젝트 원칙에 맞춰 직접 구현했다.
   쓰는 곳: 결과지(#result-overlay)의 결과 조회 QR.

   window.ArgoQR.draw(canvas, text)  → 캔버스에 그린다(성공 시 true)
   window.ArgoQR.matrix(text)        → true/false 2차원 배열

   ponytail: version 10(byte 213자)까지만 지원한다. 그 이상이 필요하면
   CAPACITY/EC_BYTES/ALIGN 표에 버전을 더 넣으면 된다 — 알고리즘은 그대로다. */
(function (global) {
  'use strict';

  /* ---- GF(256) : QR 이 쓰는 원시다항식 0x11D ---- */
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1; if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  /* 생성 다항식 */
  function rsPoly(n) {
    var p = [1];
    for (var i = 0; i < n; i++) {
      var q = p.concat([0]);
      for (var j = 0; j < p.length; j++) q[j + 1] ^= gmul(p[j], EXP[i]);
      p = q;
    }
    return p;
  }
  function rsEncode(data, ecLen) {
    var gen = rsPoly(ecLen), res = new Uint8Array(data.length + ecLen);
    res.set(data);
    for (var i = 0; i < data.length; i++) {
      var f = res[i]; if (!f) continue;
      for (var j = 0; j < gen.length; j++) res[i + j] ^= gmul(gen[j], f);
    }
    return res.slice(data.length);
  }

  /* ---- 버전별 표 (EC level M 만) ----
     totalCodewords / ecPerBlock / [group1블록수, group1데이터, group2블록수, group2데이터] */
  var VER = {
    1:  { total: 26,  ec: 10, blocks: [1, 16, 0, 0] },
    2:  { total: 44,  ec: 16, blocks: [1, 28, 0, 0] },
    3:  { total: 70,  ec: 26, blocks: [1, 44, 0, 0] },
    4:  { total: 100, ec: 18, blocks: [2, 32, 0, 0] },
    5:  { total: 134, ec: 24, blocks: [2, 43, 0, 0] },
    6:  { total: 172, ec: 16, blocks: [4, 27, 0, 0] },
    7:  { total: 196, ec: 18, blocks: [4, 31, 0, 0] },
    8:  { total: 242, ec: 22, blocks: [2, 38, 2, 39] },
    9:  { total: 292, ec: 22, blocks: [3, 36, 2, 37] },
    10: { total: 346, ec: 26, blocks: [4, 43, 1, 44] }
  };
  /* 정렬 패턴 중심 좌표 */
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  function dataCapacity(v) {
    var b = VER[v].blocks;
    return b[0] * b[1] + b[2] * b[3];
  }

  function utf8(text) {
    var out = [], s = unescape(encodeURIComponent(text));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
    return out;
  }

  /* ---- 비트 스트림 ---- */
  function BitBuf() { this.bits = []; }
  BitBuf.prototype.put = function (val, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  };

  function buildCodewords(bytes, v) {
    var cap = dataCapacity(v), buf = new BitBuf();
    buf.put(4, 4);                                  /* byte 모드 */
    buf.put(bytes.length, v < 10 ? 8 : 16);         /* 길이 필드 */
    for (var i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);
    var maxBits = cap * 8;
    for (var t = 0; t < 4 && buf.bits.length < maxBits; t++) buf.bits.push(0);  /* 종단자 */
    while (buf.bits.length % 8) buf.bits.push(0);
    var cw = [];
    for (var k = 0; k < buf.bits.length; k += 8) {
      var b = 0; for (var j = 0; j < 8; j++) b = (b << 1) | buf.bits[k + j];
      cw.push(b);
    }
    var pad = [0xec, 0x11], pi = 0;
    while (cw.length < cap) cw.push(pad[pi++ % 2]);

    /* 블록 분할 → 인터리브 */
    var spec = VER[v].blocks, ecLen = VER[v].ec, blocks = [], p = 0, i2;
    for (i2 = 0; i2 < spec[0]; i2++) { blocks.push(cw.slice(p, p + spec[1])); p += spec[1]; }
    for (i2 = 0; i2 < spec[2]; i2++) { blocks.push(cw.slice(p, p + spec[3])); p += spec[3]; }
    var ecs = blocks.map(function (b) { return rsEncode(Uint8Array.from(b), ecLen); });
    var out = [], maxD = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
    for (i2 = 0; i2 < maxD; i2++) blocks.forEach(function (b) { if (i2 < b.length) out.push(b[i2]); });
    for (i2 = 0; i2 < ecLen; i2++) ecs.forEach(function (e) { out.push(e[i2]); });
    return out;
  }

  /* ---- 매트릭스 ---- */
  function place(v, codewords, mask) {
    var size = v * 4 + 17;
    var m = [], reserved = [];
    for (var i = 0; i < size; i++) { m.push(new Array(size).fill(0)); reserved.push(new Array(size).fill(0)); }

    function finder(r, c) {
      for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
        var rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        var on = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                 (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                 (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
        m[rr][cc] = on ? 1 : 0; reserved[rr][cc] = 1;
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    for (var t = 8; t < size - 8; t++) {            /* 타이밍 */
      var on2 = (t % 2 === 0) ? 1 : 0;
      m[6][t] = on2; reserved[6][t] = 1;
      m[t][6] = on2; reserved[t][6] = 1;
    }
    var ac = ALIGN[v];
    for (var a = 0; a < ac.length; a++) for (var b2 = 0; b2 < ac.length; b2++) {
      var ar = ac[a], acc = ac[b2];
      if (reserved[ar] && reserved[ar][acc]) continue;               /* 파인더와 겹치면 건너뛴다 */
      for (var dr2 = -2; dr2 <= 2; dr2++) for (var dc2 = -2; dc2 <= 2; dc2++) {
        var on3 = (Math.max(Math.abs(dr2), Math.abs(dc2)) !== 1) ? 1 : 0;
        m[ar + dr2][acc + dc2] = on3; reserved[ar + dr2][acc + dc2] = 1;
      }
    }
    m[size - 8][8] = 1; reserved[size - 8][8] = 1;                    /* 다크 모듈 */
    for (var f = 0; f < 9; f++) {                                     /* 포맷 자리 예약 */
      if (f !== 6) { reserved[8][f] = 1; reserved[f][8] = 1; }
    }
    for (var g = 0; g < 8; g++) { reserved[8][size - 1 - g] = 1; reserved[size - 1 - g][8] = 1; }
    reserved[8][6] = 1; reserved[6][8] = 1;

    /* 데이터 배치 : 오른쪽 아래에서 두 칸씩 지그재그 */
    var bits = [];
    codewords.forEach(function (cwv) { for (var i3 = 7; i3 >= 0; i3--) bits.push((cwv >> i3) & 1); });
    var bi = 0, up = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;                                            /* 타이밍 열 건너뛰기 */
      for (var n = 0; n < size; n++) {
        var row = up ? size - 1 - n : n;
        for (var s = 0; s < 2; s++) {
          var cc2 = col - s;
          if (reserved[row][cc2]) continue;
          var bit = bi < bits.length ? bits[bi++] : 0;
          if (maskFn(mask, row, cc2)) bit ^= 1;
          m[row][cc2] = bit;
        }
      }
      up = !up;
    }
    /* 포맷 정보 (EC M = 00) */
    var fmt = ((0 << 3) | mask), rem = fmt;
    for (var q = 0; q < 10; q++) rem = (rem << 1) ^ (((rem >> 9) & 1) * 0x537);
    var format = ((fmt << 10) | rem) ^ 0x5412;
    for (var z = 0; z < 15; z++) {
      /* 규격은 MSB(비트14)부터 배치한다 — LSB 부터 넣으면 마스크가 회문일 때만 우연히 맞는다 */
      var bitv = (format >> (14 - z)) & 1;
      if (z < 6) m[8][z] = bitv;
      else if (z < 8) m[8][z + 1] = bitv;
      else if (z === 8) m[7][8] = bitv;
      else m[14 - z][8] = bitv;

      if (z < 8) m[size - 1 - z][8] = bitv;
      else m[8][size - 15 + z] = bitv;
    }
    return m;
  }

  function maskFn(k, r, c) {
    switch (k) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return (r * c) % 2 + (r * c) % 3 === 0;
      case 6: return ((r * c) % 2 + (r * c) % 3) % 2 === 0;
      default: return ((r + c) % 2 + (r * c) % 3) % 2 === 0;
    }
  }

  /* 마스크 평가 — 규격의 4가지 감점 규칙 */
  function penalty(m) {
    var n = m.length, p = 0, i, j, run, dark = 0;
    for (i = 0; i < n; i++) {
      run = 1;
      for (j = 1; j < n; j++) {
        if (m[i][j] === m[i][j - 1]) { run++; } else { if (run >= 5) p += run - 2; run = 1; }
      }
      if (run >= 5) p += run - 2;
    }
    for (j = 0; j < n; j++) {
      run = 1;
      for (i = 1; i < n; i++) {
        if (m[i][j] === m[i - 1][j]) { run++; } else { if (run >= 5) p += run - 2; run = 1; }
      }
      if (run >= 5) p += run - 2;
    }
    for (i = 0; i < n - 1; i++) for (j = 0; j < n - 1; j++) {
      var v0 = m[i][j];
      if (v0 === m[i][j + 1] && v0 === m[i + 1][j] && v0 === m[i + 1][j + 1]) p += 3;
    }
    var pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    function hit(get) {
      for (var k = 0; k < pat.length; k++) if (get(k) !== pat[k]) return false;
      return true;
    }
    for (i = 0; i < n; i++) for (j = 0; j + 11 <= n; j++) {
      if (hit(function (k) { return m[i][j + k]; })) p += 40;
      if (hit(function (k) { return m[j + k][i]; })) p += 40;
    }
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) if (m[i][j]) dark++;
    p += Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10;
    return p;
  }

  function matrix(text) {
    var bytes = utf8(text), v = 0;
    for (var i = 1; i <= 10; i++) {
      var header = 4 + (i < 10 ? 8 : 16);
      if (bytes.length * 8 + header <= dataCapacity(i) * 8) { v = i; break; }
    }
    if (!v) return null;                       /* 213자 초과 — 버전 표를 늘려야 한다 */
    var cw = buildCodewords(bytes, v), best = null, bestP = Infinity;
    for (var k = 0; k < 8; k++) {
      var m = place(v, cw, k), pen = penalty(m);
      if (pen < bestP) { bestP = pen; best = m; }
    }
    return best;
  }

  function draw(canvas, text, opts) {
    opts = opts || {};
    var m = matrix(text);
    if (!m || !canvas) return false;
    var quiet = opts.quiet == null ? 2 : opts.quiet;
    var n = m.length + quiet * 2;
    var dpr = Math.min(global.devicePixelRatio || 1, 3);
    var cssSize = opts.size || canvas.clientWidth || 120;
    var scale = Math.max(1, Math.floor((cssSize * dpr) / n));
    var px = n * scale;
    canvas.width = px; canvas.height = px;
    canvas.style.width = cssSize + 'px'; canvas.style.height = cssSize + 'px';
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.bg || '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = opts.fg || '#0a0a0c';
    for (var r = 0; r < m.length; r++) for (var c = 0; c < m.length; c++) {
      if (m[r][c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
    }
    return true;
  }

  global.ArgoQR = { draw: draw, matrix: matrix };
})(window);
