// Build-time placeholder sprite generator.
//
// Draws a 16x16 pixel cat in *indexed grayscale* (each gray value is a
// palette index — see INDEX_GRAY) and writes:
//   src/renderer/public/sprites/cat.png   — one-row sprite sheet
//   src/renderer/public/sprites/cat.json  — Aseprite-format manifest
//
// The manifest matches Aseprite's "Array" JSON export (frames + meta.frameTags)
// so real art exported from Aseprite can replace these files without any
// renderer changes.
//
// No dependencies: the PNG is encoded by hand using node:zlib for the IDAT.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 16;

// Palette indices. The renderer maps INDEX_GRAY values back to colors.
// 0 transparent, 1 outline, 2 fur, 3 dark fur, 4 white patch, 5 pink,
// 6 gray (keycap sides — constant across palettes)
const CHAR_TO_INDEX = { '.': 0, K: 1, O: 2, D: 3, W: 4, P: 5, G: 6 };
export const INDEX_GRAY = [0, 30, 170, 110, 240, 200, 80];

// ---------------------------------------------------------------------------
// Pixel-buffer helpers
// ---------------------------------------------------------------------------

function parseMap(lines, subs = {}) {
  if (lines.length !== SIZE) {
    throw new Error(`map has ${lines.length} rows, expected ${SIZE}`);
  }
  const buf = new Uint8Array(SIZE * SIZE);
  lines.forEach((line, y) => {
    if (line.length !== SIZE) {
      throw new Error(`row ${y} has ${line.length} chars, expected ${SIZE}: "${line}"`);
    }
    for (let x = 0; x < SIZE; x++) {
      const ch = line[x];
      let idx = CHAR_TO_INDEX[ch];
      if (idx === undefined) idx = subs[ch];
      if (idx === undefined) {
        throw new Error(`unknown char '${ch}' at ${x},${y} with no substitution`);
      }
      buf[y * SIZE + x] = idx;
    }
  });
  return buf;
}

const copy = (buf) => Uint8Array.from(buf);

function setPx(buf, x, y, idx) {
  buf[y * SIZE + x] = idx;
}

function shiftX(buf, dx) {
  const out = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const sx = x - dx;
      out[y * SIZE + x] = sx >= 0 && sx < SIZE ? buf[y * SIZE + sx] : 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Poses (16 chars per row; markers: e=eye, c=closed eye, 1/2=tail A/B)
// ---------------------------------------------------------------------------

// Chibi sitting cat: big round head, small body, 2px-tall eyes (E upper /
// e lower), pink blush cheeks, tiny nose (P) + mouth (K).
const SIT = [
  '................',
  '..K.........K...',
  '..KK.......KK...',
  '..KPK.....KPK...',
  '..KOOOOOOOOOK...',
  '.KOEEOOOOEEOOK..',
  '.KOeeOOPOeeOOK..',
  '.KPOOOOKOOOOPK..',
  '.KOOOOOOOOOOOK..',
  '..KOOOOOOOOOK...',
  '..KOOOOOOOOOK...',
  '..KOWWOOOOOOK.1.',
  '..KOWWOOOOOOK.1.',
  '..KOOOOOOOOOK12.',
  '..KOKOOKOKOOK.2.',
  '...KKKKKKKKK....'
];

// Bongo-style typing: chibi cat behind two chunky 3D keycaps.
// Paws (down on a key / raised beside the body) are stamped per frame.
const TYPING_BASE = [
  '..K.........K...',
  '..KK.......KK...',
  '..KPK.....KPK...',
  '..KOOOOOOOOOK...',
  '.KOOOOOOOOOOOK..',
  '.KOEEOOOOEEOOK..',
  '.KOeeOOPOeeOOK..',
  '.KPOOOOKOOOOPK..',
  '.KOOOOOOOOOOOK..',
  '..KOOOOOOOOOK...',
  '.KKKKKKK.KKKKKK.',
  '.KWWWWWK.KWWWWK.',
  '.KWWWWWK.KWWWWK.',
  '.KGGGGGK.KGGGGK.',
  '.KGGGGGK.KGGGGK.',
  '.KKKKKKK.KKKKKK.'
];

const STAND = [
  '................',
  '..K.....K.......',
  '..KK...KK.......',
  '..KPK.KPK.......',
  '..KOOOOOK.......',
  '.KOOOOOOOK......',
  '.KOeOOOOOK......',
  '.KPOOOOOOKKKKK..',
  '.KOOOOOOOOOOOKK1',
  '..KOOOOOOOOOOOK1',
  '..KOOOOOOOOOOOK2',
  '..KOOOOOOOOOOK2.',
  '...KOOOOOOOOK...',
  '................',
  '................',
  '................'
];

const LIE_A = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '...KK...........',
  '..KOOKKKKKKK....',
  '.KOOOOOOOOOOKK1.',
  '.KOcOOOOOOOOOK1.',
  '.KOOPOOOOOOOOK2.',
  '.KOOOOOOOOOOOOK.',
  '..KKKKKKKKKKKK..'
];

const LIE_B = LIE_A.map((row, y) => (y === 9 ? '....KK..........' : row));

const STRETCH = [
  '................',
  '................',
  '................',
  '..........KKK.1.',
  '.........KOOOK1.',
  '........KOOOOK2.',
  '.......KOOOOOK..',
  '......KOOOOOOK..',
  '..K..KOOOOOOK...',
  '..KKKOOOOOOK....',
  '..KPOOOOOOK.....',
  '.KOeOOOOOK......',
  '.KOOOOOOK.......',
  '.KPOOOOOK.......',
  '.KOOKOOKK.......',
  '..KKKKKK........'
];

// Eye / tail substitution shorthands.
// E = upper eye pixel (visible only when open), e = lower eye pixel (always
// dark — doubles as the closed-lid line), c = always-dark sleeping eye.
const EYES_OPEN = { E: 1, e: 1, c: 1 };
const EYES_CLOSED = { E: 2, e: 1, c: 1 };
const TAIL_A = { 1: 3, 2: 0 };
const TAIL_B = { 1: 0, 2: 3 };

function sit(opts = {}) {
  return parseMap(SIT, { ...EYES_OPEN, ...TAIL_A, ...opts });
}

// Dangling body used for dragged/falling: sit pose with hanging legs.
function dangle(splayed) {
  const buf = parseMap(
    SIT.slice(0, 13).concat(['..KOOOOOOOOOK...', '................', '................']),
    { ...EYES_OPEN, 1: 3, 2: 0 }
  );
  if (!splayed) {
    setPx(buf, 4, 14, 2);
    setPx(buf, 9, 14, 2);
    setPx(buf, 4, 15, 1);
    setPx(buf, 9, 15, 1);
  } else {
    setPx(buf, 3, 14, 2);
    setPx(buf, 10, 14, 2);
    setPx(buf, 2, 15, 1);
    setPx(buf, 11, 15, 1);
  }
  return buf;
}

// Bongo typing frame. side: 'left' | 'right' (which paw is DOWN) or 'both'.
function bongoFrame(side) {
  const buf = parseMap(TYPING_BASE, EYES_OPEN);
  const leftDown = side === 'left' || side === 'both';
  const rightDown = side === 'right' || side === 'both';
  if (leftDown) {
    // paw pressing the left keycap
    setPx(buf, 3, 11, 2);
    setPx(buf, 4, 11, 2);
  } else {
    // raised beside the body
    setPx(buf, 0, 8, 2);
    setPx(buf, 1, 8, 2);
  }
  if (rightDown) {
    setPx(buf, 11, 11, 2);
    setPx(buf, 12, 11, 2);
  } else {
    setPx(buf, 13, 8, 2);
    setPx(buf, 14, 8, 2);
  }
  return buf;
}

// Legs for the STAND pose. Four legs; per-frame column offsets fake a gait.
function standWithLegs(frontShift, backShift) {
  const buf = parseMap(STAND, { ...EYES_OPEN, ...TAIL_A });
  const legs = [
    { x: 3 + frontShift, back: false },
    { x: 6 - frontShift, back: false },
    { x: 9 + backShift, back: true },
    { x: 12 - backShift, back: true }
  ];
  for (const leg of legs) {
    setPx(buf, leg.x, 13, 2);
    setPx(buf, leg.x + 1, 13, 2);
    setPx(buf, leg.x, 14, 2);
    setPx(buf, leg.x + 1, 14, 2);
    setPx(buf, leg.x, 15, 1);
    setPx(buf, leg.x + 1, 15, 1);
  }
  return buf;
}

function alertPose() {
  const buf = sit();
  // Taller ears: extend tips one row up.
  setPx(buf, 2, 0, 1);
  setPx(buf, 12, 0, 1);
  // Extra-wide eyes: 3px tall.
  setPx(buf, 3, 7, 1);
  setPx(buf, 4, 7, 1);
  setPx(buf, 9, 7, 1);
  setPx(buf, 10, 7, 1);
  return buf;
}

// ---------------------------------------------------------------------------
// Animation table: name -> frames [{ buf, duration(ms) }]
// ---------------------------------------------------------------------------

const ANIMATIONS = [
  ['idle', [
    { buf: sit(TAIL_A), duration: 900 },
    { buf: sit(TAIL_B), duration: 900 }
  ]],
  ['blink', [
    { buf: sit(EYES_CLOSED), duration: 120 }
  ]],
  ['sit', [
    { buf: sit(TAIL_A), duration: 350 },
    { buf: sit(TAIL_B), duration: 350 }
  ]],
  ['walk', [
    { buf: standWithLegs(0, 0), duration: 140 },
    { buf: standWithLegs(1, -1), duration: 140 },
    { buf: standWithLegs(0, 0), duration: 140 },
    { buf: standWithLegs(-1, 1), duration: 140 }
  ]],
  ['run', [
    { buf: standWithLegs(0, 0), duration: 70 },
    { buf: standWithLegs(1, -1), duration: 70 },
    { buf: standWithLegs(0, 0), duration: 70 },
    { buf: standWithLegs(-1, 1), duration: 70 }
  ]],
  ['sleep', [
    { buf: parseMap(LIE_A, { ...EYES_CLOSED, ...TAIL_A }), duration: 1000 },
    { buf: parseMap(LIE_B, { ...EYES_CLOSED, ...TAIL_B }), duration: 1000 }
  ]],
  ['chase', [
    { buf: standWithLegs(0, 0), duration: 70 },
    { buf: standWithLegs(1, -1), duration: 70 },
    { buf: standWithLegs(0, 0), duration: 70 },
    { buf: standWithLegs(-1, 1), duration: 70 }
  ]],
  ['dragged', [
    { buf: dangle(false), duration: 200 }
  ]],
  ['falling', [
    { buf: dangle(false), duration: 100 },
    { buf: dangle(true), duration: 100 }
  ]],
  ['typing', [
    { buf: bongoFrame('left'), duration: 110 },
    { buf: bongoFrame('right'), duration: 110 }
  ]],
  ['overheat', [
    { buf: shiftX(bongoFrame('both'), -1), duration: 80 },
    { buf: shiftX(bongoFrame('both'), 1), duration: 80 }
  ]],
  ['stretch', [
    { buf: parseMap(STRETCH, { ...EYES_CLOSED, ...TAIL_A }), duration: 500 },
    { buf: parseMap(STRETCH, { ...EYES_CLOSED, ...TAIL_B }), duration: 500 }
  ]],
  ['alert', [
    { buf: alertPose(), duration: 250 },
    { buf: sit(), duration: 250 }
  ]],
  ['purr', [
    { buf: sit({ ...EYES_CLOSED, ...TAIL_A }), duration: 300 },
    { buf: sit({ ...EYES_CLOSED, ...TAIL_B }), duration: 300 }
  ]]
];

// ---------------------------------------------------------------------------
// PNG encoder (RGBA8888, filter 0, no interlace)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// ---------------------------------------------------------------------------
// Assemble sheet + manifest
// ---------------------------------------------------------------------------

const allFrames = [];
const frameTags = [];
for (const [name, frames] of ANIMATIONS) {
  const from = allFrames.length;
  for (const f of frames) allFrames.push(f);
  frameTags.push({ name, from, to: allFrames.length - 1, direction: 'forward' });
}

const sheetWidth = allFrames.length * SIZE;
const rgba = Buffer.alloc(sheetWidth * SIZE * 4);
allFrames.forEach((frame, i) => {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = frame.buf[y * SIZE + x];
      const off = (y * sheetWidth + i * SIZE + x) * 4;
      const gray = INDEX_GRAY[idx];
      rgba[off] = gray;
      rgba[off + 1] = gray;
      rgba[off + 2] = gray;
      rgba[off + 3] = idx === 0 ? 0 : 255;
    }
  }
});

const manifest = {
  frames: allFrames.map((f, i) => ({
    filename: `cat ${i}.aseprite`,
    frame: { x: i * SIZE, y: 0, w: SIZE, h: SIZE },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: SIZE, h: SIZE },
    sourceSize: { w: SIZE, h: SIZE },
    duration: f.duration
  })),
  meta: {
    app: 'pixelpal-sprite-generator',
    image: 'cat.png',
    format: 'RGBA8888',
    size: { w: sheetWidth, h: SIZE },
    scale: '1',
    frameTags
  }
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/public/sprites');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'cat.png'), encodePng(sheetWidth, SIZE, rgba));
writeFileSync(join(outDir, 'cat.json'), JSON.stringify(manifest, null, 2));

// ---------------------------------------------------------------------------
// Tray icon: the sitting cat, colored, upscaled 2x to 32x32
// ---------------------------------------------------------------------------

const TRAY_COLORS = [
  [0, 0, 0, 0],
  [26, 26, 36, 255], // outline
  [245, 169, 98, 255], // fur
  [217, 126, 66, 255], // dark fur
  [255, 247, 237, 255], // white
  [247, 168, 184, 255], // pink
  [138, 143, 163, 255] // key gray
];

const trayBuf = sit();
const TRAY_SCALE = 2;
const traySize = SIZE * TRAY_SCALE;
const trayRgba = Buffer.alloc(traySize * traySize * 4);
for (let y = 0; y < traySize; y++) {
  for (let x = 0; x < traySize; x++) {
    const idx = trayBuf[Math.floor(y / TRAY_SCALE) * SIZE + Math.floor(x / TRAY_SCALE)];
    const [cr, cg, cb, ca] = TRAY_COLORS[idx] ?? [0, 0, 0, 0];
    const off = (y * traySize + x) * 4;
    trayRgba[off] = cr;
    trayRgba[off + 1] = cg;
    trayRgba[off + 2] = cb;
    trayRgba[off + 3] = ca;
  }
}
const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '../assets');
mkdirSync(assetsDir, { recursive: true });
writeFileSync(join(assetsDir, 'tray.png'), encodePng(traySize, traySize, trayRgba));

// App icon: same sitting cat at 256x256 (electron-builder converts to
// .ico / .icns per platform).
const ICON_SCALE = 16;
const iconSize = SIZE * ICON_SCALE;
const iconRgba = Buffer.alloc(iconSize * iconSize * 4);
for (let y = 0; y < iconSize; y++) {
  for (let x = 0; x < iconSize; x++) {
    const idx = trayBuf[Math.floor(y / ICON_SCALE) * SIZE + Math.floor(x / ICON_SCALE)];
    const [cr, cg, cb, ca] = TRAY_COLORS[idx] ?? [0, 0, 0, 0];
    const off = (y * iconSize + x) * 4;
    iconRgba[off] = cr;
    iconRgba[off + 1] = cg;
    iconRgba[off + 2] = cb;
    iconRgba[off + 3] = ca;
  }
}
writeFileSync(join(assetsDir, 'icon.png'), encodePng(iconSize, iconSize, iconRgba));

console.log(
  `generated ${allFrames.length} frames (${sheetWidth}x${SIZE}), ` +
    `${frameTags.length} animations -> ${outDir} (+ assets/tray.png)`
);
