import {
  BrowserWindow,
  ipcMain,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron';
import * as path from 'path';
import { IPC } from '../shared/ipc';
import { settings } from './settings';

// Window is larger than the sprite box: extra room above for speech bubbles
// and beside the cat for the Pomodoro ring. Transparent padding stays
// click-through thanks to alpha hit-testing.
export const WINDOW_W = 224;
export const WINDOW_H = 192;
const EDGE_MARGIN = 24;
const DRAG_TICK_MS = 16;
const SAVE_DEBOUNCE_MS = 500;
const CURSOR_POLL_MS = 33; // ~30 Hz

let petWindow: BrowserWindow | null = null;
let dragTimer: NodeJS.Timeout | null = null;
let saveTimer: NodeJS.Timeout | null = null;
let cursorTimer: NodeJS.Timeout | null = null;

export function getPetWindow(): BrowserWindow | null {
  return petWindow;
}

/** Move the window while re-asserting its fixed size (mixed-DPI safety). */
function setPetBounds(x: number, y: number): void {
  petWindow?.setBounds({ x, y, width: WINDOW_W, height: WINDOW_H });
}

/** Quiet mode: snap the cat to the nearest horizontal edge of its display. */
export function snapToNearestEdge(): void {
  if (!petWindow) return;
  const [x = 0, y = 0] = petWindow.getPosition();
  const display = screen.getDisplayMatching({ x, y, width: WINDOW_W, height: WINDOW_H });
  const wa = display.workArea;
  const centerX = x + WINDOW_W / 2;
  const targetX =
    centerX - wa.x < wa.x + wa.width - centerX ? wa.x : wa.x + wa.width - WINDOW_W;
  const clamped = clampToDisplay(targetX, y);
  setPetBounds(clamped.x, clamped.y);
  scheduleSavePosition();
}

/**
 * Clamp a window position so the cat stays on screen, but allow it to cross
 * between adjacent displays: horizontal bounds extend into displays that
 * share vertical range with the nearest one (side-by-side monitors), and
 * vertical bounds extend into displays sharing horizontal range (stacked).
 */
function clampToDisplay(x: number, y: number): { x: number; y: number } {
  const center = { x: Math.round(x + WINDOW_W / 2), y: Math.round(y + WINDOW_H / 2) };
  const near = screen.getDisplayNearestPoint(center).workArea;

  let minX = near.x;
  let maxX = near.x + near.width - WINDOW_W;
  let minY = near.y;
  let maxY = near.y + near.height - WINDOW_H;

  for (const display of screen.getAllDisplays()) {
    const wa = display.workArea;
    if (wa.x === near.x && wa.y === near.y) continue;
    const overlapsVertically = wa.y < near.y + near.height && wa.y + wa.height > near.y;
    const overlapsHorizontally = wa.x < near.x + near.width && wa.x + wa.width > near.x;
    if (overlapsVertically) {
      minX = Math.min(minX, wa.x);
      maxX = Math.max(maxX, wa.x + wa.width - WINDOW_W);
    }
    if (overlapsHorizontally) {
      minY = Math.min(minY, wa.y);
      maxY = Math.max(maxY, wa.y + wa.height - WINDOW_H);
    }
  }

  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY)
  };
}

function defaultPosition(): { x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - WINDOW_W - EDGE_MARGIN,
    y: workArea.y + workArea.height - WINDOW_H - EDGE_MARGIN
  };
}

function startPosition(): { x: number; y: number } {
  const saved = settings.get('petPosition');
  if (!saved) return defaultPosition();
  // Clamping also rescues positions saved on a display that was unplugged.
  return clampToDisplay(saved.x, saved.y);
}

function scheduleSavePosition(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!petWindow) return;
    const [x = 0, y = 0] = petWindow.getPosition();
    settings.set('petPosition', { x, y });
  }, SAVE_DEBOUNCE_MS);
}

function fromPet(event: IpcMainEvent): boolean {
  return petWindow !== null && event.sender === petWindow.webContents;
}

function registerIpc(): void {
  ipcMain.on(IPC.setInteractive, (event, interactive: unknown) => {
    if (!fromPet(event) || !petWindow) return;
    if (interactive === true) {
      petWindow.setIgnoreMouseEvents(false);
    } else {
      petWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  });

  ipcMain.on(IPC.beginDrag, (event, offset: unknown) => {
    if (!fromPet(event) || !petWindow) return;
    const { offsetX, offsetY } = (offset ?? {}) as { offsetX?: unknown; offsetY?: unknown };
    if (typeof offsetX !== 'number' || typeof offsetY !== 'number') return;
    if (dragTimer) clearInterval(dragTimer);
    // Velocity (EMA-smoothed) is streamed back for squash-and-stretch.
    let lastPos: { x: number; y: number } | null = null;
    let lastTime = Date.now();
    let vx = 0;
    let vy = 0;
    dragTimer = setInterval(() => {
      if (!petWindow) return;
      const cursor = screen.getCursorScreenPoint();
      const next = { x: Math.round(cursor.x - offsetX), y: Math.round(cursor.y - offsetY) };
      setPetBounds(next.x, next.y);
      const now = Date.now();
      const dt = Math.max(1, now - lastTime) / 1000;
      if (lastPos) {
        const alpha = 0.35;
        vx = vx * (1 - alpha) + ((next.x - lastPos.x) / dt) * alpha;
        vy = vy * (1 - alpha) + ((next.y - lastPos.y) / dt) * alpha;
      }
      lastPos = next;
      lastTime = now;
      petWindow.webContents.send(IPC.dragTick, { vx, vy });
    }, DRAG_TICK_MS);
  });

  // FSM-driven movement (wander/chase). Deltas are small per-tick steps;
  // the result reports whether the window hit a display edge so the cat
  // can stop walking into walls.
  ipcMain.handle(IPC.moveBy, (event: IpcMainInvokeEvent, dx: unknown, dy: unknown) => {
    if (petWindow === null || event.sender !== petWindow.webContents) return null;
    if (typeof dx !== 'number' || typeof dy !== 'number') return null;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    if (dragTimer) return null; // user drag wins over FSM movement
    const stepX = Math.max(-32, Math.min(32, Math.round(dx)));
    const stepY = Math.max(-32, Math.min(32, Math.round(dy)));
    const [x = 0, y = 0] = petWindow.getPosition();
    const target = { x: x + stepX, y: y + stepY };
    const clamped = clampToDisplay(target.x, target.y);
    setPetBounds(clamped.x, clamped.y);
    return {
      clampedX: clamped.x !== target.x,
      clampedY: clamped.y !== target.y
    };
  });

  ipcMain.on(IPC.endDrag, (event) => {
    if (!fromPet(event)) return;
    stopDrag();
    if (!petWindow) return;
    const [x = 0, y = 0] = petWindow.getPosition();
    const clamped = clampToDisplay(x, y);
    if (clamped.x !== x || clamped.y !== y) {
      setPetBounds(clamped.x, clamped.y);
    }
    scheduleSavePosition();
  });
}

function stopDrag(): void {
  if (dragTimer) {
    clearInterval(dragTimer);
    dragTimer = null;
  }
}

// Forwarded mousemove events (setIgnoreMouseEvents forward:true) are
// unreliable on Windows, so the main process polls the global cursor and
// streams window-local coordinates to the renderer (~30 Hz, only when the
// cursor actually moved). The renderer uses this for alpha hit-testing and
// for cursor-aware behavior (eye tracking, chase).
let lastSent = { x: Number.NaN, y: Number.NaN };

function startCursorFeed(): void {
  if (cursorTimer) clearInterval(cursorTimer);
  cursorTimer = setInterval(() => {
    if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return;
    const cursor = screen.getCursorScreenPoint();
    const [wx = 0, wy = 0] = petWindow.getPosition();
    const x = cursor.x - wx;
    const y = cursor.y - wy;
    if (x === lastSent.x && y === lastSent.y) return;
    lastSent = { x, y };
    const inside = x >= 0 && y >= 0 && x < WINDOW_W && y < WINDOW_H;
    petWindow.webContents.send(IPC.cursorMove, { x, y, inside });
  }, CURSOR_POLL_MS);
}

export function createPetWindow(): BrowserWindow {
  const pos = startPosition();

  petWindow = new BrowserWindow({
    width: WINDOW_W,
    height: WINDOW_H,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Hard-lock the size: Electron's setPosition on mixed-DPI multi-monitor
  // setups can silently resize the window (DPI scaling bug); min=max plus
  // setBounds with explicit size everywhere keeps it fixed forever.
  petWindow.setMinimumSize(WINDOW_W, WINDOW_H);
  petWindow.setMaximumSize(WINDOW_W, WINDOW_H);

  // 'screen-saver' level floats above fullscreen apps.
  petWindow.setAlwaysOnTop(true, 'screen-saver');

  // Click-through by default; forwarded mousemove events let the renderer
  // hit-test sprite pixels and toggle interactivity back on.
  petWindow.setIgnoreMouseEvents(true, { forward: true });

  if (process.platform === 'darwin') {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  petWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  petWindow.once('ready-to-show', () => {
    petWindow?.show();
  });

  petWindow.on('moved', scheduleSavePosition);

  startCursorFeed();

  petWindow.on('closed', () => {
    stopDrag();
    if (cursorTimer) {
      clearInterval(cursorTimer);
      cursorTimer = null;
    }
    petWindow = null;
  });

  return petWindow;
}

registerIpc();
