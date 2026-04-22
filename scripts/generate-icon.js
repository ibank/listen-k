const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 1024;
const H = 1024;

const RADIUS = 220;
const BG_TOP = [39, 39, 43, 255];
const BG_BOT = [10, 10, 12, 255];
const WHITE = [255, 255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

const bars = [
  { x: 257, y: 442, w: 70, h: 140, r: 35 },
  { x: 367, y: 372, w: 70, h: 280, r: 35 },
  { x: 477, y: 302, w: 70, h: 420, r: 35 },
  { x: 587, y: 372, w: 70, h: 280, r: 35 },
  { x: 697, y: 442, w: 70, h: 140, r: 35 },
];

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpColor(c1, c2, t) {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
    Math.round(lerp(c1[3], c2[3], t)),
  ];
}

function roundedRectAA(x, y, x1, y1, x2, y2, r) {
  if (x < x1 - 0.5 || x > x2 + 0.5 || y < y1 - 0.5 || y > y2 + 0.5) return 0;

  let cx, cy;
  const nearL = x < x1 + r, nearR = x > x2 - r;
  const nearT = y < y1 + r, nearB = y > y2 - r;
  if (nearL && nearT) { cx = x1 + r; cy = y1 + r; }
  else if (nearR && nearT) { cx = x2 - r; cy = y1 + r; }
  else if (nearL && nearB) { cx = x1 + r; cy = y2 - r; }
  else if (nearR && nearB) { cx = x2 - r; cy = y2 - r; }
  else return 1;

  const dx = x - cx, dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= r - 0.5) return 1;
  if (dist >= r + 0.5) return 0;
  return r + 0.5 - dist;
}

function blend(over, under) {
  const a = over[3] / 255;
  const na = 1 - a;
  return [
    Math.round(over[0] * a + under[0] * na),
    Math.round(over[1] * a + under[1] * na),
    Math.round(over[2] * a + under[2] * na),
    Math.round(255 - (255 - over[3]) * (255 - under[3]) / 255),
  ];
}

const raw = Buffer.alloc(W * H * 4 + H);
let p = 0;

for (let y = 0; y < H; y++) {
  raw[p++] = 0;
  for (let x = 0; x < W; x++) {
    const mainAA = roundedRectAA(x + 0.5, y + 0.5, 0, 0, W - 1, H - 1, RADIUS);

    if (mainAA <= 0) {
      raw[p++] = 0; raw[p++] = 0; raw[p++] = 0; raw[p++] = 0;
      continue;
    }

    const t = y / (H - 1);
    let base = lerpColor(BG_TOP, BG_BOT, t);

    let barAA = 0;
    for (const b of bars) {
      const aa = roundedRectAA(x + 0.5, y + 0.5, b.x, b.y, b.x + b.w - 1, b.y + b.h - 1, b.r);
      if (aa > barAA) barAA = aa;
      if (barAA >= 1) break;
    }

    if (barAA > 0) {
      const white = [WHITE[0], WHITE[1], WHITE[2], Math.round(255 * barAA)];
      base = blend(white, base);
    }

    const finalAlpha = Math.round(base[3] * mainAA);
    raw[p++] = base[0];
    raw[p++] = base[1];
    raw[p++] = base[2];
    raw[p++] = finalAlpha;
  }
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    let c = (crc ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeBuf, data]));
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'icon.png');
fs.writeFileSync(outPath, png);
console.log(`icon written: ${outPath} (${png.length} bytes, ${W}x${H})`);
