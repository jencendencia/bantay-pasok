// Generates the app icon used by the taskbar, the desktop/Start-menu shortcuts
// and the installer:
//   build/icon.png  1024²  (installer art, in-app use)
//   build/icon.ico  16–256 px, 32-bit DIB entries (Windows icon)
//
// The mark is a deep-green rounded tile with a white checkmark and a yellow
// alert dot (attendance recorded + parent notified). Shapes are drawn from
// signed distances, so the same geometry stays crisp at 16 px and at 1024 px.
// Pure Node: the PNG and the ICO are encoded by hand.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TOP = [0x33, 0x9c, 0x69];    // #339c69
const BOTTOM = [0x0d, 0x3a, 0x2b]; // #0d3a2b
const WHITE = [0xff, 0xff, 0xff];
const YELLOW = [0xf3, 0xc7, 0x4c]; // --yellow

// Shape in unit space (0..1 of the icon).
const TILE_INSET = 0.03;   // transparent margin around the tile
const TILE_RADIUS = 0.215;
const CHECK = [[0.225, 0.565], [0.41, 0.735], [0.70, 0.425]];
const CHECK_W = 0.12;
const DOT = { x: 0.795, y: 0.235, r: 0.068 };

const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const PNG_SIZE = 1024;

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Shortest distance from a point to a line segment. */
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Paints the tile, the checkmark and the dot into a top-down RGBA buffer. */
function render(size) {
  const px = new Uint8ClampedArray(size * size * 4);
  const half = (size * (1 - 2 * TILE_INSET)) / 2;
  const radius = TILE_RADIUS * size;
  const mid = size / 2;
  const halfW = (CHECK_W * size) / 2;
  const [a, b, c] = CHECK.map(([x, y]) => [x * size, y * size]);
  const dotR = DOT.r * size, dotX = DOT.x * size, dotY = DOT.y * size;
  const gradientSpan = size * (1 - 2 * TILE_INSET);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const X = x + 0.5, Y = y + 0.5;

      // Rounded-square tile: distance to the rounded rect, one pixel of AA.
      const qx = Math.abs(X - mid) - (half - radius);
      const qy = Math.abs(Y - mid) - (half - radius);
      const tileD = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
      const tileA = clamp01(0.5 - tileD);

      let r = 0, g = 0, bl = 0, alpha = 0;
      if (tileA > 0) {
        const t = clamp01((Y - size * TILE_INSET) / gradientSpan);
        r = lerp(TOP[0], BOTTOM[0], t);
        g = lerp(TOP[1], BOTTOM[1], t);
        bl = lerp(TOP[2], BOTTOM[2], t);
        alpha = tileA;
      }

      // Checkmark: capsule around the two segments, so the caps come out round.
      const checkD = Math.min(
        distToSeg(X, Y, a[0], a[1], b[0], b[1]),
        distToSeg(X, Y, b[0], b[1], c[0], c[1])
      ) - halfW;
      const checkA = clamp01(0.5 - checkD);
      if (checkA > 0) {
        const outA = checkA + alpha * (1 - checkA);
        if (outA > 0) {
          r = (WHITE[0] * checkA + r * alpha * (1 - checkA)) / outA;
          g = (WHITE[1] * checkA + g * alpha * (1 - checkA)) / outA;
          bl = (WHITE[2] * checkA + bl * alpha * (1 - checkA)) / outA;
          alpha = outA;
        }
      }

      // Alert dot in the top-right corner.
      const dotA = clamp01(0.5 - (Math.hypot(X - dotX, Y - dotY) - dotR));
      if (dotA > 0) {
        const outA = dotA + alpha * (1 - dotA);
        if (outA > 0) {
          r = (YELLOW[0] * dotA + r * alpha * (1 - dotA)) / outA;
          g = (YELLOW[1] * dotA + g * alpha * (1 - dotA)) / outA;
          bl = (YELLOW[2] * dotA + bl * alpha * (1 - dotA)) / outA;
          alpha = outA;
        }
      }

      const o = (y * size + x) * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = bl;
      px[o + 3] = alpha * 255;
    }
  }
  return px;
}

// ── PNG encoding ──────────────────────────────────────────────────────────
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ── ICO encoding (32-bit BGRA DIB per size, as Windows expects) ───────────
function dib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND halves
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(size * size * 4, 20);

  const xor = Buffer.alloc(size * size * 4);
  const maskStride = Math.ceil(size / 32) * 4;
  const and = Buffer.alloc(maskStride * size);
  for (let y = 0; y < size; y++) {
    const srcRow = size - 1 - y; // DIB rows are bottom-up
    for (let x = 0; x < size; x++) {
      const si = (srcRow * size + x) * 4;
      const di = (y * size + x) * 4;
      xor[di] = rgba[si + 2];
      xor[di + 1] = rgba[si + 1];
      xor[di + 2] = rgba[si];
      xor[di + 3] = rgba[si + 3];
      if (rgba[si + 3] === 0) and[y * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, xor, and]);
}

function encodeIco(sizes) {
  const images = sizes.map(size => dib(size, render(size)));
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(1, 2); // type: icon
  dir.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map((data, i) => {
    const size = sizes[i];
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([dir, ...entries, ...images]);
}

/**
 * Builds/icon-preview.png: every ICO size at 2× on a light and a dark strip,
 * so the small sizes can be judged at a glance. Only written with --preview.
 */
function preview(sizes) {
  const SCALE = 2, PAD = 14, ROW_H = 256 * SCALE;
  const width = PAD + sizes.reduce((w, s) => w + s * SCALE + PAD, 0);
  const height = PAD * 3 + ROW_H * 2;
  const sheet = new Uint8ClampedArray(width * height * 4);
  const bands = [[0xf2, 0xf7, 0xf4], [0x16, 0x24, 0x1f]];
  bands.forEach((band, row) => {
    const top = PAD + row * (ROW_H + PAD);
    for (let y = top; y < top + ROW_H; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        sheet[o] = band[0]; sheet[o + 1] = band[1]; sheet[o + 2] = band[2]; sheet[o + 3] = 255;
      }
    }
    let left = PAD;
    for (const size of sizes) {
      const icon = render(size);
      for (let y = 0; y < size * SCALE; y++) {
        for (let x = 0; x < size * SCALE; x++) {
          const src = ((y / SCALE) | 0) * size + ((x / SCALE) | 0);
          const dst = ((top + y) * width + left + x) * 4;
          const sa = icon[src * 4 + 3] / 255;
          for (let c = 0; c < 3; c++) {
            sheet[dst + c] = Math.round(icon[src * 4 + c] * sa + sheet[dst + c] * (1 - sa));
          }
        }
      }
      left += size * SCALE + PAD;
    }
  });
  const out = path.join(__dirname, '..', 'build', 'icon-preview.png');
  fs.writeFileSync(out, encodePng(width, height, sheet));
  console.log(`wrote ${out} (preview only)`);
}

function main() {
  const build = path.join(__dirname, '..', 'build');
  fs.mkdirSync(build, { recursive: true });

  const png = encodePng(PNG_SIZE, PNG_SIZE, render(PNG_SIZE));
  fs.writeFileSync(path.join(build, 'icon.png'), png);

  const ico = encodeIco(ICO_SIZES);
  fs.writeFileSync(path.join(build, 'icon.ico'), ico);

  console.log(`wrote build/icon.png (${PNG_SIZE}x${PNG_SIZE}, ${png.length} bytes)`);
  console.log(`wrote build/icon.ico (${ICO_SIZES.join(', ')} px, ${ico.length} bytes)`);
  if (process.argv.includes('--preview')) preview(ICO_SIZES);
}

main();
