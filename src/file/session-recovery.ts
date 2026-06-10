import { getTabs, getActiveId, addTab, setActive, onTabsChange } from '../tabs/tab-store';
import { setEditorModel, getEditor } from '../editor/editor-manager';
import { isNeoFile } from '../crypto/crypto-manager';
import { lockManager } from '../crypto/lock-manager';
import { log } from '../utils/logger';

const STORAGE_KEY = 'neopad-session';
const SAVE_INTERVAL_MS = 2000;

interface SavedTab {
  id: string;
  title: string;
  filePath: string | null;
  language: string;
  content: string;
  isDirty: boolean;
  /** True when the tab belongs to an encrypted .neo file */
  isEncrypted?: boolean;
}

interface SavedSession {
  tabs: SavedTab[];
  activeIdx: number;
  timestamp: number;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const watchedModels = new WeakSet<import('monaco-editor').editor.ITextModel>();

function serializeSession(): SavedSession {
  const tabs = getTabs();
  const activeId = getActiveId();
  const activeIdx = tabs.findIndex((t) => t.id === activeId);

  return {
    tabs: tabs.map((t) => {
      const encrypted = t.filePath ? isNeoFile(t.filePath) : false;
      return {
        id: t.id,
        title: t.title,
        filePath: t.filePath,
        language: t.language,
        // Never persist plaintext content of encrypted files
        content: encrypted ? '' : t.model.getValue(),
        isDirty: encrypted ? false : t.isDirty,
        isEncrypted: encrypted || undefined,
      };
    }),
    activeIdx: Math.max(0, activeIdx),
    timestamp: Date.now(),
  };
}

function saveSession(): void {
  try {
    const session = serializeSession();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage full or unavailable
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSession, SAVE_INTERVAL_MS);
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Restore session from localStorage.
 * Returns true if tabs were restored.
 */
export function restoreSession(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;

    const session: SavedSession = JSON.parse(raw);
    if (!session.tabs || session.tabs.length === 0) return false;

    let restoredCount = 0;
    for (const saved of session.tabs) {
      // Only restore tabs that had content or a file path
      if (!saved.content && !saved.filePath) continue;

      const tab = addTab(saved.filePath, saved.content, saved.language);
      // Unsaved content is always dirty
      if (saved.isDirty || (!saved.filePath && saved.content)) {
        tab.isDirty = true;
      }
      // Mark encrypted tabs as locked — the lock overlay will prompt for the
      // password when the user activates the tab.
      if (saved.isEncrypted && saved.filePath) {
        // Register with an empty password — the tab is locked from the start
        lockManager.registerEncryptedTab(tab.id, '');
        lockManager.lockTab(tab.id, '');
      }
      restoredCount++;
    }

    if (restoredCount === 0) return false;

    // Activate the previously focused tab — but never auto-open a locked tab,
    // so the user isn't greeted by the "File Locked" overlay on startup.
    const tabs = getTabs();
    let idx = Math.min(session.activeIdx, tabs.length - 1);
    if (idx >= 0 && tabs[idx] && lockManager.isLocked(tabs[idx].id)) {
      idx = tabs.findIndex((t) => !lockManager.isLocked(t.id));
    }
    if (idx >= 0 && tabs[idx]) {
      setActive(tabs[idx].id);
      setEditorModel(tabs[idx].model);
    } else {
      // All restored tabs are locked — open a fresh tab so the lock screen
      // doesn't appear automatically at startup.
      const fresh = addTab();
      setActive(fresh.id);
      setEditorModel(fresh.model);
    }

    log.info(
      'session-restore: restored',
      restoredCount,
      'tabs; activeIdx',
      session.activeIdx,
      '-> chosen',
      idx,
      idx >= 0 && tabs[idx] ? `(locked=${lockManager.isLocked(tabs[idx].id)})` : '(fresh tab)',
    );

    return true;
  } catch {
    return false;
  }
}

/**
 * Start auto-saving session state on every change.
 */
export function startSessionAutoSave(): void {
  const watchAllTabs = () => {
    for (const tab of getTabs()) {
      if (watchedModels.has(tab.model)) continue;
      watchedModels.add(tab.model);
      tab.model.onDidChangeContent(() => scheduleSave());
    }
  };

  watchAllTabs();

  onTabsChange(() => {
    watchAllTabs();
    scheduleSave();
  });

  // Also save on content edits (debounced)
  getEditor()?.onDidChangeModelContent(() => scheduleSave());

  // Periodic safety net
  setInterval(saveSession, 10000);

  // Save immediately before page unload
  window.addEventListener('beforeunload', () => {
    saveSession();
  });
}
