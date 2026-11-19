import type * as monaco from 'monaco-editor';
import { createSecondaryEditor, getEditor } from './editor-manager';
import { getActiveTab, getTabs, onTabsChange, type Tab } from '../tabs/tab-store';
import { lockManager } from '../crypto/lock-manager';

/**
 * Split view: a second editor pane to the right of the main one.
 *
 * The main pane is still driven by the tab bar. The split pane is pinned to
 * one open tab — the same file as the main pane or a different one — and
 * shares that tab's text model, so edits on either side show up on both. The
 * Markdown toolbar, preview and outline follow the main pane only.
 */

const MIN_PANE_WIDTH = 150;

let paneEl: HTMLElement;
let handleEl: HTMLElement;
let headerEl: HTMLElement;
let sideEditor: monaco.editor.IStandaloneCodeEditor | null = null;
let sideTabId: string | null = null;
let sideFocused = false;
let lastActiveId: string | null = null;
let onChange: () => void = () => {};

export function isSplitOpen(): boolean {
  return sideTabId !== null;
}

/** The tab shown in the split pane, if it is open. */
export function getSideTab(): Tab | null {
  return sideTabId ? getTabs().find((t) => t.id === sideTabId) ?? null : null;
}

function sideHasFocus(): boolean {
  return sideFocused && isSplitOpen();
}

/** Whether the keyboard focus is in the split pane rather than the main one. */
export function isSideFocused(): boolean {
  return sideHasFocus();
}

/** The tab in the pane being typed in: what Save, Find etc. should act on. */
export function getFocusedTab(): Tab | null {
  return sideHasFocus() ? getSideTab() : getActiveTab();
}

export function getFocusedEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return sideHasFocus() ? sideEditor : getEditor();
}

function setSideFocused(focused: boolean): void {
  if (sideFocused === focused) return;
  sideFocused = focused;
  paneEl.classList.toggle('focused', focused);
  onChange();
}

function ensureEditor(): monaco.editor.IStandaloneCodeEditor {
  if (sideEditor) return sideEditor;
  sideEditor = createSecondaryEditor(document.getElementById('split-editor')!);
  sideEditor.onDidFocusEditorText(() => setSideFocused(true));
  sideEditor.onDidChangeCursorPosition(() => {
    if (sideFocused) onChange();
  });
  return sideEditor;
}

/** Show a tab (the active one by default) in the split pane, opening it if needed. */
export function openToSide(tab: Tab | null = getActiveTab()): void {
  if (!tab || lockManager.isLocked(tab.id)) return;
  const editor = ensureEditor();
  const wasOpen = isSplitOpen();
  sideTabId = tab.id;
  paneEl.classList.remove('hidden');
  handleEl.classList.remove('hidden');

  if (editor.getModel() !== tab.model) {
    editor.setModel(tab.model);
    // Start where the main pane is when it shows the same file.
    const main = getEditor();
    const view = main?.getModel() === tab.model ? main.saveViewState() : tab.viewState;
    if (view) editor.restoreViewState(view);
  }
  renderHeader();
  if (!wasOpen) editor.layout();
  editor.focus();
  // Not left to the focus event alone: it does not fire while the window is
  // in the background.
  setSideFocused(true);
  onChange();
}

export function closeSplit(): void {
  if (!isSplitOpen()) return;
  sideTabId = null;
  sideFocused = false;
  sideEditor?.setModel(null);
  paneEl.classList.add('hidden');
  paneEl.classList.remove('focused');
  handleEl.classList.add('hidden');
  // Back to an even split next time.
  paneEl.style.flex = '';
  paneEl.style.width = '';
  getEditor()?.focus();
  onChange();
}

export function toggleSplit(): void {
  if (isSplitOpen()) closeSplit();
  else openToSide();
}

/** Close the pane if its tab was closed or locked; otherwise refresh its title. */
export function syncSplit(): void {
  // Switching tabs is an action on the main pane.
  const activeId = getActiveTab()?.id ?? null;
  if (activeId !== lastActiveId) {
    lastActiveId = activeId;
    setSideFocused(false);
  }
  if (!isSplitOpen()) return;
  const tab = getSideTab();
  if (!tab || lockManager.isLocked(tab.id)) {
    closeSplit();
    return;
  }
  renderHeader();
}

function showTabMenu(anchor: HTMLElement): void {
  document.getElementById('split-tab-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'split-tab-menu';
  menu.className = 'tab-context-menu';
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 2}px`;

  for (const tab of getTabs()) {
    if (lockManager.isLocked(tab.id)) continue;
    const item = document.createElement('div');
    item.className = `tab-context-item${tab.id === sideTabId ? ' current' : ''}`;
    item.textContent = tab.title;
    item.title = tab.filePath ?? '';
    item.addEventListener('click', () => {
      menu.remove();
      openToSide(tab);
    });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);

  const dismiss = (ev: MouseEvent): void => {
    if (!menu.contains(ev.target as Node)) {
      menu.remove();
      window.removeEventListener('mousedown', dismiss, true);
    }
  };
  setTimeout(() => window.addEventListener('mousedown', dismiss, { capture: true }), 0);
}

function renderHeader(): void {
  const tab = getSideTab();
  headerEl.replaceChildren();
  if (!tab) return;

  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'split-title';
  title.title = 'Choose which tab this pane shows';
  title.textContent = `${tab.isDirty ? '● ' : ''}${tab.title} ▾`;
  title.addEventListener('click', () => showTabMenu(title));

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'split-close';
  closeBtn.title = 'Close split';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeSplit);

  headerEl.append(title, closeBtn);
}

function initResize(): void {
  handleEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handleEl.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = paneEl.getBoundingClientRect().width;
    const mainWidth = document.getElementById('editor-container')!.getBoundingClientRect().width;
    const max = startWidth + mainWidth - MIN_PANE_WIDTH;
    const move = (ev: PointerEvent): void => {
      const width = Math.max(MIN_PANE_WIDTH, Math.min(max, startWidth - (ev.clientX - startX)));
      paneEl.style.flex = 'none';
      paneEl.style.width = `${width}px`;
    };
    const up = (): void => {
      handleEl.removeEventListener('pointermove', move);
      handleEl.removeEventListener('pointerup', up);
      handleEl.removeEventListener('pointercancel', up);
    };
    handleEl.addEventListener('pointermove', move);
    handleEl.addEventListener('pointerup', up);
    handleEl.addEventListener('pointercancel', up);
  });
}

/** `changed` runs when the focused pane or the split pane's cursor changes. */
export function initSplitView(changed: () => void): void {
  onChange = changed;
  paneEl = document.getElementById('split-pane')!;
  handleEl = document.getElementById('split-resize-handle')!;
  headerEl = document.getElementById('split-header')!;
  initResize();

  lastActiveId = getActiveTab()?.id ?? null;
  getEditor()?.onDidFocusEditorText(() => setSideFocused(false));
  // Clicking in a pane selects it even where no focus event follows (the
  // pane header, or a window that is not frontmost).
  paneEl.addEventListener('mousedown', () => setSideFocused(true), true);
  document
    .getElementById('editor-container')!
    .addEventListener('mousedown', () => setSideFocused(false), true);
  onTabsChange(syncSplit);
}
