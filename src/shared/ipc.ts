// Whitelisted IPC channel names.
//
// NOTE: the sandboxed preload (src/preload/index.ts) cannot import this file —
// it inlines these strings. If you change a value here, update the preload to
// match.

export const IPC = {
  /** renderer -> main: cursor is over an opaque sprite pixel (bool payload) */
  setInteractive: 'pet:set-interactive',
  /** renderer -> main: start following the cursor; payload {offsetX, offsetY} */
  beginDrag: 'pet:begin-drag',
  /** renderer -> main: stop following the cursor */
  endDrag: 'pet:end-drag',
  /** main -> renderer: cursor position in window-local DIPs {x, y, inside} */
  cursorMove: 'pet:cursor-move',
  /** main -> renderer: window velocity while dragging {vx, vy} in DIPs/s */
  dragTick: 'pet:drag-tick',
  /** main -> renderer: rolling input stats (kpm, idle times, hooksActive) */
  inputStats: 'pet:input-stats',
  /** renderer -> main (invoke): move window by {dx, dy}, returns clamp info */
  moveBy: 'pet:move-by',
  /** onboarding -> main: open the macOS Accessibility settings pane */
  openAccessibilitySettings: 'perm:open-settings',
  /** onboarding -> main (invoke): re-check permission, returns boolean */
  recheckAccessibility: 'perm:recheck',

  // --- timers & reminders (stage 7) ---
  /** renderer/tray -> main: start the Pomodoro cycle */
  pomoStart: 'pomo:start',
  /** renderer/tray -> main: stop the Pomodoro cycle */
  pomoStop: 'pomo:stop',
  /** main -> renderer: 1 Hz Pomodoro state {phase, remainingSec, totalSec, cycle} */
  pomoTick: 'pomo:tick',
  /** main -> renderer: a reminder/alarm fired {type, message} */
  reminderFire: 'remind:fire',
  /** invoke: add a one-off alarm {at, message} -> id */
  alarmAdd: 'alarm:add',
  /** invoke: list alarms */
  alarmList: 'alarm:list',
  /** invoke: remove alarm by id */
  alarmRemove: 'alarm:remove',
  /** invoke: set (or clear with null) the pinned note */
  noteSet: 'note:set',
  /** invoke: get the pinned note */
  noteGet: 'note:get',
  /** main -> renderer: pinned note changed */
  noteChanged: 'note:changed',
  /** invoke: set quiet mode on/off */
  quietSet: 'quiet:set',
  /** invoke: get quiet mode */
  quietGet: 'quiet:get',
  /** main -> renderer: quiet mode changed */
  quietChanged: 'quiet:changed',
  /** invoke: set stay mode on/off */
  staySet: 'stay:set',
  /** invoke: get stay mode */
  stayGet: 'stay:get',
  /** main -> renderer: stay mode changed */
  stayChanged: 'stay:changed',

  // --- settings window (stage 8) ---
  /** invoke: full settings snapshot for the settings UI */
  settingsGet: 'settings:get',
  /** invoke: apply a partial settings patch */
  settingsApply: 'settings:apply',
  /** invoke: reset all settings to defaults */
  settingsReset: 'settings:reset',
  /** main -> pet renderer: appearance/behavior settings changed */
  settingsChanged: 'settings:changed',
  /** invoke: current Pomodoro state snapshot */
  pomoGetState: 'pomo:state'
} as const;
