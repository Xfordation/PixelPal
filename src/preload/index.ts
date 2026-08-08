import { contextBridge, ipcRenderer } from 'electron';

// Channel names are inlined because sandboxed preloads cannot require
// project modules. Keep in sync with src/shared/ipc.ts.
const CH_SET_INTERACTIVE = 'pet:set-interactive';
const CH_BEGIN_DRAG = 'pet:begin-drag';
const CH_END_DRAG = 'pet:end-drag';
const CH_CURSOR_MOVE = 'pet:cursor-move';
const CH_DRAG_TICK = 'pet:drag-tick';
const CH_INPUT_STATS = 'pet:input-stats';
const CH_MOVE_BY = 'pet:move-by';

export interface MoveResult {
  clampedX: boolean;
  clampedY: boolean;
}
const CH_PERM_OPEN_SETTINGS = 'perm:open-settings';
const CH_PERM_RECHECK = 'perm:recheck';
const CH_POMO_START = 'pomo:start';
const CH_POMO_STOP = 'pomo:stop';
const CH_POMO_TICK = 'pomo:tick';
const CH_REMIND_FIRE = 'remind:fire';
const CH_ALARM_ADD = 'alarm:add';
const CH_ALARM_LIST = 'alarm:list';
const CH_ALARM_REMOVE = 'alarm:remove';
const CH_NOTE_SET = 'note:set';
const CH_NOTE_GET = 'note:get';
const CH_NOTE_CHANGED = 'note:changed';
const CH_QUIET_SET = 'quiet:set';
const CH_QUIET_GET = 'quiet:get';
const CH_QUIET_CHANGED = 'quiet:changed';
const CH_STAY_SET = 'stay:set';
const CH_STAY_GET = 'stay:get';
const CH_STAY_CHANGED = 'stay:changed';
const CH_SETTINGS_GET = 'settings:get';
const CH_SETTINGS_APPLY = 'settings:apply';
const CH_SETTINGS_RESET = 'settings:reset';
const CH_SETTINGS_CHANGED = 'settings:changed';
const CH_POMO_STATE = 'pomo:state';

export interface AppearanceSettings {
  palette: string;
  customColor: string;
  spriteScale: number;
  typingThresholdKpm: number;
}

export interface SettingsSnapshot {
  pomodoro: { workMin: number; breakMin: number; longBreakMin: number; cyclesPerLong: number };
  reminders: {
    stretch: { enabled: boolean; intervalMin: number };
    water: { enabled: boolean; intervalMin: number };
    nativeNotifications: boolean;
  };
  appearance: AppearanceSettings;
  quietMode: boolean;
  stayMode: boolean;
  pinnedNote: string | null;
  launchAtLogin: boolean;
}

export interface PomodoroState {
  phase: 'idle' | 'work' | 'break' | 'longBreak';
  remainingSec: number;
  totalSec: number;
  cycle: number;
}

export interface ReminderEvent {
  type: 'stretch' | 'water' | 'alarm' | 'pomodoro';
  message: string;
}

export interface AlarmEntry {
  id: string;
  at: number;
  message: string;
}

export interface InputStats {
  kpm: number;
  msSinceKey: number;
  msSinceMouse: number;
  hooksActive: boolean;
}

export interface CursorInfo {
  x: number;
  y: number;
  inside: boolean;
}

const api = {
  version: '0.1.0',

  /** Tell the main process whether the cursor is over a solid sprite pixel. */
  setInteractive(interactive: boolean): void {
    ipcRenderer.send(CH_SET_INTERACTIVE, interactive === true);
  },

  /** Start moving the window with the cursor. Offsets are window-local DIPs. */
  beginDrag(offsetX: number, offsetY: number): void {
    ipcRenderer.send(CH_BEGIN_DRAG, {
      offsetX: Number(offsetX),
      offsetY: Number(offsetY)
    });
  },

  /** Stop moving the window; main clamps to the display and persists. */
  endDrag(): void {
    ipcRenderer.send(CH_END_DRAG);
  },

  /** Subscribe to the ~30 Hz global-cursor feed (window-local DIPs). */
  onCursorMove(callback: (info: CursorInfo) => void): void {
    ipcRenderer.on(CH_CURSOR_MOVE, (_event, info: CursorInfo) => callback(info));
  },

  /** Subscribe to drag velocity updates (DIPs/second) while being dragged. */
  onDragTick(callback: (v: { vx: number; vy: number }) => void): void {
    ipcRenderer.on(CH_DRAG_TICK, (_event, v: { vx: number; vy: number }) => callback(v));
  },

  /** Move the pet window by a small delta; resolves with clamp info. */
  moveBy(dx: number, dy: number): Promise<MoveResult | null> {
    return ipcRenderer.invoke(CH_MOVE_BY, Number(dx), Number(dy)) as Promise<MoveResult | null>;
  },

  /** Subscribe to rolling input stats (privacy-preserving counts only). */
  onInputStats(callback: (stats: InputStats) => void): void {
    ipcRenderer.on(CH_INPUT_STATS, (_event, stats: InputStats) => callback(stats));
  },

  /** Onboarding: open macOS Accessibility settings. */
  openAccessibilitySettings(): void {
    ipcRenderer.send(CH_PERM_OPEN_SETTINGS);
  },

  /** Onboarding: re-check the Accessibility permission. */
  recheckAccessibility(): Promise<boolean> {
    return ipcRenderer.invoke(CH_PERM_RECHECK) as Promise<boolean>;
  },

  // --- timers & reminders ---
  pomodoroStart(): void {
    ipcRenderer.send(CH_POMO_START);
  },
  pomodoroStop(): void {
    ipcRenderer.send(CH_POMO_STOP);
  },
  onPomodoroTick(callback: (state: PomodoroState) => void): void {
    ipcRenderer.on(CH_POMO_TICK, (_event, state: PomodoroState) => callback(state));
  },
  onReminder(callback: (event: ReminderEvent) => void): void {
    ipcRenderer.on(CH_REMIND_FIRE, (_event, ev: ReminderEvent) => callback(ev));
  },
  alarmAdd(at: number, message: string): Promise<AlarmEntry | null> {
    return ipcRenderer.invoke(CH_ALARM_ADD, at, message) as Promise<AlarmEntry | null>;
  },
  alarmList(): Promise<AlarmEntry[]> {
    return ipcRenderer.invoke(CH_ALARM_LIST) as Promise<AlarmEntry[]>;
  },
  alarmRemove(id: string): Promise<AlarmEntry[]> {
    return ipcRenderer.invoke(CH_ALARM_REMOVE, id) as Promise<AlarmEntry[]>;
  },
  noteSet(text: string | null): Promise<string | null> {
    return ipcRenderer.invoke(CH_NOTE_SET, text) as Promise<string | null>;
  },
  noteGet(): Promise<string | null> {
    return ipcRenderer.invoke(CH_NOTE_GET) as Promise<string | null>;
  },
  onNoteChanged(callback: (note: string | null) => void): void {
    ipcRenderer.on(CH_NOTE_CHANGED, (_event, note: string | null) => callback(note));
  },
  quietSet(on: boolean): Promise<boolean> {
    return ipcRenderer.invoke(CH_QUIET_SET, on === true) as Promise<boolean>;
  },
  quietGet(): Promise<boolean> {
    return ipcRenderer.invoke(CH_QUIET_GET) as Promise<boolean>;
  },
  onQuietChanged(callback: (on: boolean) => void): void {
    ipcRenderer.on(CH_QUIET_CHANGED, (_event, on: boolean) => callback(on));
  },

  staySet(on: boolean): Promise<boolean> {
    return ipcRenderer.invoke(CH_STAY_SET, on === true) as Promise<boolean>;
  },
  stayGet(): Promise<boolean> {
    return ipcRenderer.invoke(CH_STAY_GET) as Promise<boolean>;
  },
  onStayChanged(callback: (on: boolean) => void): void {
    ipcRenderer.on(CH_STAY_CHANGED, (_event, on: boolean) => callback(on));
  },

  // --- settings ---
  settingsGet(): Promise<SettingsSnapshot> {
    return ipcRenderer.invoke(CH_SETTINGS_GET) as Promise<SettingsSnapshot>;
  },
  settingsApply(patch: Partial<SettingsSnapshot>): Promise<null> {
    return ipcRenderer.invoke(CH_SETTINGS_APPLY, patch) as Promise<null>;
  },
  settingsReset(): Promise<null> {
    return ipcRenderer.invoke(CH_SETTINGS_RESET) as Promise<null>;
  },
  onSettingsChanged(callback: (appearance: AppearanceSettings) => void): void {
    ipcRenderer.on(CH_SETTINGS_CHANGED, (_event, a: AppearanceSettings) => callback(a));
  },
  pomodoroGetState(): Promise<PomodoroState> {
    return ipcRenderer.invoke(CH_POMO_STATE) as Promise<PomodoroState>;
  }
};

export type PixelPalApi = typeof api;

contextBridge.exposeInMainWorld('pixelpal', api);
