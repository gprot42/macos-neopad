import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { settingsStore } from '../settings/settings-store';
import { getActiveTab } from '../tabs/tab-store';
import { log } from '../utils/logger';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { FitAddon as XFitAddon } from '@xterm/addon-fit';

let term: XTerm | null = null;
let fitAddon: XFitAddon | null = null;
let panelEl: HTMLElement | null = null;
let handleEl: HTMLElement | null = null;
let xtermEl: HTMLElement | null = null;
let outputUnlisten: UnlistenFn | null = null;
let exitUnlisten: UnlistenFn | null = null;
let sessionLive = false;
let initialized = false;

const MIN_FONT = 8;
const MAX_FONT = 32;

function currentFontSize(): number {
  const fs = settingsStore.get().terminalFontSize;
  return Math.min(MAX_FONT, Math.max(MIN_FONT, fs || 13));
}

const THEMES: Record<string, Record<string, string>> = {
  'tokyo-night': {
    background: '#1a1b26',
    foreground: '#c0caf5',
    cursor: '#c0caf5',
    selectionBackground: '#33467c',
  },
  dark: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    selectionBackground: '#264f78',
  },
  light: {
    background: '#ffffff',
    foreground: '#1f1f1f',
    cursor: '#1f1f1f',
    selectionBackground: '#add6ff',
  },
  mariana: {
    background: '#343d46',
    foreground: '#d8dee9',
    cursor: '#d8dee9',
    selectionBackground: '#4f5b66',
  },
};

function themeColors() {
  const t = settingsStore.get().theme;
  return THEMES[t] ?? THEMES['tokyo-night'];
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Lazily create the xterm instance and wire IPC. Safe to call repeatedly. */
async function ensureTerm(): Promise<void> {
  if (term) return;

  panelEl = document.getElementById('terminal-panel');
  handleEl = document.getElementById('terminal-resize-handle');
  xtermEl = document.getElementById('terminal-xterm');
  if (!panelEl || !xtermEl) {
    log.error('terminal: #terminal-panel/#terminal-xterm not found in DOM');
    return;
  }

  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
  ]);
  // Load stylesheet separately so a CSS import failure can't block the terminal.
  try {
    await import('@xterm/xterm/css/xterm.css');
  } catch (e) {
    log.warn('terminal: xterm.css import failed (continuing)', String(e));
  }

  term = new Terminal({
    fontSize: currentFontSize(),
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    cursorBlink: true,
    theme: themeColors(),
    scrollback: 5000,
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(xtermEl);

  term.onData((d) => {
    if (sessionLive) void invoke('pty_write', { data: d });
  });

  let outputCount = 0;
  outputUnlisten = await listen<string>('pty-output', (e) => {
    outputCount++;
    if (outputCount <= 3) {
      log.info('terminal: output event', { n: outputCount, bytes: e.payload.length });
    }
    if (term) term.write(decodeBase64ToBytes(e.payload));
  });
  exitUnlisten = await listen('pty-exit', () => {
    sessionLive = false;
    void hideTerminal();
  });

  // Recolor when the app theme changes.
  settingsStore.onChange(() => {
    if (term) term.options.theme = themeColors();
  });

  setupDragHandle();
  setupToolbar();
}

function applyFontSize(size: number): void {
  const clamped = Math.min(MAX_FONT, Math.max(MIN_FONT, size));
  settingsStore.update({ terminalFontSize: clamped });
  if (term) {
    term.options.fontSize = clamped;
    fitAndResize();
  }
}

export function increaseTerminalFont(): void {
  applyFontSize(currentFontSize() + 1);
}

export function decreaseTerminalFont(): void {
  applyFontSize(currentFontSize() - 1);
}

function setupToolbar(): void {
  const dec = document.getElementById('term-font-dec');
  const inc = document.getElementById('term-font-inc');
  const close = document.getElementById('term-close');
  dec?.addEventListener('click', () => decreaseTerminalFont());
  inc?.addEventListener('click', () => increaseTerminalFont());
  close?.addEventListener('click', () => void hideTerminal());
}

function fitAndResize(): void {
  if (!fitAddon || !term) return;
  try {
    fitAddon.fit();
  } catch {
    // ignore transient layout errors
  }
  if (sessionLive) {
    void invoke('pty_resize', { cols: term.cols, rows: term.rows });
  }
}

function setupDragHandle(): void {
  if (!handleEl || !panelEl) return;
  let dragging = false;

  handleEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging || !panelEl) return;
    const maxH = window.innerHeight * 0.6;
    const newH = Math.min(maxH, Math.max(80, window.innerHeight - e.clientY));
    panelEl.style.height = `${newH}px`;
    fitAndResize();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (panelEl) {
      settingsStore.update({ terminalHeight: panelEl.offsetHeight });
    }
  });
}

export function isTerminalVisible(): boolean {
  return !!panelEl && !panelEl.classList.contains('hidden');
}

export async function showTerminal(): Promise<void> {
  log.info('terminal: showTerminal called');
  if (!settingsStore.get().terminalEnabled) {
    log.warn('terminal: feature disabled, aborting');
    return;
  }
  try {
    await ensureTerm();
  } catch (e) {
    log.error('terminal: ensureTerm failed', String(e));
    return;
  }
  if (!panelEl || !handleEl || !term) {
    log.error('terminal: missing DOM/term after ensureTerm', {
      panel: !!panelEl,
      handle: !!handleEl,
      term: !!term,
    });
    return;
  }

  const savedH = settingsStore.get().terminalHeight || 220;
  panelEl.style.height = `${savedH}px`;
  panelEl.classList.remove('hidden');
  handleEl.classList.remove('hidden');

  // Allow layout to settle before fitting.
  await new Promise((r) => requestAnimationFrame(r));
  fitAndResize();

  if (!sessionLive) {
    const active = getActiveTab();
    const cwd = active?.filePath
      ? active.filePath.replace(/\/[^/]*$/, '')
      : undefined;
    try {
      log.info('terminal: spawning pty', { cwd, cols: term.cols, rows: term.rows });
      await invoke('pty_spawn', {
        cwd: cwd ?? null,
        cols: term.cols,
        rows: term.rows,
      });
      sessionLive = true;
      log.info('terminal: pty spawned');
    } catch (e) {
      log.error('terminal: pty_spawn failed', String(e));
      if (term) term.write(`\r\n\x1b[31mFailed to start terminal: ${String(e)}\x1b[0m\r\n`);
      return;
    }
  }
  term.focus();
  settingsStore.update({ terminalOpen: true });
}

export async function hideTerminal(): Promise<void> {
  if (panelEl) panelEl.classList.add('hidden');
  if (handleEl) handleEl.classList.add('hidden');
  if (sessionLive) {
    await invoke('pty_kill');
    sessionLive = false;
  }
  if (term) term.clear();
  settingsStore.update({ terminalOpen: false });
}

export async function toggleTerminal(): Promise<void> {
  if (!settingsStore.get().terminalEnabled) return;
  if (isTerminalVisible()) {
    await hideTerminal();
  } else {
    await showTerminal();
  }
}

/** Called when the terminal feature is disabled in Settings. */
export async function disableTerminalFeature(): Promise<void> {
  if (isTerminalVisible()) await hideTerminal();
}

/**
 * Initialize the terminal subsystem at app startup. Restores the panel if it
 * was open last session and the feature is enabled.
 */
export async function initTerminal(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Re-fit on window resize while visible.
  window.addEventListener('resize', () => {
    if (isTerminalVisible()) fitAndResize();
  });

  const s = settingsStore.get();
  if (s.terminalEnabled && s.terminalOpen) {
    await showTerminal();
  }
}

// Keep references tidy if the module is ever torn down (not used in practice).
export function _cleanup(): void {
  outputUnlisten?.();
  exitUnlisten?.();
}
