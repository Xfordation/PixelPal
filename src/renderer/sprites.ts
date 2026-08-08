// Sprite-sheet loading, palette swapping, and animation playback.
//
// The manifest is Aseprite's "Array" JSON export format, so placeholder art
// (from scripts/generate-sprites.mjs) and real Aseprite exports are
// interchangeable. Sprites are authored in indexed grayscale; INDEX_GRAY maps
// gray values to palette slots and `recolor` remaps them in one pixel pass.

export interface AsepriteFrame {
  frame: { x: number; y: number; w: number; h: number };
  duration: number;
}

export interface AsepriteTag {
  name: string;
  from: number;
  to: number;
  direction?: string;
  repeat?: number; // Aseprite 1.3+: finite repeat count means "don't loop"
}

export interface SpriteManifest {
  frames: AsepriteFrame[];
  meta: {
    image: string;
    size: { w: number; h: number };
    frameTags: AsepriteTag[];
  };
}

// Gray value of each palette index in the authored sprite (see generator).
// Index 0 is transparent and has no gray entry that matters.
// Index 6 is the keycap gray — the same color in every palette.
const INDEX_GRAY = [0, 30, 170, 110, 240, 200, 80];

// A palette is a color per index; index 0 is ignored (transparent).
export type Palette = { name: string; colors: string[] };

const KEY_GRAY = '#8a8fa3';

export const PALETTES: Palette[] = [
  { name: 'marmalade', colors: ['', '#1a1a24', '#f5a962', '#d97e42', '#fff7ed', '#f7a8b8', KEY_GRAY] },
  { name: 'tuxedo', colors: ['', '#101018', '#2e2e3e', '#1c1c2a', '#f2f2f2', '#f7a8b8', KEY_GRAY] },
  { name: 'seafoam', colors: ['', '#15242b', '#8fd6c7', '#5aa899', '#eefaf6', '#f2a0c0', KEY_GRAY] },
  { name: 'shadow', colors: ['', '#0d0d15', '#4b4b66', '#33334a', '#8b8bb0', '#c99', KEY_GRAY] }
];

/** Build a palette from a single user-picked fur color. */
export function makeCustomPalette(color: string): Palette {
  const [r, g, b] = hexToRgb(color);
  const darken = (v: number): number => Math.round(v * 0.72);
  const dark = `#${[darken(r), darken(g), darken(b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
  return {
    // color in the name keeps the per-palette sheet cache correct
    name: `custom-${color}`,
    colors: ['', '#1a1a24', color, dark, '#fff7ed', '#f7a8b8', KEY_GRAY]
  };
}

/** Resolve a palette by settings values. */
export function resolvePalette(name: string, customColor: string): Palette {
  if (name === 'custom') return makeCustomPalette(customColor);
  return PALETTES.find((p) => p.name === name) ?? PALETTES[0]!;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function nearestIndex(gray: number): number {
  let best = 1;
  let bestDist = Infinity;
  for (let i = 1; i < INDEX_GRAY.length; i++) {
    const d = Math.abs(gray - (INDEX_GRAY[i] ?? 0));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export class SpriteSet {
  private paletteCache = new Map<string, HTMLCanvasElement>();
  private baseData: ImageData;

  constructor(
    public readonly manifest: SpriteManifest,
    baseImage: HTMLImageElement
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = manifest.meta.size.w;
    canvas.height = manifest.meta.size.h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D context unavailable');
    ctx.drawImage(baseImage, 0, 0);
    this.baseData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  /** Recolored sheet for a palette, cached per palette name. */
  sheetFor(palette: Palette): HTMLCanvasElement {
    const cached = this.paletteCache.get(palette.name);
    if (cached) return cached;

    const { width, height } = this.baseData;
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable');

    const lut: [number, number, number][] = palette.colors.map((c) =>
      c ? hexToRgb(c) : [0, 0, 0]
    );
    const src = this.baseData.data;
    const img = ctx.createImageData(width, height);
    const dst = img.data;
    for (let i = 0; i < src.length; i += 4) {
      const alpha = src[i + 3] ?? 0;
      if (alpha === 0) continue;
      const rgb = lut[nearestIndex(src[i] ?? 0)] ?? [255, 0, 255];
      dst[i] = rgb[0];
      dst[i + 1] = rgb[1];
      dst[i + 2] = rgb[2];
      dst[i + 3] = alpha;
    }
    ctx.putImageData(img, 0, 0);
    this.paletteCache.set(palette.name, out);
    return out;
  }

  tag(name: string): AsepriteTag {
    const tag = this.manifest.meta.frameTags.find((t) => t.name === name);
    if (!tag) throw new Error(`unknown animation tag "${name}"`);
    return tag;
  }
}

export async function loadSpriteSet(basePath: string): Promise<SpriteSet> {
  const manifest = (await (await fetch(`${basePath}.json`)).json()) as SpriteManifest;
  const image = new Image();
  image.src = `${basePath}.png`;
  await image.decode();
  return new SpriteSet(manifest, image);
}

/** Plays one animation tag at a time; frame timing from the manifest. */
export class AnimationPlayer {
  private tagName = '';
  private frameIndex = 0; // absolute index into manifest.frames
  private elapsed = 0;
  private loop = true;
  private finished = false;
  onComplete: (() => void) | null = null;

  constructor(private readonly sprites: SpriteSet) {}

  get current(): string {
    return this.tagName;
  }

  play(name: string, opts: { loop?: boolean; restart?: boolean } = {}): void {
    if (name === this.tagName && !opts.restart) return;
    const tag = this.sprites.tag(name);
    this.tagName = name;
    this.frameIndex = tag.from;
    this.elapsed = 0;
    this.loop = opts.loop ?? true;
    this.finished = false;
  }

  update(dtMs: number): void {
    if (!this.tagName || this.finished) return;
    const tag = this.sprites.tag(this.tagName);
    this.elapsed += dtMs;
    let frame = this.sprites.manifest.frames[this.frameIndex];
    while (frame && this.elapsed >= frame.duration) {
      this.elapsed -= frame.duration;
      this.frameIndex++;
      if (this.frameIndex > tag.to) {
        if (this.loop) {
          this.frameIndex = tag.from;
        } else {
          this.frameIndex = tag.to;
          this.finished = true;
          this.onComplete?.();
          break;
        }
      }
      frame = this.sprites.manifest.frames[this.frameIndex];
    }
  }

  /**
   * Draw the current frame. (x, y) is the top-left corner in destination
   * pixels; size is frameSize * scale. flipX mirrors around the center.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    palette: Palette,
    x: number,
    y: number,
    scale: number,
    flipX = false
  ): void {
    const frame = this.sprites.manifest.frames[this.frameIndex];
    if (!frame) return;
    const sheet = this.sprites.sheetFor(palette);
    const { x: sx, y: sy, w, h } = frame.frame;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (flipX) {
      ctx.translate(x + (w * scale) / 2, 0);
      ctx.scale(-1, 1);
      ctx.translate(-(x + (w * scale) / 2), 0);
    }
    ctx.drawImage(sheet, sx, sy, w, h, x, y, w * scale, h * scale);
    ctx.restore();
  }
}
