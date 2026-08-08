import Store from 'electron-store';
import type { PomodoroConfig } from './pomodoro';

export interface AlarmEntry {
  id: string;
  at: number; // epoch ms
  message: string;
}

export interface ReminderConfig {
  enabled: boolean;
  intervalMin: number;
}

export interface AppearanceSettings {
  /** preset palette name, or 'custom' to use customColor */
  palette: string;
  customColor: string;
  /** sprite scale multiplier: 0.75 | 1 | 1.25 */
  spriteScale: number;
  typingThresholdKpm: number;
}

export interface SettingsSchema {
  petPosition: { x: number; y: number } | null;
  pomodoro: PomodoroConfig;
  reminders: {
    stretch: ReminderConfig;
    water: ReminderConfig;
    nativeNotifications: boolean;
  };
  alarms: AlarmEntry[];
  pinnedNote: string | null;
  quietMode: boolean;
  /** Stay command: the cat never moves itself (no wander/chase/falling). */
  stayMode: boolean;
  appearance: AppearanceSettings;
}

export const SETTINGS_DEFAULTS: Omit<SettingsSchema, 'petPosition' | 'alarms' | 'pinnedNote'> = {
  pomodoro: {
    workMin: 25,
    breakMin: 5,
    longBreakMin: 15,
    cyclesPerLong: 4
  },
  reminders: {
    stretch: { enabled: true, intervalMin: 45 },
    water: { enabled: true, intervalMin: 60 },
    nativeNotifications: true
  },
  quietMode: false,
  stayMode: false,
  appearance: {
    palette: 'marmalade',
    customColor: '#f5a962',
    spriteScale: 1,
    typingThresholdKpm: 300
  }
};

export const settings = new Store<SettingsSchema>({
  defaults: {
    petPosition: null,
    alarms: [],
    pinnedNote: null,
    ...SETTINGS_DEFAULTS
  }
});
