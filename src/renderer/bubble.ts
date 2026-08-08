// Pixel-style speech bubble rendered above the cat's head.
// A timed bubble (reminder) temporarily overrides the pinned note.

const FONT = '10px "Courier New", monospace';
const LINE_H = 12;
const PAD = 6;
const MAX_TEXT_WIDTH = 190;

export class SpeechBubble {
  private pinned: string | null = null;
  private timed: string | null = null;
  private timedUntil = 0;

  setPinned(text: string | null): void {
    this.pinned = text;
  }

  showTimed(text: string, durationMs: number): void {
    this.timed = text;
    this.timedUntil = performance.now() + durationMs;
  }

  update(): void {
    if (this.timed && performance.now() >= this.timedUntil) {
      this.timed = null;
    }
  }

  get visible(): boolean {
    return this.timed !== null || this.pinned !== null;
  }

  /**
   * Draw the bubble with its tail tip at (tailX, tailY), growing upward.
   */
  draw(ctx: CanvasRenderingContext2D, tailX: number, tailY: number): void {
    const text = this.timed ?? this.pinned;
    if (!text) return;

    ctx.font = FONT;
    const lines = wrapText(ctx, text, MAX_TEXT_WIDTH);
    const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width), 20);
    const w = Math.ceil(textWidth) + PAD * 2;
    const h = lines.length * LINE_H + PAD * 2;
    const x = Math.round(Math.min(Math.max(tailX - w / 2, 2), ctx.canvas.width - w - 2));
    const y = Math.round(tailY - h - 8);

    // bubble body (pixel-style: sharp rect + notched corners)
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = '#fffef2';
    ctx.fillRect(x, y, w, h);
    // corner notches to fake rounded pixels
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(x, y, 2, 2);
    ctx.fillRect(x + w - 2, y, 2, 2);
    ctx.fillRect(x, y + h - 2, 2, 2);
    ctx.fillRect(x + w - 2, y + h - 2, 2, 2);

    // tail
    ctx.fillStyle = '#1a1a24';
    ctx.fillRect(tailX - 4, y + h + 2, 8, 2);
    ctx.fillRect(tailX - 2, y + h + 4, 6, 2);
    ctx.fillStyle = '#fffef2';
    ctx.fillRect(tailX - 2, y + h, 4, 2);
    ctx.fillRect(tailX, y + h + 2, 2, 2);

    // text
    ctx.fillStyle = '#1a1a24';
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => {
      ctx.fillText(line, x + PAD, y + PAD + i * LINE_H);
    });
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (ctx.measureText(candidate).width <= maxWidth || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines.slice(0, 4); // bubble caps at 4 lines
}
