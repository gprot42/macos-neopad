/**
 * text-highlight.ts
 * Inline text colour highlighting using Monaco decorations.
 * Persisted per-tab in the Tab.highlights[] array so they survive tab switches.
 */
import * as monaco from 'monaco-editor';
import type { Tab } from '../tabs/tab-store';

export interface HighlightEntry {
  range: monaco.IRange;
  color: string; // CSS colour name / hex
}

// CSS classes for each built-in colour
const HIGHLIGHT_CLASSES: Record<string, string> = {
  red:    'hl-red',
  orange: 'hl-orange',
  yellow: 'hl-yellow',
  green:  'hl-green',
  blue:   'hl-blue',
  purple: 'hl-purple',
  pink:   'hl-pink',
};

export const HIGHLIGHT_COLORS = Object.keys(HIGHLIGHT_CLASSES);

// Per-tab decoration id lists
const tabDecorationIds = new Map<string, string[]>();

// ---------- public API ----------

/** Apply a highlight colour to the current selection in the editor. */
export function applyHighlight(
  editor: monaco.editor.IStandaloneCodeEditor,
  tab: Tab,
  color: string,
): void {
  const selection = editor.getSelection();
  if (!selection || selection.isEmpty()) return;

  const range = selection as monaco.IRange;
  tab.highlights = tab.highlights ?? [];
  tab.highlights.push({ range, color });
  redecorate(editor, tab);
  editor.focus();
}

/** Remove all highlights that overlap the current selection. */
export function clearHighlightsInSelection(
  editor: monaco.editor.IStandaloneCodeEditor,
  tab: Tab,
): void {
  const selection = editor.getSelection();
  if (!selection) return;
  tab.highlights = (tab.highlights ?? []).filter(
    (h) => !monaco.Range.areIntersecting(h.range as monaco.Range, selection),
  );
  redecorate(editor, tab);
  editor.focus();
}

/** Restore all decorations when switching to this tab. */
export function restoreHighlights(
  editor: monaco.editor.IStandaloneCodeEditor,
  tab: Tab,
): void {
  redecorate(editor, tab);
}

/** Clear all decorations from the editor (used when switching away). */
export function clearDecorations(
  editor: monaco.editor.IStandaloneCodeEditor,
  tabId: string,
): void {
  const existing = tabDecorationIds.get(tabId) ?? [];
  const next = editor.deltaDecorations(existing, []);
  tabDecorationIds.set(tabId, next);
}

// ---------- internal ----------

function redecorate(editor: monaco.editor.IStandaloneCodeEditor, tab: Tab): void {
  const existing = tabDecorationIds.get(tab.id) ?? [];
  const newDecorations: monaco.editor.IModelDeltaDecoration[] = (tab.highlights ?? []).map((h) => ({
    range: h.range as monaco.Range,
    options: {
      inlineClassName: HIGHLIGHT_CLASSES[h.color] ?? 'hl-yellow',
    },
  }));
  const next = editor.deltaDecorations(existing, newDecorations);
  tabDecorationIds.set(tab.id, next);
}
