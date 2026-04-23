const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// macOS menubar template image. Black pixels + alpha — the system
// auto-inverts / tints / dims the image for light/dark menubars and
// hover/active states. Any colour information is ignored, so a pure
// 8-bit grayscale + alpha PNG is the cleanest wire format.
//
// Emits both 1x (16×16) and 2x (32×32) so Retina menubars stay crisp.
// Uses the same five-bar equalizer silhouette as the app icon, reduced
// to legible bar widths at 16 px: 2 px bars, 1 px gaps, heights
// 4/8/12/8/4 (matches the 1:2:3:2:1 ratio of the app icon's
// 140/280/420/280/140 bars).

const W_1X = 16;
const H_1X = 16;

// Column pairs (x,x+1) for each bar and their heights. Centred about
// y = 7.5 (between rows 7 and 8) so the taller bars grow symmetrically.
const BARS = [
  { x: 1,  h: 4  },
  { x: 4,  h: 8  },
  { x: 7,  h: 12 },
  { x: 10, h: 8  },
  { x: 13, h: 4  },
];

function makeGrayAlphaPng(scale) {
  const W = W_1X * scale;
  const H = H_1X * scale;

  // PNG colour type 4 = grayscale + alpha, 2 bytes per pixel.
  // Each scanline is prefixed with a filter byte (0 = None).
  const bytesPerRow = 1 + W * 2;
  const raw = Buffer.alloc(bytesPerRow * H);

  for (let y = 0; y < H; y++) {
    const rowStart = y * bytesPerRow;
    raw[rowStart] = 0; // filter: None

    for (let x = 0; x < W; x++) {
      // Map pixel to the 16×16 logical grid.
      const gx = Math.floor(x / scale);
      const gy = Math.floor(y / scale);

      let on = false;
      for (const b of BARS) {
        if ((gx === b.x || gx === b.x + 1)) {
          const halfH = b.h / 2;
          // y = 7.5 centre → on if gy + 0.5 within [7.5 - halfH, 7.5 + halfH]
          if (Math.abs(gy + 0.5 - 7.5) <= halfH) { on = true; break; }
        }
      }

      const off = rowStart + 1 + x * 2;
      raw[off]     = 0;                 // gray value (ignored for template — keep 0)
      raw[off + 1] = on ? 255 : 0;      // alpha: fully opaque on-pixels only
    }
  }

  return { W, H, raw };
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

function encodePng({ W, H, raw }) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8]  = 8;   // bit depth
  ihdr[9]  = 4;   // colour type: grayscale + alpha
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter
  ihdr[12] = 0;   // interlace

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });

for (const [scale, name] of [[1, 'trayIconTemplate.png'], [2, 'trayIconTemplate@2x.png']]) {
  const png = encodePng(makeGrayAlphaPng(scale));
  const outPath = path.join(outDir, name);
  fs.writeFileSync(outPath, png);
  console.log(`tray icon written: ${outPath} (${png.length} bytes, ${W_1X * scale}×${H_1X * scale})`);
}
