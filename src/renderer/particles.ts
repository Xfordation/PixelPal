// Pooled particle system: hearts (petting) and steam (overheat).
// Fixed-size pool, no allocations after construction.

type ParticleType = 'heart' | 'steam';

interface Particle {
  active: boolean;
  type: ParticleType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  seed: number;
}

const POOL_SIZE = 32;

// 5x4 pixel heart, drawn at 2px per cell.
const HEART_MAP = ['X.X', 'XXX', '.X.'];

export class Particles {
  private pool: Particle[] = [];

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) {
      this.pool.push({
        active: false,
        type: 'heart',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        age: 0,
        life: 1,
        seed: Math.random() * Math.PI * 2
      });
    }
  }

  spawn(type: ParticleType, x: number, y: number): void {
    const p = this.pool.find((q) => !q.active);
    if (!p) return;
    p.active = true;
    p.type = type;
    p.x = x;
    p.y = y;
    p.age = 0;
    p.seed = Math.random() * Math.PI * 2;
    if (type === 'heart') {
      p.vx = (Math.random() - 0.5) * 26;
      p.vy = -34 - Math.random() * 18;
      p.life = 1300 + Math.random() * 400;
    } else {
      p.vx = (Math.random() - 0.5) * 14;
      p.vy = -26 - Math.random() * 12;
      p.life = 1000 + Math.random() * 300;
    }
  }

  update(dt: number): void {
    const dts = dt / 1000;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dts;
      p.y += p.vy * dts;
      if (p.type === 'heart') {
        // gentle sideways sway
        p.x += Math.sin(p.seed + p.age / 160) * 14 * dts;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      const t = p.age / p.life;
      const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      if (p.type === 'heart') {
        ctx.globalAlpha = alpha * 0.95;
        ctx.fillStyle = '#f26d7d';
        const cell = 3;
        for (let ry = 0; ry < HEART_MAP.length; ry++) {
          const row = HEART_MAP[ry] ?? '';
          for (let rx = 0; rx < row.length; rx++) {
            if (row[rx] === 'X') {
              ctx.fillRect(
                Math.round(p.x + rx * cell - 4),
                Math.round(p.y + ry * cell - 4),
                cell,
                cell
              );
            }
          }
        }
      } else {
        // steam: growing translucent square puff
        const size = 4 + t * 8;
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillStyle = '#eef2ff';
        ctx.fillRect(
          Math.round(p.x - size / 2),
          Math.round(p.y - size / 2),
          Math.round(size),
          Math.round(size)
        );
      }
    }
    ctx.globalAlpha = 1;
  }

  get anyActive(): boolean {
    return this.pool.some((p) => p.active);
  }
}
