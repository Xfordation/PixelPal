Project: build a cross-platform desktop pet app in Electron called "PixelPal"

Build a desktop pet application — a pixel-art cat that lives on top of my desktop as a transparent always-on-top overlay, reacts to my mouse and keyboard activity, and doubles as a lightweight focus/wellness timer. Target macOS and Windows.

Scope this as a working MVP that I can run with npm start. Do not stub core behavior — the cat must actually move, animate, and respond to real global input by the end.

Stack and constraints

Use Electron (latest stable) with plain TypeScript, Vite for the renderer build, and electron-builder for packaging. Render the cat on an HTML5 canvas — no React, no game engine, no Tailwind. Keep dependencies minimal. Use uiohook-napi for global input hooks and electron-store for settings persistence. Enable context isolation, disable node integration in the renderer, and expose a narrow typed API over contextBridge in a preload script. All IPC channels must be explicitly whitelisted.

Window behavior

Create a frameless, transparent, always-on-top window: transparent: true, frame: false, alwaysOnTop: true (use the screen-saver level so it floats over fullscreen apps), skipTaskbar: true, resizable: false, hasShadow: false. On macOS set the window to appear on all workspaces and hide the dock icon (app.dock.hide()). Size the window to a small sprite box (roughly 128×128 logical px, DPI-aware).

Implement click-through correctly: the window should ignore mouse events by default via setIgnoreMouseEvents(true, { forward: true }), and the renderer should track cursor position over the canvas and toggle it off only when the cursor is over non-transparent sprite pixels, so I can click and drag the cat but clicks elsewhere pass through to whatever is underneath. Implement this hit test by sampling the canvas alpha channel.

Add a tray icon with a menu: toggle visibility, start/stop Pomodoro, open Settings, quit. Persist the cat's last screen position and restore it on launch. Handle multi-monitor correctly and clamp the cat inside the display it's currently on.

Global input and permissions

Use uiohook-napi in the main process to listen for global mouse-move, mouse-click, and key-down events. Never record key identities or content — only count events and compute a rolling keystrokes-per-minute rate over a 5-second window. Throttle mouse-move forwarding to the renderer to about 30 Hz over IPC so CPU stays low.

On macOS, check Accessibility permission with systemPreferences.isTrustedAccessibilityClient on startup. If it isn't granted, show a friendly onboarding window explaining why it's needed and a button that opens System Settings at the Accessibility pane. The app must degrade gracefully and still run (cat idles and timers work) without the permission — never crash or hang.

Cat behavior — finite state machine

Implement a proper FSM in the renderer with these states: idle, blink, walk, run, sit, sleep, chase, dragged, falling, typing, overheat, stretch, alert.

Transitions: after 60 seconds of no input, go to sleep; any input wakes it. When the cursor moves more than 300 px away, chase it by walking/running toward it, easing to a stop nearby. While I'm typing, play typing; if keystroke rate exceeds a configurable threshold (default 300 KPM), switch to overheat with a steam particle effect above the head. Idle behavior should include random wandering, blinking, and sitting on a randomized timer so it never feels static. The eyes should track the cursor in all states.

Direct interaction: I can left-click-drag the cat to move it. While dragged, apply squash-and-stretch scaling proportional to drag velocity along the drag vector, and on release run a damped spring that overshoots and settles — the cat should feel like mochi. On release, if it's above the "floor," play falling with gravity until it lands on the bottom of the current display or on the window edge. A quick shake while dragging makes it wobble side to side. Clicking without dragging pets it: play a purr animation with floating heart particles.

Sprite pipeline

Write the animation system to consume a sprite sheet PNG plus a JSON manifest describing each animation (name, frame rects, frame durations, loop flag). Since you don't have art, generate placeholder programmatically: produce a simple pixel-art cat sprite sheet at build time with a small Node script that draws the frames onto a canvas, and write the matching JSON. Keep the loader completely generic so I can drop in a real Aseprite export later without code changes. Document the exact manifest format in the README.

Implement palette swapping so the cat's color and pattern can be recolored at runtime: draw the sprite in indexed grayscale and remap through a palette in a single canvas pixel pass, cached per palette. Ship at least four preset palettes plus a custom color picker in Settings.

Timers and reminders

Build a Pomodoro engine in the main process (default 25/5, configurable, with long break every 4 cycles) that survives window reloads, and render a small pixel-art progress ring floating next to the cat while it's running. Add recurring stretch reminders and water reminders on configurable intervals — when one fires, the cat plays stretch or alert, shows a small speech bubble with the message, and optionally fires a native OS notification. Add user-defined one-off alarms with a custom time and message. Add a "pin a note" feature that displays persistent text in a bubble above the cat's head.

Add a "quiet mode" toggle that moves the cat to the nearest screen edge, stops idle wandering, and only surfaces for reminders.

Settings window

A separate small, normal (non-transparent) BrowserWindow with plain HTML/CSS: cat color/pattern, sprite scale, typing threshold, Pomodoro durations, reminder intervals on/off, quiet mode, launch at login (app.setLoginItemSettings), and a reset-to-defaults button. Persist everything with electron-store and apply changes live via IPC without restarting.

Non-negotiables

No telemetry, no network requests, no analytics of any kind — the app must work fully offline. Idle CPU usage should stay under about 2% on a modern laptop: pause the render loop when the cat is offscreen or hidden, use requestAnimationFrame with a fixed timestep accumulator, and avoid per-frame allocations.

Deliverables

Structure the repo as src/main (window, tray, input hooks, timers, IPC), src/preload, src/renderer (canvas, FSM, animation, physics, particles), assets, and scripts (the sprite generator). Include electron-builder config producing a macOS DMG (universal, with the Accessibility usage description in the entitlements/Info.plist) and a Windows NSIS installer. Add a README covering setup, the sprite manifest format, how to add a new animation state, how to swap in real art, and what's required for code signing and notarization later.

How to work

Build this incrementally and verify each stage before moving on, in this order: (1) transparent always-on-top window showing a static placeholder sprite; (2) canvas render loop plus the animation/manifest system; (3) alpha-based hit testing and click-through, with drag-and-drop working; (4) global input hooks and the macOS permission flow; (5) the full FSM with chase, sleep, typing, and overheat; (6) squash-and-stretch physics, falling, and particles; (7) timers, reminders, and speech bubbles; (8) tray and settings window; (9) packaging config and README. After each stage, tell me how to test it manually and pause for my confirmation before continuing.

Ask me any clarifying questions before you start writing code.
