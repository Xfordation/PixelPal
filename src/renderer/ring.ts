// Pixel-art Pomodoro progress ring drawn beside the cat.

import type { PomodoroState } from '../preload/index';

const SEGMENTS = 16;
const RADIUS = 15;
const DOT = 4; // segment square size

const PHASE_COLORS: Record<string, string> = {
  work: '#f26d5b',
  break: '#8fd6c7',
  longBreak: '#8fb8f0'
};

export function drawRing(
  ctx: CanvasRenderingContext2D,
  state: PomodoroState,
  cx: number,
  cy: number
): void {
  if (state.phase === 'idle' || state.totalSec <= 0) return;
  const progress = 1 - state.remainingSec / state.totalSec;
  const color = PHASE_COLORS[state.phase] ?? '#f26d5b';

  for (let i = 0; i < SEGMENTS; i++) {
    // start at 12 o'clock, clockwise
    const angle = -Math.PI / 2 + (i / SEGMENTS) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(angle) * RADIUS - DOT / 2);
    const y = Math.round(cy + Math.sin(angle) * RADIUS - DOT / 2);
    const filled = i / SEGMENTS < progress;
    ctx.fillStyle = filled ? color : 'rgba(26,26,36,0.35)';
    ctx.fillRect(x, y, DOT, DOT);
  }

  // remaining minutes in the center
  ctx.font = '9px "Courier New", monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1a1a24';
  const mins = Math.ceil(state.remainingSec / 60);
  ctx.fillText(String(mins), cx + 1, cy + 4);
  ctx.fillStyle = '#fffef2';
  ctx.fillText(String(mins), cx, cy + 3);
  ctx.textAlign = 'start';
}
