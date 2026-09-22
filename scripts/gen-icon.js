// Generates build/icon.png — a green rounded square with a white checkmark
// and signal bars (attendance + parent notifications motif).
// Pure Node: builds the PNG by hand (RGBA scanlines -> zlib -> chunks).
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;
const RADIUS = 200;
const TOP = [0x2e, 0x7d, 0x32]; // #2e7d32
const BOTTOM = [0x14, 0x53, 0x2d]; // #14532d

// distance from point to segment
function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function insideRoundedRect(x, y) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return false;
  const nx = Math.max(RADIUS, Math.min(SIZE - RADIUS, x));
  const ny = Math.max(RADIUS, Math.min(SIZE - RADIUS, y));
  return (x - nx) ** 2 + (y - ny) ** 2 <= RADIUS * RADIUS;
}

// glyph strokes: [x1,y1,x2,y2,thickness]
const CHECK_W = 62;
const STROKES = [
  // checkmark
  [300, 545, 460, 700, CHECK_W],
  [460, 700, 764, 350, CHECK_W],
  // signal bars (rounded via stroke caps approximated by the segment itself)
  [306, 540, 306, 720, 54],
  [546, 400, 546, 720, 54],
  [766, 300, 766, 720, 54],
];

function coverage(px, py) {
  // 2x2 supersampling for smooth edges
  let hit = 0;
  for (const ox of [0.25, 0.75]) {
    for (const oy of [0.25, 0.75]) {
      const x = px + ox, y = py + oy;
      if (!insideRoundedRect(x, y)) continue;
      hit += 1;
      for (const [x1, y1, x2, y2, w] of STROKES) {
        if (distToSeg(x, y, x1, y1, x2, y2) <= w / 2) { hit += 3; break; }
      }
    }
  }
  return Math.min(1, hit / 8); // 0..1 coverage of white-on-green
}

function main() {
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    const row = y * (SIZE * 4 + 1);
    raw[row] = 0; // filter: none
    const t = y / (SIZE - 1);
    const bg = [0, 1, 2].map(i => Math.round(TOP[i] + (BOTTOM[i] - TOP[i]) * t));
    for (let x = 0; x < SIZE; x++) {
      const o = row + 1 + x * 4;
      const cov = coverage(x, y);
      raw[o] = Math.round(bg[0] + (255 - bg[0]) * cov);
      raw[o + 1] = Math.round(bg[1] + (255 - bg[1]) * cov);
      raw[o + 2] = Math.round(bg[2] + (255 - bg[2]) * cov);
      raw[o + 3] = 255;
    }
  }

  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = buf => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);

  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png);
  console.log(`wrote ${out} (${SIZE}x${SIZE}, ${png.length} bytes)`);
}

main();
