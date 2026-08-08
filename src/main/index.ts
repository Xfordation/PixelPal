import { app, ipcMain, Notification } from 'electron';
import { createPetWindow, getPetWindow, snapToNearestEdge } from './pet-window';
import { startInputHooks, stopInputHooks } from './input-hooks';
import {
  hasInputPermission,
  registerPermissionIpc,
  showOnboardingWindow
} from './permissions';
import { Pomodoro, type PomodoroState } from './pomodoro';
import { Reminders, type ReminderEvent } from './reminders';
import { settings, SETTINGS_DEFAULTS, type SettingsSchema } from './settings';
import { createTray, destroyTray, refreshTrayMenu } from './tray';
import { openSettingsWindow } from './settings-window';
import { IPC } from '../shared/ipc';

const pomodoro = new Pomodoro();
const reminders = new Reminders();

function sendToPet(channel: string, payload: unknown): void {
  const win = getPetWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}

function notify(title: string, body: string): void {
  if (!settings.get('reminders').nativeNotifications) return;
  if (!Notification.isSupported()) return;
  new Notification({ title, body, silent: false }).show();
}

function startHooks(): void {
  startInputHooks((stats) => sendToPet(IPC.inputStats, stats));
}

function setQuietMode(on: boolean): boolean {
  settings.set('quietMode', on);
  if (on) snapToNearestEdge();
  sendToPet(IPC.quietChanged, on);
  refreshTrayMenu();
  return on;
}

function setStayMode(on: boolean): boolean {
  settings.set('stayMode', on);
  sendToPet(IPC.stayChanged, on);
  refreshTrayMenu();
  return on;
}

function phaseMessage(state: PomodoroState): string {
  switch (state.phase) {
    case 'work':
      return `Focus time! Cycle ${state.cycle} — ${Math.round(state.totalSec / 60)} min.`;
    case 'break':
      return 'Break time! Stretch those paws~';
    case 'longBreak':
      return 'Long break! You earned it 🐾';
    default:
      return 'Pomodoro stopped.';
  }
}

function wireTimers(): void {
  pomodoro.onTick = (state) => sendToPet(IPC.pomoTick, state);
  pomodoro.onPhaseChange = (state) => {
    sendToPet(IPC.pomoTick, state);
    sendToPet(IPC.reminderFire, {
      type: 'pomodoro',
      message: phaseMessage(state)
    } satisfies ReminderEvent);
    notify('PixelPal', phaseMessage(state));
    refreshTrayMenu();
  };

  reminders.onFire = (event) => {
    sendToPet(IPC.reminderFire, event);
    notify('PixelPal', event.message);
  };
  reminders.start();
}

function appearancePayload(): SettingsSchema['appearance'] {
  return settings.get('appearance');
}

function registerTimerIpc(): void {
  ipcMain.on(IPC.pomoStart, () => {
    pomodoro.start(settings.get('pomodoro'));
    refreshTrayMenu();
  });
  ipcMain.on(IPC.pomoStop, () => {
    pomodoro.stop();
    refreshTrayMenu();
  });
  ipcMain.handle(IPC.pomoGetState, () => pomodoro.state);

  ipcMain.handle(IPC.alarmAdd, (_e, at: unknown, message: unknown) => {
    if (typeof at !== 'number' || !Number.isFinite(at)) return null;
    return reminders.addAlarm(at, String(message ?? ''));
  });
  ipcMain.handle(IPC.alarmList, () => reminders.listAlarms());
  ipcMain.handle(IPC.alarmRemove, (_e, id: unknown) => {
    if (typeof id === 'string') reminders.removeAlarm(id);
    return reminders.listAlarms();
  });

  ipcMain.handle(IPC.noteSet, (_e, text: unknown) => {
    const note = typeof text === 'string' && text.trim() !== '' ? text.trim() : null;
    settings.set('pinnedNote', note);
    sendToPet(IPC.noteChanged, note);
    return note;
  });
  ipcMain.handle(IPC.noteGet, () => settings.get('pinnedNote'));

  ipcMain.handle(IPC.quietSet, (_e, on: unknown) => setQuietMode(on === true));
  ipcMain.handle(IPC.quietGet, () => settings.get('quietMode'));

  ipcMain.handle(IPC.staySet, (_e, on: unknown) => setStayMode(on === true));
  ipcMain.handle(IPC.stayGet, () => settings.get('stayMode'));
}

function registerSettingsIpc(): void {
  ipcMain.handle(IPC.settingsGet, () => ({
    pomodoro: settings.get('pomodoro'),
    reminders: settings.get('reminders'),
    appearance: settings.get('appearance'),
    quietMode: settings.get('quietMode'),
    stayMode: settings.get('stayMode'),
    pinnedNote: settings.get('pinnedNote'),
    launchAtLogin: app.getLoginItemSettings().openAtLogin
  }));

  ipcMain.handle(IPC.settingsApply, (_e, patch: unknown) => {
    const p = (patch ?? {}) as Record<string, unknown>;

    if (p.pomodoro && typeof p.pomodoro === 'object') {
      settings.set('pomodoro', {
        ...settings.get('pomodoro'),
        ...(p.pomodoro as object)
      });
    }
    if (p.reminders && typeof p.reminders === 'object') {
      settings.set('reminders', {
        ...settings.get('reminders'),
        ...(p.reminders as object)
      });
    }
    if (p.appearance && typeof p.appearance === 'object') {
      settings.set('appearance', {
        ...settings.get('appearance'),
        ...(p.appearance as object)
      });
      sendToPet(IPC.settingsChanged, appearancePayload());
    }
    if (typeof p.quietMode === 'boolean') {
      setQuietMode(p.quietMode);
    }
    if (typeof p.stayMode === 'boolean') {
      setStayMode(p.stayMode);
    }
    if (typeof p.launchAtLogin === 'boolean') {
      app.setLoginItemSettings({ openAtLogin: p.launchAtLogin });
    }
    return null;
  });

  ipcMain.handle(IPC.settingsReset, () => {
    settings.set('pomodoro', SETTINGS_DEFAULTS.pomodoro);
    settings.set('reminders', SETTINGS_DEFAULTS.reminders);
    settings.set('appearance', SETTINGS_DEFAULTS.appearance);
    setQuietMode(SETTINGS_DEFAULTS.quietMode);
    setStayMode(SETTINGS_DEFAULTS.stayMode);
    app.setLoginItemSettings({ openAtLogin: false });
    sendToPet(IPC.settingsChanged, appearancePayload());
    return null;
  });
}

// Dev/test hooks: PIXELPAL_TEST is a comma list, e.g. "pomo,reminder,note".
// Uses short timers so behavior can be verified without waiting minutes.
function applyTestHooks(): void {
  const test = process.env.PIXELPAL_TEST ?? '';
  if (test.includes('pomo')) {
    setTimeout(
      () => pomodoro.start({ workMin: 0.2, breakMin: 0.12, longBreakMin: 0.15, cyclesPerLong: 2 }),
      3000
    );
  }
  if (test.includes('reminder')) {
    setTimeout(() => reminders.fireNow('stretch'), 4000);
    setTimeout(() => reminders.fireNow('water'), 12_000);
  }
  if (test.includes('note')) {
    setTimeout(() => {
      settings.set('pinnedNote', 'Ship stage 7! 📌');
      sendToPet(IPC.noteChanged, 'Ship stage 7! 📌');
    }, 2000);
  }
  if (test.includes('settings')) {
    setTimeout(() => openSettingsWindow(), 2000);
  }
  if (test.includes('palette')) {
    setTimeout(() => {
      settings.set('appearance', { ...settings.get('appearance'), palette: 'seafoam' });
      sendToPet(IPC.settingsChanged, appearancePayload());
    }, 4000);
  }
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock?.hide();
  }

  createPetWindow();
  registerPermissionIpc(startHooks);
  registerTimerIpc();
  registerSettingsIpc();
  wireTimers();

  createTray({
    isPomodoroRunning: () => pomodoro.running,
    startPomodoro: () => pomodoro.start(settings.get('pomodoro')),
    stopPomodoro: () => pomodoro.stop(),
    setQuiet: (on) => setQuietMode(on),
    setStay: (on) => setStayMode(on),
    openSettings: () => openSettingsWindow()
  });

  applyTestHooks();

  if (hasInputPermission()) {
    startHooks();
  } else {
    // macOS without Accessibility: cat still runs (idle + timers), and we
    // explain how to enable reactions to typing and cursor play.
    showOnboardingWindow();
  }
});

app.on('will-quit', () => {
  stopInputHooks();
  pomodoro.stop();
  reminders.stop();
  destroyTray();
});

app.on('window-all-closed', () => {
  app.quit();
});
