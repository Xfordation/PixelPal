// Fixed-timestep game loop on requestAnimationFrame.
//
// update() runs at a fixed 60 Hz step via an accumulator (deterministic
// physics/animation); render() runs once per animation frame. The loop pauses
// automatically while the document is hidden to keep idle CPU near zero.

const STEP_MS = 1000 / 60;
const MAX_FRAME_MS = 250; // clamp huge deltas (breakpoints, sleep resume)

export interface Loop {
  stop(): void;
}

export function startLoop(
  update: (dtMs: number) => void,
  render: () => void
): Loop {
  let rafId = 0;
  let last = performance.now();
  let accumulator = 0;
  let running = true;

  function frame(now: number): void {
    if (!running) return;
    accumulator += Math.min(now - last, MAX_FRAME_MS);
    last = now;
    while (accumulator >= STEP_MS) {
      update(STEP_MS);
      accumulator -= STEP_MS;
    }
    render();
    rafId = requestAnimationFrame(frame);
  }

  function onVisibility(): void {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
    } else {
      last = performance.now();
      accumulator = 0;
      rafId = requestAnimationFrame(frame);
    }
  }

  document.addEventListener('visibilitychange', onVisibility);
  rafId = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}
