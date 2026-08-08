// Recurring wellness reminders (stretch / water), one-off alarms, and the
// pinned note. All state persists via electron-store.

import { randomUUID } from 'crypto';
import { settings, type AlarmEntry } from './settings';

export type ReminderType = 'stretch' | 'water' | 'alarm' | 'pomodoro';

export interface ReminderEvent {
  type: ReminderType;
  message: string;
}

const CHECK_INTERVAL_MS = 5000;

const STRETCH_MESSAGES = [
  'Stretch time! Reach for the ceiling~',
  'Time to stretch those paws!',
  'Stand up and stretch a little 🐾'
];
const WATER_MESSAGES = [
  'Drink some water! 💧',
  'Hydration check — take a sip!',
  'Water break, human!'
];

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)] ?? list[0] ?? '';
}

export class Reminders {
  private lastStretch = Date.now();
  private lastWater = Date.now();
  private timer: NodeJS.Timeout | null = null;

  onFire: ((event: ReminderEvent) => void) | null = null;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Fire a reminder immediately (used by test hooks and the tray menu). */
  fireNow(type: 'stretch' | 'water'): void {
    if (type === 'stretch') {
      this.lastStretch = Date.now();
      this.onFire?.({ type, message: pick(STRETCH_MESSAGES) });
    } else {
      this.lastWater = Date.now();
      this.onFire?.({ type, message: pick(WATER_MESSAGES) });
    }
  }

  addAlarm(at: number, message: string): AlarmEntry {
    const entry: AlarmEntry = { id: randomUUID(), at, message };
    settings.set('alarms', [...settings.get('alarms'), entry]);
    return entry;
  }

  listAlarms(): AlarmEntry[] {
    return settings.get('alarms');
  }

  removeAlarm(id: string): void {
    settings.set(
      'alarms',
      settings.get('alarms').filter((a) => a.id !== id)
    );
  }

  private check(): void {
    const now = Date.now();
    const cfg = settings.get('reminders');

    if (cfg.stretch.enabled && now - this.lastStretch >= cfg.stretch.intervalMin * 60_000) {
      this.fireNow('stretch');
    }
    if (cfg.water.enabled && now - this.lastWater >= cfg.water.intervalMin * 60_000) {
      this.fireNow('water');
    }

    const due = settings.get('alarms').filter((a) => a.at <= now);
    if (due.length > 0) {
      settings.set(
        'alarms',
        settings.get('alarms').filter((a) => a.at > now)
      );
      for (const alarm of due) {
        this.onFire?.({ type: 'alarm', message: alarm.message || 'Alarm!' });
      }
    }
  }
}
