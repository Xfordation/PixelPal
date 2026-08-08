# PixelPal 🐱

A pixel-art desktop cat that lives on top of your desktop as a transparent,
always-on-top overlay. It reacts to your real mouse and keyboard activity,
chases your cursor across monitors, sleeps when you're away, overheats when
you type like a maniac — and doubles as a Pomodoro / wellness timer.

Built with Electron + TypeScript + Vite, rendered on a raw HTML5 canvas.
No frameworks, no game engine, no telemetry, fully offline.

## Quick start

```bash
npm install
npm start        # build main + preload + renderer, then launch
```

Requirements: Node 18+ and npm. On Windows and macOS the global input hook
(`uiohook-napi`) ships prebuilt N-API binaries — no compiler needed.

### macOS permission

On macOS the app needs the **Accessibility** permission to see global mouse
and keyboard activity. On first launch without it, an onboarding window
explains this and deep-links to System Settings → Privacy & Security →
Accessibility. Without the permission the cat still runs (idle behaviors and
all timers work) — it just can't react to your activity.

**Privacy:** input handlers record only event *timestamps*. Key identities
are never read, stored, or transmitted. The only derived metric is a rolling
keystrokes-per-minute rate over a 5-second window. The app makes no network
requests of any kind.

## Using the cat

| Interaction | Result |
| --- | --- |
| Click the cat | Purrs with floating hearts |
| Drag it | Mochi squash-and-stretch; release to toss it (gravity!) |
| Shake it while dragging | Side-to-side wobble |
| Move cursor >300px away | It chases, easing to a stop nearby |
| Type | Typing animation; >300 KPM (configurable) = overheat + steam |
| Do nothing for 60s | It falls asleep; any input wakes it |
| Tray icon left-click | Hide / show the cat |
| Tray icon right-click | Menu: Pomodoro, quiet mode, stay, settings, quit |

**Quiet mode** parks the cat at the nearest screen edge and stops wandering,
chasing, and typing reactions — it only surfaces for reminders.

**Stay** freezes the cat wherever you put it (no wandering, chasing, or
falling — it even floats mid-air if you drop it there).

Timers: the Pomodoro engine (default 25/5, long break every 4 cycles) lives
in the main process and survives window reloads. A pixel progress ring floats
next to the cat while running. Stretch and water reminders, one-off alarms,
and a pinned note are all configured from the Settings window.

## Repository layout

```
src/main/       app lifecycle, pet window, tray, input hooks, timers, IPC
src/preload/    sandboxed contextBridge API (the only renderer<->main surface)
src/renderer/   canvas rendering, FSM, physics, particles, bubbles, settings UI
src/shared/     IPC channel names
scripts/        build-time sprite generator (placeholder art + tray/app icons)
assets/         generated tray + app icons
build/          electron-builder resources (macOS entitlements)
```

Security posture: context isolation on, node integration off, sandboxed
renderers, all IPC channels explicitly whitelisted in `src/shared/ipc.ts`
and re-inlined in the preload (sandboxed preloads can't import project
modules — keep them in sync).

## Sprite pipeline

The renderer consumes a sprite sheet PNG plus a JSON manifest in **Aseprite's
"Array" export format**. The placeholder art is generated at build time by
`scripts/generate-sprites.mjs` (no dependencies — it hand-encodes the PNG).

### Manifest format (`src/renderer/public/sprites/cat.json`)

```jsonc
{
  "frames": [
    {
      "filename": "cat 0.aseprite",
      "frame": { "x": 0, "y": 0, "w": 16, "h": 16 },  // rect in the sheet
      "duration": 900                                   // ms for this frame
    }
    // ... one entry per frame
  ],
  "meta": {
    "image": "cat.png",
    "size": { "w": 512, "h": 16 },
    "frameTags": [
      { "name": "idle", "from": 0, "to": 1, "direction": "forward" }
      // ... one tag per animation; from/to index into frames[]
    ]
  }
}
```

The loader (`src/renderer/sprites.ts`) is generic: any sheet + manifest pair
with these fields works. Looping is decided by the caller (`player.play(name,
{ loop: false })`); an optional Aseprite 1.3 `repeat` field on a tag is
tolerated.

### Animation states the app expects

`idle, blink, sit, walk, run, sleep, chase, dragged, falling, typing,
overheat, stretch, alert, purr`

### Adding a new animation state

1. Add frames for it — either draw them in `scripts/generate-sprites.mjs`
   (add an entry to `ANIMATIONS`) or in your Aseprite file with a new tag.
2. Add the state name to `PetStateName` in `src/renderer/fsm.ts` and give it
   transitions in `PetFsm.update()` (see the timed-state `switch` for simple
   one-shot states).
3. If the state's eyes should track the cursor, add eye pixel coordinates to
   `EYE_ANCHORS` in `src/renderer/main.ts`.

### Swapping in real art

Export from Aseprite with **File → Export Sprite Sheet**, JSON data type
**Array**, and tag your animations with the names above. Then replace:

```
src/renderer/public/sprites/cat.png
src/renderer/public/sprites/cat.json
```

No code changes needed if your frame size differs from 16×16 — the renderer
reads rects from the manifest — but the sprite box is drawn at `16px × scale`,
so keep frames square and update `SPRITE_SIZE` in `src/renderer/main.ts` if
you change the base resolution.

**Palette swapping:** the placeholder art is drawn in *indexed grayscale* —
each gray value maps to a palette slot (see `INDEX_GRAY` in
`src/renderer/sprites.ts`), remapped to colors in one cached pixel pass. If
your real art is pre-colored, palette swapping simply won't apply (delete the
palette section from settings, or author art in the same grayscale indices to
keep it).

## Dev/test hooks

`PIXELPAL_TEST` (comma list) runs slow features on short timers:

```powershell
$env:PIXELPAL_TEST='pomo,reminder,note,settings'; npm start
```

- `pomo` — starts a ~12s-work Pomodoro cycle after 3s
- `reminder` — fires stretch (+4s) and water (+12s) reminders
- `note` — pins a test note
- `settings` — auto-opens the settings window
- `palette` — switches to the seafoam palette after 4s (tests live-apply)

## Packaging

```bash
npm run dist:win   # Windows NSIS installer  -> release/
npm run dist:mac   # macOS DMG (universal)   -> release/  (run on a Mac)
```

Configuration lives in the `build` key of `package.json`. Native modules
(`uiohook-napi`) are unpacked from the asar automatically (`asarUnpack`).

### Windows notes

- The NSIS installer is interactive (choose install dir) and creates a
  desktop + start-menu shortcut named *PixelPal*.
- Unsigned builds will trip SmartScreen ("Windows protected your PC") —
  users click *More info → Run anyway*. For real distribution, sign with an
  EV or OV code-signing certificate: set `win.certificateFile` /
  `certificatePassword` (or `win.signtoolOptions`) in the build config, or
  use Azure Trusted Signing.

### macOS notes (signing & notarization)

The DMG target builds a universal (x64 + arm64) app with the hardened
runtime and the entitlements in `build/entitlements.mac.plist` (JIT +
unsigned executable memory for Electron, library validation disabled for the
native input hook).

To distribute outside your own machine you must sign and notarize:

1. Join the Apple Developer Program; create a **Developer ID Application**
   certificate and install it in your keychain.
2. Set environment variables before `npm run dist:mac`:
   `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` —
   electron-builder then signs and notarizes automatically.
3. Accessibility permission is granted by the user in System Settings (there
   is no Info.plist key that pre-authorizes it); the app's onboarding window
   walks them through it. The `NSAccessibilityUsageDescription` string in
   `extendInfo` documents intent for App Review-style tooling.
4. `LSUIElement` is set so the app has no Dock icon (it lives in the menu
   bar / tray).

## Performance

- Fixed-timestep 60 Hz update loop on `requestAnimationFrame`; rendering
  pauses automatically when the cat is hidden.
- Zero per-frame allocations in the hot path (pooled particles, reused
  buffers); the sprite sheet is recolored once per palette and cached.
- Cursor polling streams only when the cursor actually moves; input stats
  are computed from timestamp counters at 4 Hz.
