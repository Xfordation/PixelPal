// Global input activity tracking via uiohook-napi.
//
// PRIVACY: key identities are never read or stored. Handlers only record
// event timestamps; the sole derived metric is a rolling keystrokes-per-
// minute rate over a 5-second window.
//
// If the native hook cannot load or start (missing OS permission, ABI
// mismatch, unsupported platform), the app degrades gracefully:
// `hooksActive` stays false and the cat simply never reacts to typing.

const KPM_WINDOW_MS = 5000;
const STATS_INTERVAL_MS = 250;

export interface InputStats {
  /** rolling keystrokes-per-minute over the last 5 seconds */
  kpm: number;
  msSinceKey: number;
  msSinceMouse: number;
  hooksActive: boolean;
}

type StatsListener = (stats: InputStats) => void;

let keyTimestamps: number[] = [];
let lastKeyAt = 0;
let lastMouseAt = 0;
let hooksActive = false;
let statsTimer: NodeJS.Timeout | null = null;
let uiohook: typeof import('uiohook-napi').uIOhook | null = null;

function onKeydown(): void {
  const now = Date.now();
  lastKeyAt = now;
  keyTimestamps.push(now);
  // Bound memory: drop entries older than the window opportunistically.
  if (keyTimestamps.length > 512) pruneKeys(now);
}

function pruneKeys(now: number): void {
  const cutoff = now - KPM_WINDOW_MS;
  let firstLive = 0;
  while (firstLive < keyTimestamps.length && (keyTimestamps[firstLive] ?? 0) < cutoff) {
    firstLive++;
  }
  if (firstLive > 0) keyTimestamps = keyTimestamps.slice(firstLive);
}

function onMouseActivity(): void {
  lastMouseAt = Date.now();
}

export function getStats(): InputStats {
  const now = Date.now();
  pruneKeys(now);
  return {
    kpm: Math.round((keyTimestamps.length * 60000) / KPM_WINDOW_MS),
    msSinceKey: lastKeyAt === 0 ? Number.MAX_SAFE_INTEGER : now - lastKeyAt,
    msSinceMouse: lastMouseAt === 0 ? Number.MAX_SAFE_INTEGER : now - lastMouseAt,
    hooksActive
  };
}

export function startInputHooks(listener: StatsListener): boolean {
  try {
    // Deferred require so a broken native module can't crash startup.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    uiohook = (require('uiohook-napi') as typeof import('uiohook-napi')).uIOhook;
    uiohook.on('keydown', onKeydown);
    uiohook.on('mousemove', onMouseActivity);
    uiohook.on('mousedown', onMouseActivity);
    uiohook.on('wheel', onMouseActivity);
    uiohook.start();
    hooksActive = true;
  } catch (err) {
    console.warn('[input-hooks] global hooks unavailable, degrading:', err);
    hooksActive = false;
    uiohook = null;
  }

  statsTimer = setInterval(() => listener(getStats()), STATS_INTERVAL_MS);
  return hooksActive;
}

export function stopInputHooks(): void {
  if (statsTimer) {
    clearInterval(statsTimer);
    statsTimer = null;
  }
  if (uiohook) {
    try {
      uiohook.stop();
    } catch {
      // already stopped or never started
    }
    uiohook = null;
  }
  hooksActive = false;
}
