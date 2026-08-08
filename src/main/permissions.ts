// macOS Accessibility permission flow.
//
// Global input hooks on macOS require the Accessibility permission. On other
// platforms `ensureInputPermission` reports true immediately. Without the
// permission the app must still run (cat idles, timers work) — the caller
// simply skips starting the hooks.

import { BrowserWindow, ipcMain, shell, systemPreferences } from 'electron';
import * as path from 'path';
import { IPC } from '../shared/ipc';

let onboardingWindow: BrowserWindow | null = null;

export function hasInputPermission(): boolean {
  if (process.platform !== 'darwin') return true;
  // false = do not prompt; we show our own onboarding instead.
  return systemPreferences.isTrustedAccessibilityClient(false);
}

export function showOnboardingWindow(): void {
  if (onboardingWindow) {
    onboardingWindow.focus();
    return;
  }
  onboardingWindow = new BrowserWindow({
    width: 420,
    height: 360,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'PixelPal needs a permission',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  onboardingWindow.loadFile(path.join(__dirname, '../renderer/onboarding.html'));
  onboardingWindow.on('closed', () => {
    onboardingWindow = null;
  });
}

export function registerPermissionIpc(onGranted: () => void): void {
  ipcMain.on(IPC.openAccessibilitySettings, () => {
    void shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    );
  });

  ipcMain.handle(IPC.recheckAccessibility, () => {
    const granted = hasInputPermission();
    if (granted) {
      onboardingWindow?.close();
      onGranted();
    }
    return granted;
  });
}
