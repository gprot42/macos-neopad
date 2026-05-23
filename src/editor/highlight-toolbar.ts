/**
 * highlight-toolbar.ts
 * A small floating colour-picker toolbar that appears above selected text.
 * Click a swatch to colour the selection; click ✕ to clear highlights.
 */
import * as monaco from 'monaco-editor';
import {
  applyHighlight,
  clearHighlightsInSelection,
  HIGHLIGHT_COLORS,
} from './text-highlight';
import type { Tab } from '../tabs/tab-store';

const SWATCH_COLORS: Record<string, string> = {
  red:    '#e06c75',
  orange: '#d19a66',
  yellow: '#e5c07b',
  green:  '#98c379',
  blue:   '#61afef',
  purple: '#c678dd',
  pink:   '#ff79c6',
};

let toolbar: HTMLElement | null = null;
let currentEditor: monaco.editor.IStandaloneCodeEditor | null = null;
let currentTab: Tab | null = null;

export function initHighlightToolbar(
  editor: monaco.editor.IStandaloneCodeEditor,
  getActiveTab: () => Tab | null,
): void {
  currentEditor = editor;

  // Build toolbar DOM once
  toolbar = document.createElement('div');
  toolbar.id = 'highlight-toolbar';
  toolbar.className = 'highlight-toolbar hidden';
  toolbar.innerHTML = `
    <span class="hl-label">Color:</span>
    ${HIGHLIGHT_COLORS.map((c) => `
      <button class="hl-swatch" data-color="${c}" title="${c}"
        style="background:${SWATCH_COLORS[c]}"></button>
    `).join('')}
    <button class="hl-clear" title="Clear highlight">✕</button>
  `;
  document.body.appendChild(toolbar);

  // Swatch clicks
  toolbar.querySelectorAll<HTMLButtonElement>('.hl-swatch').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // don't lose editor selection
      const color = btn.dataset.color!;
      if (currentEditor && currentTab) {
        applyHighlight(currentEditor, currentTab, color);
        hideToolbar();
      }
    });
  });

  // Clear button
  toolbar.querySelector('.hl-clear')!.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (currentEditor && currentTab) {
      clearHighlightsInSelection(currentEditor, currentTab);
      hideToolbar();
    }
  });

  // Show/hide based on selection
  editor.onDidChangeCursorSelection((e) => {
    currentTab = getActiveTab();
    if (e.selection.isEmpty()) {
      hideToolbar();
    } else {
      showToolbarNearSelection(editor, e.selection);
    }
  });

  // Hide on scroll so it doesn't drift
  editor.onDidScrollChange(() => hideToolbar());
}

/** Update the active tab reference when the user switches tabs. */
export function setHighlightToolbarTab(tab: Tab | null): void {
  currentTab = tab;
  hideToolbar();
}

function showToolbarNearSelection(
  editor: monaco.editor.IStandaloneCodeEditor,
  selection: monaco.Selection,
): void {
  if (!toolbar) return;

  // Get pixel position of the top of the selection
  const topPos = editor.getScrolledVisiblePosition({
    lineNumber: selection.startLineNumber,
    column: selection.startColumn,
  });
  if (!topPos) return;

  const editorDom = editor.getDomNode();
  if (!editorDom) return;
  const editorRect = editorDom.getBoundingClientRect();

  const x = editorRect.left + topPos.left;
  const y = editorRect.top + topPos.top - 40; // 40px above the selection

  toolbar.style.left = `${Math.max(4, x)}px`;
  toolbar.style.top = `${Math.max(4, y)}px`;
  toolbar.classList.remove('hidden');
}

function hideToolbar(): void {
  toolbar?.classList.add('hidden');
}
