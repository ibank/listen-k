const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// DMG volume / .dmg file icon. Deliberately uses the inverse palette of the
// app icon (silver-metallic background + dark bars) so Finder shows the
// installer and the installed app as visually distinct, while the shared
// equalizer motif keeps brand recognition intact.
const W = 1024;
const H = 1024;

const RADIUS = 220;
const BG_TOP = [236, 236, 240, 255];
const BG_BOT = [176, 176, 184, 255];
const BAR = [28, 28, 32, 255];
const RING = [255, 255, 255, 180];
const RING_SHADOW = [0, 0, 0, 45];
const TRANSPARENT = [0, 0, 0, 0];

// Same five-bar equalizer positions as the app icon — deliberate so the
// installer reads as the same product, just in its "disk" dress.
const bars = [
  { x: 257, y: 442, w: 70, h: 140, r: 35 },
  { x: 367, y: 372, w: 70, h: 280, r: 35 },
  { x: 477, y: 302, w: 70, h: 420, r: 35 },
  { x: 587, y: 372, w: 70, h: 280, r: 35 },
  { x: 697, y: 442, w: 70, h: 140, r: 35 },
];

// Inner chrome ring at 48 px inset — a subtle "mounted volume" cue. Drawn as
// a 3 px stroke with a 1 px dark inner shadow directly below so it reads as
// an etched bezel rather than a flat outline.
const RING_INSET = 48;
const RING_RADIUS = RADIUS - RING_INSET;
const RING_STROKE = 3;

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

// Coverage of the *outline* (hollow rounded rect) of the given stroke width.
// Used for the chrome bezel: aa>0 only in the stroke band, 0 inside and out.
function roundedRectStrokeAA(x, y, x1, y1, x2, y2, r, stroke) {
  const outer = roundedRectAA(x, y, x1, y1, x2, y2, r);
  if (outer <= 0) return 0;
  const inner = roundedRectAA(
    x, y,
    x1 + stroke, y1 + stroke,
    x2 - stroke, y2 - stroke,
    Math.max(0, r - stroke),
  );
  return Math.max(0, outer - inner);
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
    const px = x + 0.5;
    const py = y + 0.5;
    const mainAA = roundedRectAA(px, py, 0, 0, W - 1, H - 1, RADIUS);

    if (mainAA <= 0) {
      raw[p++] = 0; raw[p++] = 0; raw[p++] = 0; raw[p++] = 0;
      continue;
    }

    const t = y / (H - 1);
    let base = lerpColor(BG_TOP, BG_BOT, t);

    // Chrome ring — drop shadow first (1 px lower), then highlight stroke on top.
    const shadowAA = roundedRectStrokeAA(
      px, py - 1,
      RING_INSET, RING_INSET,
      W - 1 - RING_INSET, H - 1 - RING_INSET,
      RING_RADIUS, RING_STROKE,
    );
    if (shadowAA > 0) {
      const ink = [RING_SHADOW[0], RING_SHADOW[1], RING_SHADOW[2], Math.round(RING_SHADOW[3] * shadowAA)];
      base = blend(ink, base);
    }
    const ringAA = roundedRectStrokeAA(
      px, py,
      RING_INSET, RING_INSET,
      W - 1 - RING_INSET, H - 1 - RING_INSET,
      RING_RADIUS, RING_STROKE,
    );
    if (ringAA > 0) {
      const ink = [RING[0], RING[1], RING[2], Math.round(RING[3] * ringAA)];
      base = blend(ink, base);
    }

    let barAA = 0;
    for (const b of bars) {
      const aa = roundedRectAA(px, py, b.x, b.y, b.x + b.w - 1, b.y + b.h - 1, b.r);
      if (aa > barAA) barAA = aa;
      if (barAA >= 1) break;
    }

    if (barAA > 0) {
      const ink = [BAR[0], BAR[1], BAR[2], Math.round(255 * barAA)];
      base = blend(ink, base);
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
const outPath = path.join(outDir, 'dmg-icon.png');
fs.writeFileSync(outPath, png);
console.log(`dmg icon written: ${outPath} (${png.length} bytes, ${W}x${H})`);
