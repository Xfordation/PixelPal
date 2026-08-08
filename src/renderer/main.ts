// Renderer entry: sprite pipeline + FSM + physics + particles +
// hit-testing/drag/petting + eye tracking.

import { loadSpriteSet, AnimationPlayer, resolvePalette, type Palette } from './sprites';
import { startLoop } from './loop';
import { PetFsm } from './fsm';
import { PetPhysics } from './physics';
import { Particles } from './particles';
import { SpeechBubble } from './bubble';
import { drawRing } from './ring';
import type { AppearanceSettings, PomodoroState } from '../preload/index';

// Window canvas is 224x192; the sprite box (16px art * scale) sits
// bottom-center, leaving headroom for speech bubbles and side room for the
// Pomodoro ring. Geometry is recomputed when the user changes sprite scale.
const CANVAS_W = 224;
const CANVAS_H = 192;
const SPRITE_SIZE = 16;
const DRAG_START_DIST = 4; // px of movement before a press becomes a drag
const STEAM_INTERVAL_MS = 140;
const HEART_INTERVAL_MS = 280;
const RING_CX = 24;
const RING_CY = 160;
const REMINDER_BUBBLE_MS = 8000;

interface Geometry {
  scale: number; // device px per sprite px
  box: number; // sprite box size (16 * scale)
  offX: number;
  offY: number;
  anchorX: number; // squash/stretch anchor: bottom-center of sprite
  anchorY: number;
  tailX: number; // bubble tail (above the ears)
  tailY: number;
}

function makeGeometry(scaleMult: number): Geometry {
  const scale = 8 * scaleMult;
  const box = SPRITE_SIZE * scale;
  const offX = Math.round((CANVAS_W - box) / 2);
  const offY = CANVAS_H - box;
  return {
    scale,
    box,
    offX,
    offY,
    anchorX: offX + box / 2,
    anchorY: offY + (box * 122) / 128,
    tailX: offX + box / 2,
    tailY: offY + (box * 10) / 128
  };
}

// Eye anchor pixels (sprite coords + size) per animation tag, for
// cursor-tracking pupils. Front-facing chibi eyes are 2x2 with a sparkle;
// side-view eyes are 1x1. Tags not listed keep their baked-in eyes.
type EyeAnchor = [x: number, y: number, w: number, h: number];
const FRONT_EYES: EyeAnchor[] = [
  [3, 5, 2, 2],
  [9, 5, 2, 2]
];
const EYE_ANCHORS: Record<string, EyeAnchor[]> = {
  idle: FRONT_EYES,
  sit: FRONT_EYES,
  dragged: FRONT_EYES,
  falling: FRONT_EYES,
  walk: [[3, 6, 1, 1]],
  run: [[3, 6, 1, 1]],
  chase: [[3, 6, 1, 1]],
  typing: FRONT_EYES
};

async function boot(): Promise<void> {
  const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('#pet-canvas not found');

  const dpr = window.devicePixelRatio || 1;
  canvas.width = CANVAS_W * dpr;
  canvas.height = CANVAS_H * dpr;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  ctx.scale(dpr, dpr);

  const sprites = await loadSpriteSet('sprites/cat');
  const player = new AnimationPlayer(sprites);
  const fsm = new PetFsm();
  const physics = new PetPhysics();
  const particles = new Particles();
  const bubble = new SpeechBubble();
  player.play('idle');

  let palette: Palette = resolvePalette('marmalade', '#f5a962');
  let geo = makeGeometry(1);
  let quiet = false;
  let stay = false;
  let pomoState: PomodoroState = { phase: 'idle', remainingSec: 0, totalSec: 0, cycle: 0 };

  function applyAppearance(a: AppearanceSettings): void {
    palette = resolvePalette(a.palette, a.customColor);
    geo = makeGeometry(a.spriteScale > 0 ? a.spriteScale : 1);
    fsm.setOverheatThreshold(a.typingThresholdKpm);
  }

  // initial persisted state
  window.pixelpal.settingsGet().then((s) => applyAppearance(s.appearance));
  window.pixelpal.noteGet().then((note) => bubble.setPinned(note));
  window.pixelpal.quietGet().then((q) => {
    quiet = q;
  });
  window.pixelpal.stayGet().then((s) => {
    stay = s;
  });

  window.pixelpal.onSettingsChanged((a) => applyAppearance(a));
  window.pixelpal.onNoteChanged((note) => bubble.setPinned(note));
  window.pixelpal.onQuietChanged((q) => {
    quiet = q;
  });
  window.pixelpal.onStayChanged((s) => {
    stay = s;
  });
  window.pixelpal.onPomodoroTick((state) => {
    pomoState = state;
  });
  window.pixelpal.onReminder((event) => {
    bubble.showTimed(event.message, REMINDER_BUBBLE_MS);
    fsm.set(event.type === 'stretch' ? 'stretch' : 'alert');
  });

  // ---------------------------------------------------------------------
  // Inputs gathered from the main process
  // ---------------------------------------------------------------------
  let cursorX = -9999;
  let cursorY = -9999;
  let cursorMovedAt = -Infinity;
  let stats = {
    kpm: 0,
    msSinceKey: Number.MAX_SAFE_INTEGER,
    msSinceMouse: Number.MAX_SAFE_INTEGER,
    hooksActive: false
  };
  let clampedX = false;
  let clampedY = false;
  let interactive = false;
  let dragging = false;
  let pressed = false;
  let pressX = 0;
  let pressY = 0;

  function isSolidAt(clientX: number, clientY: number): boolean {
    const x = Math.floor(clientX * dpr);
    const y = Math.floor(clientY * dpr);
    if (x < 0 || y < 0 || x >= canvas!.width || y >= canvas!.height) return false;
    const alpha = ctx!.getImageData(x, y, 1, 1).data[3] ?? 0;
    return alpha > 16;
  }

  function setInteractive(next: boolean): void {
    if (interactive === next) return;
    interactive = next;
    window.pixelpal.setInteractive(next);
    canvas!.style.cursor = next ? 'grab' : 'default';
  }

  window.pixelpal.onCursorMove((info) => {
    cursorX = info.x;
    cursorY = info.y;
    cursorMovedAt = performance.now();
    if (!dragging && !pressed) {
      setInteractive(info.inside && isSolidAt(info.x, info.y));
    }
  });

  window.pixelpal.onInputStats((s) => {
    stats = s;
  });

  window.pixelpal.onDragTick((v) => {
    physics.onDragVelocity(v.vx, v.vy, performance.now());
  });

  // ---------------------------------------------------------------------
  // Press handling: click = pet (purr), move past threshold = drag
  // ---------------------------------------------------------------------
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !interactive) return;
    pressed = true;
    pressX = e.clientX;
    pressY = e.clientY;
  });

  window.addEventListener('mousemove', (e) => {
    if (!pressed || dragging) return;
    if (Math.hypot(e.clientX - pressX, e.clientY - pressY) >= DRAG_START_DIST) {
      dragging = true;
      canvas!.style.cursor = 'grabbing';
      physics.beginDrag();
      window.pixelpal.beginDrag(pressX, pressY);
    }
  });

  function releaseDrag(): void {
    dragging = false;
    window.pixelpal.endDrag();
    if (stay) {
      // Stay command: settle in place (spring back), no falling.
      physics.cancel();
      fsm.set('idle');
    } else {
      physics.release();
      fsm.set('falling');
    }
  }

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    if (dragging) {
      releaseDrag();
      setInteractive(isSolidAt(e.clientX, e.clientY));
    } else if (pressed) {
      // A press without movement: pet the cat.
      fsm.set('purr');
      heartsToSpawn = 5;
    }
    pressed = false;
  });

  window.addEventListener('blur', () => {
    if (dragging) releaseDrag();
    pressed = false;
  });

  // ---------------------------------------------------------------------
  // Movement application (fractional deltas accumulate; whole-px IPC steps)
  // ---------------------------------------------------------------------
  let pendingX = 0;
  let pendingY = 0;
  let moveInFlight = false;

  function applyMove(dx: number, dy: number): void {
    pendingX += dx;
    pendingY += dy;
    const stepX = Math.trunc(pendingX);
    const stepY = Math.trunc(pendingY);
    if ((stepX === 0 && stepY === 0) || moveInFlight) return;
    pendingX -= stepX;
    pendingY -= stepY;
    moveInFlight = true;
    window.pixelpal
      .moveBy(stepX, stepY)
      .then((result) => {
        moveInFlight = false;
        clampedX = result?.clampedX ?? false;
        clampedY = result?.clampedY ?? false;
      })
      .catch(() => {
        moveInFlight = false;
      });
  }

  // ---------------------------------------------------------------------
  // Eye tracking overlay
  // ---------------------------------------------------------------------
  function drawEyes(anim: string, flipX: boolean): void {
    const anchors = EYE_ANCHORS[anim];
    if (!anchors) return;
    const furColor = palette.colors[2] ?? '#f5a962';
    const pupilColor = palette.colors[1] ?? '#1a1a24';
    const sparkleColor = palette.colors[4] ?? '#fff7ed';
    for (const [ax, ay, eyeW, eyeH] of anchors) {
      // mirror the eye's left edge when flipped
      const ex = flipX ? SPRITE_SIZE - ax - eyeW : ax;
      const px = geo.offX + ex * geo.scale;
      const py = geo.offY + ay * geo.scale;
      const w = eyeW * geo.scale;
      const h = eyeH * geo.scale;
      const ddx = cursorX - (px + w / 2);
      const ddy = cursorY - (py + h / 2);
      const len = Math.hypot(ddx, ddy);
      const off = len > 4 ? 0.7 : 0;
      const ox = (ddx / (len || 1)) * off * geo.scale;
      const oy = (ddy / (len || 1)) * off * geo.scale * 0.6;
      ctx!.fillStyle = furColor;
      ctx!.fillRect(px, py, w, h);
      ctx!.fillStyle = pupilColor;
      ctx!.fillRect(px + ox, py + oy, w, h);
      if (eyeW >= 2) {
        // kawaii sparkle in the pupil's upper-right
        ctx!.fillStyle = sparkleColor;
        ctx!.fillRect(
          px + ox + w - geo.scale * 0.7,
          py + oy + geo.scale * 0.15,
          geo.scale * 0.55,
          geo.scale * 0.55
        );
      }
    }
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------
  let currentFlip = false;
  let currentAnim = 'idle';
  let steamTimer = 0;
  let heartTimer = 0;
  let heartsToSpawn = 0;

  startLoop(
    (dt) => {
      const now = performance.now();
      const out = fsm.update(dt, {
        cursorX,
        cursorY,
        msSinceCursorMove: Math.min(now - cursorMovedAt, stats.msSinceMouse),
        msSinceKey: stats.msSinceKey,
        kpm: stats.kpm,
        hooksActive: stats.hooksActive,
        dragging,
        quiet,
        stay,
        clampedX,
        clampedY
      });
      player.play(out.anim);
      player.update(dt);
      if (out.move) applyMove(out.move.dx, out.move.dy);
      currentFlip = out.flipX;
      currentAnim = out.anim;

      // Physics: falling movement + landing, squash springs, wobble.
      const fallStep = physics.update(dt);
      if (fsm.current === 'falling') {
        if (fallStep) applyMove(fallStep.dx, fallStep.dy);
        if (clampedY && physics.fallVy > 0) {
          physics.land(physics.fallVy);
          fsm.set('idle');
        }
        if (clampedX) physics.fallVx = 0;
      } else if (physics.mode === 'fall') {
        // FSM left falling some other way (e.g. drag restarted) — sync.
        physics.cancel();
      }

      // Particles: overheat steam and purr hearts.
      const s = geo.scale / 8;
      if (currentAnim === 'overheat') {
        steamTimer += dt;
        if (steamTimer >= STEAM_INTERVAL_MS) {
          steamTimer = 0;
          // bongo pose: head is near the top of the sprite box
          particles.spawn('steam', geo.offX + (44 + Math.random() * 40) * s, geo.offY + 8 * s);
        }
      }
      if (heartsToSpawn > 0) {
        heartTimer += dt;
        if (heartTimer >= HEART_INTERVAL_MS) {
          heartTimer = 0;
          heartsToSpawn--;
          particles.spawn('heart', geo.offX + (44 + Math.random() * 40) * s, geo.offY + 44 * s);
        }
      }
      particles.update(dt);
      bubble.update();
    },
    () => {
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.save();
      ctx.translate(geo.anchorX, geo.anchorY);
      ctx.rotate(physics.wobble * 0.35);
      ctx.scale(physics.scaleX, physics.scaleY);
      ctx.translate(-geo.anchorX, -geo.anchorY);
      player.draw(ctx, palette, geo.offX, geo.offY, geo.scale, currentFlip);
      drawEyes(currentAnim, currentFlip);
      ctx.restore();
      particles.draw(ctx);
      drawRing(ctx, pomoState, RING_CX, RING_CY);
      bubble.draw(ctx, geo.tailX, geo.tailY);
    }
  );
}

boot().catch((err) => {
  console.error('renderer boot failed:', err);
});
