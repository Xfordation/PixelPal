// Pet behavior finite state machine.
//
// Priority (highest wins): dragged > falling > overheat > typing > chase >
// sleep > idle micro-behaviors (idle / blink / sit / wander-walk / stretch /
// alert). The FSM outputs an animation tag, facing, and an optional movement
// step; the caller applies movement by moving the OS window.

export type PetStateName =
  | 'idle'
  | 'blink'
  | 'walk'
  | 'run'
  | 'sit'
  | 'sleep'
  | 'chase'
  | 'dragged'
  | 'falling'
  | 'typing'
  | 'overheat'
  | 'stretch'
  | 'alert'
  | 'purr';

export interface FsmInputs {
  /** cursor position in window-local DIPs (may be far outside the window) */
  cursorX: number;
  cursorY: number;
  /** ms since the cursor position last changed */
  msSinceCursorMove: number;
  msSinceKey: number;
  kpm: number;
  hooksActive: boolean;
  dragging: boolean;
  /** quiet mode: no wandering, chasing, or typing reactions */
  quiet: boolean;
  /** stay command: never move (no wandering, chasing, or falling) */
  stay: boolean;
  /** last move step hit a horizontal / vertical display edge */
  clampedX: boolean;
  clampedY: boolean;
}

export interface FsmOutput {
  anim: string;
  flipX: boolean;
  /** movement step for this tick in DIPs, or null to stay put */
  move: { dx: number; dy: number } | null;
}

// Tunables (some become user settings in later stages).
export const SLEEP_AFTER_MS = 60_000;
export const CHASE_START_DIST = 300;
export const CHASE_STOP_DIST = 48;
export const DEFAULT_OVERHEAT_KPM = 300;
const TYPING_ENTER_MS = 1500;
const TYPING_EXIT_MS = 2500;
const CHASE_CURSOR_FRESH_MS = 900;
const WAKE_ALERT_MS = 700;
const BLINK_MS = 140;
// Sprite center in window-local DIPs (window 224x192, sprite box at 48,64).
const CENTER_X = 112;
const CENTER_Y = 128;

const WALK_SPEED = 45; // px/s
const CHASE_MIN_SPEED = 70;
const CHASE_MAX_SPEED = 270;
const RUN_ANIM_SPEED = 130; // above this, use the run animation

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export class PetFsm {
  private state: PetStateName = 'idle';
  private stateTime = 0;

  // idle micro-behavior timers
  private blinkIn = rand(3000, 7000);
  private sitIn = rand(8000, 15_000);
  private wanderIn = rand(6000, 18_000);
  private sitFor = 0;
  private wanderRemaining = { x: 0, y: 0 };

  private facingRight = false;
  private wakeAlert = false;
  private overheatKpm = DEFAULT_OVERHEAT_KPM;

  /** Configurable typing threshold (settings). */
  setOverheatThreshold(kpm: number): void {
    this.overheatKpm = Math.max(60, kpm);
  }

  get current(): PetStateName {
    return this.state;
  }

  /** Force a state from outside (drag handlers, reminders in later stages). */
  set(state: PetStateName): void {
    if (this.state !== state) {
      this.state = state;
      this.stateTime = 0;
    }
  }

  update(dt: number, inputs: FsmInputs): FsmOutput {
    this.stateTime += dt;

    const dx = inputs.cursorX - CENTER_X;
    const dy = inputs.cursorY - CENTER_Y;
    const cursorDist = Math.hypot(dx, dy);
    const idleMs = Math.min(inputs.msSinceKey, inputs.msSinceCursorMove);

    // ----- hard overrides -------------------------------------------------
    if (inputs.dragging) {
      this.set('dragged');
      return { anim: 'dragged', flipX: false, move: null };
    }
    if (this.state === 'dragged') {
      // Physics (renderer main) decides falling on release; if it didn't
      // switch us to falling, settle back to idle.
      this.set('idle');
    }
    if (this.state === 'falling') {
      // Movement is driven by the physics controller, not the FSM.
      return { anim: 'falling', flipX: false, move: null };
    }

    // Timed one-shot states resist interruption (except dragging above).
    const busy = this.state === 'purr' || this.state === 'stretch';

    // ----- activity-driven states ----------------------------------------
    if (!busy && inputs.hooksActive && !inputs.quiet) {
      // overheat
      if (this.state === 'overheat') {
        if (inputs.kpm < this.overheatKpm * 0.8) this.set('typing');
      } else if (inputs.kpm >= this.overheatKpm) {
        this.set('overheat');
      }
      if (this.state === 'overheat') {
        return { anim: 'overheat', flipX: false, move: null };
      }

      // typing
      if (this.state === 'typing') {
        if (inputs.msSinceKey > TYPING_EXIT_MS) this.set('idle');
      } else if (
        inputs.msSinceKey < TYPING_ENTER_MS &&
        this.state !== 'chase' &&
        this.state !== 'sleep'
      ) {
        this.set('typing');
      }
      if (this.state === 'typing') {
        return { anim: 'typing', flipX: false, move: null };
      }

      // sleep / wake
      if (this.state === 'sleep') {
        if (idleMs < 2000) {
          this.wakeAlert = true;
          this.set('alert');
        } else {
          return { anim: 'sleep', flipX: false, move: null };
        }
      } else if (idleMs > SLEEP_AFTER_MS && this.state !== 'chase') {
        this.set('sleep');
        return { anim: 'sleep', flipX: false, move: null };
      }
    }

    // wake-up alert moment
    if (this.state === 'alert' && this.wakeAlert) {
      if (this.stateTime < WAKE_ALERT_MS) {
        return { anim: 'alert', flipX: false, move: null };
      }
      this.wakeAlert = false;
      this.set('idle');
    }

    // ----- chase ----------------------------------------------------------
    if (busy || inputs.quiet || inputs.stay) {
      if (this.state === 'chase') this.set('idle');
    } else if (this.state === 'chase') {
      if (cursorDist < CHASE_STOP_DIST || (inputs.clampedX && inputs.clampedY)) {
        this.set('sit');
        this.sitFor = rand(2000, 5000);
      }
    } else if (
      cursorDist > CHASE_START_DIST &&
      inputs.msSinceCursorMove < CHASE_CURSOR_FRESH_MS
    ) {
      this.set('chase');
    }

    if (!busy && this.state === 'chase') {
      // Ease toward the cursor: fast when far, slowing on approach.
      const speed = Math.min(CHASE_MAX_SPEED, Math.max(CHASE_MIN_SPEED, cursorDist * 1.4));
      const step = (speed * dt) / 1000;
      const nx = dx / (cursorDist || 1);
      const ny = dy / (cursorDist || 1);
      this.facingRight = nx > 0;
      return {
        anim: speed > RUN_ANIM_SPEED ? 'chase' : 'walk',
        flipX: this.facingRight,
        move: { dx: nx * step, dy: ny * step }
      };
    }

    // ----- idle micro-behaviors ------------------------------------------
    switch (this.state) {
      case 'blink':
        if (this.stateTime >= BLINK_MS) this.set('idle');
        else return { anim: 'blink', flipX: false, move: null };
        break;
      case 'sit':
        if (this.stateTime >= this.sitFor) {
          this.set('idle');
        } else {
          return { anim: 'sit', flipX: false, move: null };
        }
        break;
      case 'walk': {
        const remaining = Math.hypot(this.wanderRemaining.x, this.wanderRemaining.y);
        if (remaining < 2 || inputs.clampedX || inputs.clampedY) {
          this.set('idle');
          break;
        }
        const step = Math.min((WALK_SPEED * dt) / 1000, remaining);
        const nx = this.wanderRemaining.x / remaining;
        const ny = this.wanderRemaining.y / remaining;
        this.wanderRemaining.x -= nx * step;
        this.wanderRemaining.y -= ny * step;
        this.facingRight = nx > 0;
        return {
          anim: 'walk',
          flipX: this.facingRight,
          move: { dx: nx * step, dy: ny * step }
        };
      }
      case 'stretch':
        if (this.stateTime >= 2000) this.set('idle');
        else return { anim: 'stretch', flipX: false, move: null };
        break;
      case 'purr':
        if (this.stateTime >= 2400) this.set('idle');
        else return { anim: 'purr', flipX: false, move: null };
        break;
      case 'alert':
        if (this.stateTime >= 1000) this.set('idle');
        else return { anim: 'alert', flipX: false, move: null };
        break;
      default:
        break;
    }

    // in idle: run randomized timers for blink / sit / wander
    if (this.state === 'idle') {
      this.blinkIn -= dt;
      this.sitIn -= dt;
      this.wanderIn -= dt;
      if (this.blinkIn <= 0) {
        this.blinkIn = rand(3000, 7000);
        this.set('blink');
        return { anim: 'blink', flipX: false, move: null };
      }
      if (this.wanderIn <= 0 && !inputs.quiet && !inputs.stay) {
        this.wanderIn = rand(6000, 18_000);
        this.wanderRemaining = {
          x: rand(-220, 220),
          y: rand(-120, 120)
        };
        this.set('walk');
        return { anim: 'walk', flipX: this.wanderRemaining.x > 0, move: null };
      }
      if (this.sitIn <= 0) {
        this.sitIn = rand(8000, 15_000);
        this.sitFor = rand(3000, 8000);
        this.set('sit');
        return { anim: 'sit', flipX: false, move: null };
      }
    }

    return { anim: 'idle', flipX: false, move: null };
  }
}
