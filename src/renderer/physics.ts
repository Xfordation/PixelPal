// Mochi physics: squash-and-stretch scaling, shake wobble, and gravity.
//
// Scale is driven directly from velocity while dragging/falling, then handed
// to an underdamped spring on release so the cat overshoots and settles.
// Wobble is a rotational spring kicked by rapid drag direction reversals.

const SPRING_K = 170;
const SPRING_C = 11; // underdamped: visible overshoot
const WOBBLE_K = 130;
const WOBBLE_C = 5;
const GRAVITY = 2600; // px/s^2
const MAX_FALL_SPEED = 1700;
const AIR_FRICTION = 0.6; // horizontal velocity decay per second while falling
const STRETCH_PER_SPEED = 1 / 1600; // how fast velocity stretches the sprite
const MAX_STRETCH = 0.35;
const SHAKE_MIN_SPEED = 260;
const SHAKE_WINDOW_MS = 450;

export type PhysicsMode = 'none' | 'drag' | 'fall';

export class PetPhysics {
  mode: PhysicsMode = 'none';

  // visual state consumed by the draw pass
  scaleX = 1;
  scaleY = 1;
  wobble = 0;

  // spring internals
  private vScaleX = 0;
  private vScaleY = 0;
  private vWobble = 0;

  // drag state
  private dragVx = 0;
  private dragVy = 0;
  private lastSignX = 0;
  private lastFlipAt = -Infinity;
  private flipCount = 0;
  private wobbleDir = 1;

  // fall state
  fallVx = 0;
  fallVy = 0;

  /** Latest drag velocity from the main process. */
  onDragVelocity(vx: number, vy: number, nowMs: number): void {
    this.dragVx = vx;
    this.dragVy = vy;

    // Shake detection: rapid horizontal direction reversals.
    const sign = vx > SHAKE_MIN_SPEED ? 1 : vx < -SHAKE_MIN_SPEED ? -1 : 0;
    if (sign !== 0 && this.lastSignX !== 0 && sign !== this.lastSignX) {
      if (nowMs - this.lastFlipAt < SHAKE_WINDOW_MS) {
        this.flipCount++;
        if (this.flipCount >= 2) {
          this.vWobble += this.wobbleDir * 9;
          this.wobbleDir = -this.wobbleDir;
          this.flipCount = 0;
        }
      } else {
        this.flipCount = 1;
      }
      this.lastFlipAt = nowMs;
    }
    if (sign !== 0) this.lastSignX = sign;
  }

  beginDrag(): void {
    this.mode = 'drag';
    this.fallVx = 0;
    this.fallVy = 0;
  }

  /** Release from drag: begin falling with the drag velocity. */
  release(): void {
    this.mode = 'fall';
    this.fallVx = Math.max(-900, Math.min(900, this.dragVx));
    this.fallVy = Math.max(-1200, Math.min(MAX_FALL_SPEED, this.dragVy));
    this.dragVx = 0;
    this.dragVy = 0;
  }

  /** Landing impact: squash proportional to impact speed, spring back. */
  land(impactSpeed: number): void {
    this.mode = 'none';
    const squash = Math.min(0.45, impactSpeed / 2400);
    this.scaleY = 1 - squash;
    this.scaleX = 1 + squash;
    this.vScaleY = 0;
    this.vScaleX = 0;
  }

  cancel(): void {
    this.mode = 'none';
  }

  /** Returns the movement step {dx, dy} for this tick while falling. */
  update(dt: number): { dx: number; dy: number } | null {
    const dts = dt / 1000;

    if (this.mode === 'drag') {
      // Stretch along the dominant velocity axis, squash the other.
      const speed = Math.hypot(this.dragVx, this.dragVy);
      const stretch = 1 + Math.min(MAX_STRETCH, speed * STRETCH_PER_SPEED);
      const targetX = Math.abs(this.dragVx) >= Math.abs(this.dragVy) ? stretch : 1 / stretch;
      const targetY = Math.abs(this.dragVy) > Math.abs(this.dragVx) ? stretch : 1 / stretch;
      this.scaleX += (targetX - this.scaleX) * Math.min(1, 14 * dts);
      this.scaleY += (targetY - this.scaleY) * Math.min(1, 14 * dts);
    } else if (this.mode === 'fall') {
      this.fallVy = Math.min(MAX_FALL_SPEED, this.fallVy + GRAVITY * dts);
      this.fallVx *= Math.max(0, 1 - AIR_FRICTION * dts);
      const stretch = 1 + Math.min(MAX_STRETCH, Math.abs(this.fallVy) * STRETCH_PER_SPEED);
      this.scaleY += (stretch - this.scaleY) * Math.min(1, 14 * dts);
      this.scaleX += (1 / stretch - this.scaleX) * Math.min(1, 14 * dts);
    } else {
      // Underdamped springs return scale to rest with overshoot.
      const ax = -SPRING_K * (this.scaleX - 1) - SPRING_C * this.vScaleX;
      const ay = -SPRING_K * (this.scaleY - 1) - SPRING_C * this.vScaleY;
      this.vScaleX += ax * dts;
      this.vScaleY += ay * dts;
      this.scaleX += this.vScaleX * dts;
      this.scaleY += this.vScaleY * dts;
    }

    // Wobble spring always runs (decays to zero).
    const aw = -WOBBLE_K * this.wobble - WOBBLE_C * this.vWobble;
    this.vWobble += aw * dts;
    this.wobble += this.vWobble * dts;

    if (this.mode === 'fall') {
      return { dx: this.fallVx * dts, dy: this.fallVy * dts };
    }
    return null;
  }
}
