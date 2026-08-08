// Pomodoro engine. Lives in the main process so it survives renderer
// reloads. Default 25/5 with a long break every 4 work cycles.

export type PomodoroPhase = 'idle' | 'work' | 'break' | 'longBreak';

export interface PomodoroConfig {
  workMin: number;
  breakMin: number;
  longBreakMin: number;
  cyclesPerLong: number;
}

export const DEFAULT_POMODORO: PomodoroConfig = {
  workMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  cyclesPerLong: 4
};

export interface PomodoroState {
  phase: PomodoroPhase;
  remainingSec: number;
  totalSec: number;
  cycle: number;
}

export class Pomodoro {
  private phase: PomodoroPhase = 'idle';
  private endsAt = 0;
  private totalMs = 0;
  private cycle = 0;
  private config: PomodoroConfig = DEFAULT_POMODORO;
  private timer: NodeJS.Timeout | null = null;

  onTick: ((state: PomodoroState) => void) | null = null;
  onPhaseChange: ((state: PomodoroState) => void) | null = null;

  get state(): PomodoroState {
    return {
      phase: this.phase,
      remainingSec:
        this.phase === 'idle' ? 0 : Math.max(0, Math.round((this.endsAt - Date.now()) / 1000)),
      totalSec: Math.round(this.totalMs / 1000),
      cycle: this.cycle
    };
  }

  get running(): boolean {
    return this.phase !== 'idle';
  }

  start(config?: Partial<PomodoroConfig>): void {
    this.config = { ...DEFAULT_POMODORO, ...config };
    this.cycle = 1;
    this.enterPhase('work');
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), 1000);
    }
  }

  stop(): void {
    this.phase = 'idle';
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.onTick?.(this.state);
  }

  private enterPhase(phase: Exclude<PomodoroPhase, 'idle'>): void {
    const minutes =
      phase === 'work'
        ? this.config.workMin
        : phase === 'break'
          ? this.config.breakMin
          : this.config.longBreakMin;
    this.phase = phase;
    this.totalMs = Math.max(1000, minutes * 60_000);
    this.endsAt = Date.now() + this.totalMs;
    this.onPhaseChange?.(this.state);
  }

  private tick(): void {
    if (this.phase === 'idle') return;
    if (Date.now() >= this.endsAt) {
      if (this.phase === 'work') {
        this.enterPhase(this.cycle % this.config.cyclesPerLong === 0 ? 'longBreak' : 'break');
      } else {
        this.cycle++;
        this.enterPhase('work');
      }
    }
    this.onTick?.(this.state);
  }
}
