import { getCurrentWindow } from '@tauri-apps/api/window';
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { settingsStore } from '../settings/settings-store';
import { log } from '../utils/logger';

const STORAGE_KEY = 'neopad-window-position';

interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

function saveWindowState(state: WindowState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function loadWindowState(): WindowState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return null;
}

export async function restoreWindowPosition(): Promise<void> {
  if (!settingsStore.get().restoreWindowPosition) {
    log.info('window-state: restore disabled by settings');
    return;
  }

  const state = loadWindowState();
  if (!state) {
    log.info('window-state: no stored state to restore');
    return;
  }

  log.info('window-state: restoring', JSON.stringify(state));
  const win = getCurrentWindow();

  try {
    if (state.isMaximized) {
      await win.maximize();
    } else {
      // outerPosition/outerSize return PHYSICAL pixels, so we must restore
      // them as physical pixels too. Using LogicalPosition would double the
      // coordinates on Retina displays.
      await win.setPosition(new PhysicalPosition(state.x, state.y));
      await win.setSize(new PhysicalSize(state.width, state.height));
    }
    log.info('window-state: restore complete');
  } catch (err) {
    log.error('window-state: restore failed', err instanceof Error ? err.message : String(err));
  }
}

export async function startWindowPositionTracking(): Promise<void> {
  const win = getCurrentWindow();

  async function captureState(): Promise<void> {
    if (!settingsStore.get().restoreWindowPosition) return;

    try {
      const isMaximized = await win.isMaximized();
      const pos = await win.outerPosition();
      const size = await win.outerSize();

      const state = {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
        isMaximized,
      };
      saveWindowState(state);
    } catch (err) {
      log.error('window-state: capture failed', err instanceof Error ? err.message : String(err));
    }
  }

  // Save on move and resize
  await win.onMoved(() => captureState());
  await win.onResized(() => captureState());

  // Save periodically as a safety net (no onCloseRequested — Rust handles exit)
  setInterval(captureState, 5000);

  // Also save immediately on page unload so the very last position is captured
  window.addEventListener('beforeunload', () => {
    captureState();
  });

  log.info('window-state: tracking started');
}
