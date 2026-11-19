import * as monaco from 'monaco-editor';
import { invoke } from '@tauri-apps/api/core';
import { getTabs, getActiveTab, markClean, markDirty, onTabsChange, type Tab } from '../tabs/tab-store';
import { getEditor } from '../editor/editor-manager';
import { lockManager } from '../crypto/lock-manager';
import { log } from '../utils/logger';

/**
 * Notices files that change on disk while they are open in a tab (git, another
 * editor, a command in the terminal panel).
 *
 *   - Tab without unsaved edits: the new content is loaded straight in.
 *   - Tab with unsaved edits: a banner offers to reload or keep the edits, and
 *     saving asks before overwriting the newer file.
 *   - File gone: the tab is marked modified and a banner says so.
 *
 * Detection is a poll of mtime + size rather than an FS watcher: it survives
 * editors that save by rename and works on network volumes, and stat-ing a
 * handful of files every couple of seconds costs nothing.
 */

const POLL_INTERVAL_MS = 2000;
/** Polls a file must be missing for before it counts as deleted (git checkout
 *  and some editors remove a file and write it back a moment later). */
const MISSING_POLLS = 2;

interface DiskStat {
  mtimeMs: number;
  size: number;
}

type Conflict = 'changed' | 'deleted';

interface Watch {
  path: string;
  /** Disk state the tab was last reconciled with; undefined = not looked at
   *  yet (tab restored from the session), null = file missing. */
  stat: DiskStat | null | undefined;
  /** Bumped whenever `stat` is rebased, so a check that was in flight across
   *  a save can tell its result is stale. */
  gen: number;
  missing: number;
  conflict: Conflict | null;
}

type Reader = (tab: Tab) => Promise<string>;

const watches = new Map<string, Watch>();
const saving = new Set<string>();
let reader: Reader | null = null;
let checking = false;
let warned = false;

function watchFor(tab: Tab): Watch {
  let w = watches.get(tab.id);
  if (!w || w.path !== tab.filePath) {
    w = { path: tab.filePath!, stat: undefined, gen: (w?.gen ?? 0) + 1, missing: 0, conflict: null };
    watches.set(tab.id, w);
  }
  return w;
}

async function statPaths(paths: string[]): Promise<(DiskStat | null)[] | null> {
  try {
    return await invoke<(DiskStat | null)[]>('file_stats', { paths });
  } catch (err) {
    if (!warned) {
      warned = true;
      log.warn('disk-watch: file_stats failed:', err instanceof Error ? err.message : String(err));
    }
    return null;
  }
}

function sameText(a: string, b: string): boolean {
  return a === b || a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
}

/** Replace a tab's content with what is on disk, as one undoable edit. */
function applyDiskText(tab: Tab, text: string): void {
  const model = tab.model;
  // Every editor showing this file (main pane, split pane) keeps its place.
  const views = monaco.editor
    .getEditors()
    .filter((ed) => ed.getModel() === model)
    .map((ed) => ({ ed, state: ed.saveViewState() }));

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (model.getEOL() !== eol) {
    model.setEOL(
      eol === '\r\n' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF,
    );
  }
  model.pushStackElement();
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
  model.pushStackElement();

  for (const { ed, state } of views) {
    if (state) ed.restoreViewState(state);
  }
  markClean(tab.id);
}

async function reconcile(tab: Tab, w: Watch, gen: number, stat: DiskStat | null): Promise<void> {
  if (!stat) {
    if (w.stat === null) return;
    if (++w.missing < MISSING_POLLS) return;
    w.stat = null;
    w.conflict = 'deleted';
    log.info('disk-watch: file gone:', w.path);
    // Nothing on disk backs this tab any more, so closing it should offer to save.
    markDirty(tab.id);
    return;
  }

  w.missing = 0;
  if (w.stat && w.stat.mtimeMs === stat.mtimeMs && w.stat.size === stat.size) return;
  const first = w.stat === undefined;

  let text: string;
  try {
    text = await reader!(tab);
  } catch (err) {
    if (w.gen !== gen) return;
    log.warn('disk-watch: could not read', w.path, err instanceof Error ? err.message : String(err));
    w.stat = stat;
    if (!first) w.conflict = 'changed';
    return;
  }
  // Saved, closed or locked while the file was being read.
  if (w.gen !== gen || watches.get(tab.id) !== w || lockManager.isLocked(tab.id)) return;

  const reappeared = w.conflict === 'deleted';
  w.stat = stat;

  if (sameText(text, tab.model.getValue())) {
    // Touched, rewritten with identical content, or put back after a delete.
    w.conflict = null;
    if (reappeared) markClean(tab.id);
    return;
  }

  if (tab.isDirty && !reappeared) {
    // A restored tab with unsaved edits has no earlier disk state to compare
    // against, so there is nothing to report on the first look.
    if (!first) {
      w.conflict = 'changed';
      log.info('disk-watch: changed on disk, tab has unsaved edits:', w.path);
    }
    return;
  }
  if (reappeared) {
    w.conflict = 'changed';
    return;
  }

  log.info('disk-watch: reloading', w.path);
  w.conflict = null;
  applyDiskText(tab, text);
}

async function check(tabs: Tab[]): Promise<void> {
  if (!reader) return;
  const targets = tabs
    .filter((t) => t.filePath && !saving.has(t.id) && !lockManager.isLocked(t.id))
    .map((tab) => {
      const w = watchFor(tab);
      return { tab, w, gen: w.gen };
    });
  if (targets.length === 0) return;

  const stats = await statPaths(targets.map((t) => t.w.path));
  if (!stats) return;

  for (let i = 0; i < targets.length; i++) {
    const { tab, w, gen } = targets[i];
    if (w.gen !== gen || watches.get(tab.id) !== w || saving.has(tab.id)) continue;
    await reconcile(tab, w, gen, stats[i] ?? null);
  }
  renderBanner();
}

async function checkAll(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    await check(getTabs());
  } catch (err) {
    // Never let one bad pass stop the watcher, or fail without a trace.
    log.error('disk-watch: check failed:', err instanceof Error ? (err.stack ?? err.message) : String(err));
  } finally {
    checking = false;
  }
}

/**
 * Run a write for a tab without the watcher mistaking it for an outside
 * change. Do everything that changes the tab's path inside `write`; the tab's
 * file is taken as the new baseline when it finishes.
 */
export async function trackSave<T>(tab: Tab, write: () => Promise<T>): Promise<T> {
  saving.add(tab.id);
  try {
    return await write();
  } finally {
    if (tab.filePath) {
      const w = watchFor(tab);
      w.gen++;
      const stats = await statPaths([tab.filePath]);
      w.stat = stats ? stats[0] : undefined;
      w.missing = 0;
      w.conflict = null;
    }
    saving.delete(tab.id);
    renderBanner();
  }
}

/**
 * Call before overwriting a tab's file. Looks at the disk once more and, if
 * the file changed underneath unsaved edits, asks whether to overwrite it.
 */
export async function confirmOverwrite(tab: Tab): Promise<boolean> {
  if (!tab.filePath) return true;
  await check([tab]);
  if (watches.get(tab.id)?.conflict !== 'changed') return true;
  return confirm(
    `"${tab.title}" has changed on disk since you started editing it.\n\nOverwrite it with your version?`,
  );
}

async function reloadFromDisk(tab: Tab): Promise<void> {
  const w = watches.get(tab.id);
  if (!w || !reader) return;
  try {
    const text = await reader(tab);
    if (watches.get(tab.id) !== w) return;
    w.conflict = null;
    applyDiskText(tab, text);
  } catch (err) {
    log.error('disk-watch: reload failed for', w.path, err instanceof Error ? err.message : String(err));
    alert(`Could not reload "${tab.title}" from disk.`);
  }
  renderBanner();
  getEditor()?.focus();
}

function renderBanner(): void {
  const banner = document.getElementById('disk-banner');
  if (!banner) return;
  const tab = getActiveTab();
  const w = tab ? watches.get(tab.id) : undefined;
  const conflict = w && w.path === tab!.filePath ? w.conflict : null;

  const state = conflict ? `${tab!.id}:${conflict}` : '';
  if (banner.dataset.state === state) return;
  banner.dataset.state = state;
  banner.replaceChildren();
  banner.classList.toggle('hidden', !conflict);
  if (!tab || !w || !conflict) return;

  const text = document.createElement('span');
  text.className = 'disk-banner-text';
  const button = (label: string, onClick: () => void, primary = false): void => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    if (primary) btn.className = 'primary';
    btn.addEventListener('click', onClick);
    banner.appendChild(btn);
  };
  const dismiss = (): void => {
    w.conflict = null;
    renderBanner();
    getEditor()?.focus();
  };

  banner.appendChild(text);
  if (conflict === 'changed') {
    text.textContent = `"${tab.title}" has changed on disk, and this tab has unsaved edits.`;
    button('Reload from Disk', () => void reloadFromDisk(tab), true);
    button('Keep My Edits', dismiss);
  } else {
    text.textContent = `"${tab.title}" was deleted or moved on disk. Save to write it back.`;
    button('Dismiss', dismiss);
  }
}

/**
 * Start watching the files behind open tabs. `read` returns a tab's current
 * content on disk in the form the editor shows it.
 */
export function initDiskWatch(read: Reader): void {
  reader = read;

  onTabsChange(() => {
    const open = new Set(getTabs().map((t) => t.id));
    for (const id of watches.keys()) {
      if (!open.has(id)) watches.delete(id);
    }
    renderBanner();
  });

  setInterval(() => void checkAll(), POLL_INTERVAL_MS);
  window.addEventListener('focus', () => void checkAll());
  void checkAll();
}
