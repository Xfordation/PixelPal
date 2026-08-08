// System tray icon and menu.

import { app, Menu, nativeImage, Tray } from 'electron';
import * as path from 'path';
import { getPetWindow } from './pet-window';
import { settings } from './settings';

export interface TrayActions {
  isPomodoroRunning(): boolean;
  startPomodoro(): void;
  stopPomodoro(): void;
  setQuiet(on: boolean): void;
  setStay(on: boolean): void;
  openSettings(): void;
}

let tray: Tray | null = null;
let actions: TrayActions | null = null;

export function createTray(trayActions: TrayActions): void {
  actions = trayActions;
  const iconPath = path.join(__dirname, '../../assets/tray.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip('PixelPal');
  refreshTrayMenu();

  tray.on('click', () => {
    // Left-click toggles cat visibility (Windows convention: quick access).
    toggleCat();
    refreshTrayMenu();
  });
}

function toggleCat(): void {
  const win = getPetWindow();
  if (!win) return;
  if (win.isVisible()) win.hide();
  else win.show();
}

export function refreshTrayMenu(): void {
  if (!tray || !actions) return;
  const win = getPetWindow();
  const visible = win?.isVisible() ?? false;
  const running = actions.isPomodoroRunning();
  const quiet = settings.get('quietMode');

  const menu = Menu.buildFromTemplate([
    {
      label: visible ? 'Hide cat' : 'Show cat',
      click: () => {
        toggleCat();
        refreshTrayMenu();
      }
    },
    { type: 'separator' },
    {
      label: running ? 'Stop Pomodoro' : 'Start Pomodoro',
      click: () => {
        if (actions!.isPomodoroRunning()) actions!.stopPomodoro();
        else actions!.startPomodoro();
        refreshTrayMenu();
      }
    },
    {
      label: 'Quiet mode',
      type: 'checkbox',
      checked: quiet,
      click: (item) => {
        actions!.setQuiet(item.checked);
        refreshTrayMenu();
      }
    },
    {
      label: 'Stay (don’t move)',
      type: 'checkbox',
      checked: settings.get('stayMode'),
      click: (item) => {
        actions!.setStay(item.checked);
        refreshTrayMenu();
      }
    },
    { type: 'separator' },
    {
      label: 'Settings…',
      click: () => actions!.openSettings()
    },
    { type: 'separator' },
    {
      label: 'Quit PixelPal',
      click: () => app.quit()
    }
  ]);
  tray.setContextMenu(menu);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
