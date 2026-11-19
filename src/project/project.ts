import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { getActiveTab } from '../tabs/tab-store';
import { getEditor } from '../editor/editor-manager';
import { openFileByPath } from '../file/file-ops';
import { log } from '../utils/logger';

/**
 * The open folder ("project"): which folder it is, the sidebar state that is
 * remembered with it, and opening its files in tabs. The sidebar, Go to File
 * and Find in Files all build on this.
 */

const STORAGE_KEY = 'neopad-project';

interface ProjectState {
  root: string | null;
  /** Expanded folders in the file tree (absolute paths). */
  expanded: string[];
  sidebarVisible: boolean;
  sidebarWidth: number;
}

/** Where to put the cursor after opening a file. */
export interface FileTarget {
  line: number;
  startColumn: number;
  endColumn: number;
}

const state: ProjectState = loadState();
const listeners: (() => void)[] = [];

function loadState(): ProjectState {
  const defaults: ProjectState = { root: null, expanded: [], sidebarVisible: false, sidebarWidth: 240 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

export function saveProjectState(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable
  }
}

export function getProjectState(): ProjectState {
  return state;
}

export function getProjectRoot(): string | null {
  return state.root;
}

export function getProjectName(): string {
  return state.root ? state.root.split('/').filter(Boolean).pop() ?? state.root : '';
}

/** Called when a folder is opened or closed. */
export function onProjectChange(fn: () => void): void {
  listeners.push(fn);
}

/** Make `path` the open folder, or close the folder with `null`. */
export async function setProjectRoot(path: string | null): Promise<boolean> {
  let root: string | null = null;
  if (path) {
    try {
      root = await invoke<string>('project_open', { path });
    } catch (err) {
      log.error('project: cannot open folder', path, err instanceof Error ? err.message : String(err));
      return false;
    }
  }
  if (root !== state.root) {
    state.root = root;
    state.expanded = [];
  }
  if (root) state.sidebarVisible = true;
  saveProjectState();
  listeners.forEach((fn) => fn());
  return true;
}

/** Ask for a folder and open it. */
export async function pickFolder(): Promise<void> {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== 'string') return;
  if (!(await setProjectRoot(picked))) alert(`Could not open the folder "${picked}".`);
}

/** Re-open the folder from the last session. Call once at startup. */
export async function restoreProject(): Promise<void> {
  if (state.root) {
    try {
      // Going through project_open again re-grants write access to the folder.
      state.root = await invoke<string>('project_open', { path: state.root });
    } catch (err) {
      log.warn('project: last folder is gone:', state.root, err instanceof Error ? err.message : String(err));
      state.root = null;
      state.expanded = [];
      saveProjectState();
    }
  }
  listeners.forEach((fn) => fn());
}

/** Show a file in a tab, switching to its tab if it is already open. */
export async function openProjectFile(path: string, target?: FileTarget): Promise<void> {
  await openFileByPath(path);

  const editor = getEditor();
  if (!editor) return;
  if (target && getActiveTab()?.filePath === path) {
    const range = {
      startLineNumber: target.line,
      startColumn: target.startColumn,
      endLineNumber: target.line,
      endColumn: target.endColumn,
    };
    editor.setSelection(range);
    editor.revealRangeInCenter(range);
  }
  editor.focus();
}
