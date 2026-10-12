const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) c = 0xedb88320 ^ (c >>> 1);
      else c = c >>> 1;
    }
    crcTable[n] = c;
  }

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = data.length;
    const buf = Buffer.alloc(4 + 4 + len + 4);
    buf.writeUInt32BE(len, 0);
    buf.write(type, 4);
    data.copy(buf, 8);
    const crc = crc32(Buffer.concat([Buffer.from(type), data]));
    buf.writeUInt32BE(crc, 8 + len);
    return buf;
  }

  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowSize);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - 64;
      const dy = y - 64;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (Math.abs(dx) < 56 && Math.abs(dy) < 56 && dist < 66) {
        const t = (x + y) / 256;
        let r = Math.round(59 + t * 40);
        let g = Math.round(130 + t * 50);
        let b = Math.round(246 - t * 30);
        let a = 255;

        // monitor border
        const isMonitor = (
          ((x >= 32 && x <= 96) && (y === 32 || y === 33 || y === 76 || y === 77)) ||
          ((y >= 32 && y <= 77) && (x === 32 || x === 33 || x === 95 || x === 96))
        );
        const isStand = (x >= 61 && x <= 67 && y >= 77 && y <= 87);
        const isBase = (x >= 48 && x <= 80 && y >= 87 && y <= 91);
        const eyeDist = Math.sqrt((x - 64) * (x - 64) + (y - 54) * (y - 54));
        const isEye = eyeDist <= 8;

        if (isMonitor || isStand || isBase || isEye) {
          r = 255; g = 255; b = 255; a = 255;
        }

        rawData[pxOffset] = r;
        rawData[pxOffset + 1] = g;
        rawData[pxOffset + 2] = b;
        rawData[pxOffset + 3] = a;
      } else {
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const outPath = path.join(__dirname, '..', 'extension', 'icon128.png');
const png = createPng(128, 128);
fs.writeFileSync(outPath, png);
console.log(`Generated icon128.png at ${outPath} (${png.length} bytes)`);
