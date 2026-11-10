// Renders the toolbar icons (Markdown mark on a lobster-red tile) to PNG with
// no dependencies. Run: node tools/make-icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const M = [[16, 92], [16, 36], [30, 36], [45, 56], [60, 36], [74, 36], [74, 92], [60, 92], [60, 60], [45, 80], [30, 60], [30, 92]];
const ARROW = [[90, 36], [104, 36], [104, 62], [116, 62], [97, 92], [78, 62], [90, 62]];

function inPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inTile(x, y) {
  const r = 26, lo = 4, hi = 124;
  if (x < lo || x > hi || y < lo || y > hi) return false;
  const cx = x < lo + r ? lo + r : x > hi - r ? hi - r : x;
  const cy = y < lo + r ? lo + r : y > hi - r ? hi - r : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function render(size) {
  const SS = 4; // supersampling
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let tile = 0, glyph = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) * 128) / size;
          const y = ((py + (sy + 0.5) / SS) * 128) / size;
          if (inTile(x, y)) {
            tile++;
            if (inPoly(M, x, y) || inPoly(ARROW, x, y)) glyph++;
          }
        }
      }
      const n = SS * SS;
      const g = tile ? glyph / tile : 0;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      raw[o] = Math.round(0xd9 + (0xff - 0xd9) * g);
      raw[o + 1] = Math.round(0x45 + (0xff - 0x45) * g);
      raw[o + 2] = Math.round(0x3b + (0xff - 0x3b) * g);
      raw[o + 3] = Math.round((tile / n) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, '..', 'extension', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(out, `icon-${size}.png`), render(size));
  console.log(`icon-${size}.png`);
}
