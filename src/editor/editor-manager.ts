import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { registerThemes, themeMap } from './themes';
import { settingsStore } from '../settings/settings-store';
import type { Tab } from '../tabs/tab-store';
import { restoreHighlights, clearDecorations } from './text-highlight';

// Injected at init time to avoid a circular dep between editor-manager <-> tab-store
let getActiveTabFn: (() => Tab | null) | null = null;
let getTabByModelFn: ((model: monaco.editor.ITextModel) => Tab | null) | null = null;

export function initTabLookup(
  getActive: () => Tab | null,
  getByModel: (model: monaco.editor.ITextModel) => Tab | null,
): void {
  getActiveTabFn = getActive;
  getTabByModelFn = getByModel;
}

// Configure Monaco workers
self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === 'json') return new jsonWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  },
};

let editor: monaco.editor.IStandaloneCodeEditor | null = null;

export function initEditor(container: HTMLElement): monaco.editor.IStandaloneCodeEditor {
  registerThemes();

  const settings = settingsStore.get();
  const monacoTheme = themeMap[settings.theme] ?? 'neo-tokyo-night';

  editor = monaco.editor.create(container, {
    value: '',
    language: 'plaintext',
    theme: monacoTheme,
    fontSize: settings.fontSize,
    fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
    lineNumbers: 'on',
    minimap: { enabled: false },
    wordWrap: settings.wordWrap as 'off' | 'on' | 'wordWrapColumn' | 'bounded',
    wordWrapColumn: settings.wordWrapColumn,
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    insertSpaces: true,
    renderWhitespace: 'selection',
    smoothScrolling: true,
    cursorSmoothCaretAnimation: 'on',
    padding: { top: 8 },
    bracketPairColorization: { enabled: true },
    // Disable the "occurrence highlight" boxes that appear when a word is selected
    occurrencesHighlight: 'off',
    selectionHighlight: false,
    // Disable Monaco's Unicode highlight feature — it draws yellow boxes around
    // non-breaking spaces, zero-width chars, ambiguous chars, non-ASCII letters,
    // etc.  In markdown text these appear constantly (after bold markers etc).
    unicodeHighlight: {
      ambiguousCharacters: false,
      invisibleCharacters: false,
      nonBasicASCII: false,
      includeComments: false,
      includeStrings: false,
    },
    renderControlCharacters: false,
  });

  // ── Kill Monaco word/occurrence highlight boxes ────────────────────────────
  // Monaco 0.55 injects CSS like `.vs-dark.monaco-editor .wordHighlight { … }`
  // (two-class selector = specificity 30) AFTER page load, so a static .css
  // file can never win.  In addition, Monaco 0.55 uses CSS custom properties
  // (--vscode-editor-wordHighlight*) as the source of colour for these rules.
  //
  // Three-layer defence:
  //   1. `occurrencesHighlight: 'off'` / `selectionHighlight: false` in create()
  //   2. Runtime <style> injected after editor.create() that:
  //      a) zeroes the CSS variables Monaco reads for highlight colours
  //      b) targets the decoration classes with high-specificity selectors AND
  //         !important to beat Monaco's injected styles regardless of order
  //   3. WordHighlighter contribution disabled via its internal API
  if (!document.getElementById('neo-kill-highlights')) {
    const s = document.createElement('style');
    s.id = 'neo-kill-highlights';
    s.textContent = `
      /* 2a: Zero out the CSS custom-property values Monaco 0.55 uses */
      .monaco-editor {
        --vscode-editor-wordHighlightBackground: transparent !important;
        --vscode-editor-wordHighlightBorder: transparent !important;
        --vscode-editor-wordHighlightStrongBackground: transparent !important;
        --vscode-editor-wordHighlightStrongBorder: transparent !important;
        --vscode-editor-wordHighlightTextBackground: transparent !important;
        --vscode-editor-wordHighlightTextBorder: transparent !important;
        --vscode-editor-selectionHighlightBackground: transparent !important;
        --vscode-editor-selectionHighlightBorder: transparent !important;
      }
      /* 2b: Also target the decoration CSS classes directly.
             Use three selectors to match Monaco's own two-class specificity. */
      .vs .monaco-editor .wordHighlight,
      .vs-dark .monaco-editor .wordHighlight,
      .hc-black .monaco-editor .wordHighlight,
      .vs .monaco-editor .wordHighlightStrong,
      .vs-dark .monaco-editor .wordHighlightStrong,
      .hc-black .monaco-editor .wordHighlightStrong,
      .vs .monaco-editor .wordHighlightText,
      .vs-dark .monaco-editor .wordHighlightText,
      .hc-black .monaco-editor .wordHighlightText,
      .vs .monaco-editor .wordHighlightBorder,
      .vs-dark .monaco-editor .wordHighlightBorder,
      .hc-black .monaco-editor .wordHighlightBorder,
      .vs .monaco-editor .wordHighlightStrongBorder,
      .vs-dark .monaco-editor .wordHighlightStrongBorder,
      .hc-black .monaco-editor .wordHighlightStrongBorder,
      .vs .monaco-editor .wordHighlightTextBorder,
      .vs-dark .monaco-editor .wordHighlightTextBorder,
      .hc-black .monaco-editor .wordHighlightTextBorder,
      .vs .monaco-editor .selectionHighlight,
      .vs-dark .monaco-editor .selectionHighlight,
      .hc-black .monaco-editor .selectionHighlight,
      .vs .monaco-editor .selectionHighlightBorder,
      .vs-dark .monaco-editor .selectionHighlightBorder,
      .hc-black .monaco-editor .selectionHighlightBorder {
        background: transparent !important;
        background-color: transparent !important;
        border: none !important;
        outline: none !important;
        box-shadow: none !important;
      }
    `;
    document.head.appendChild(s);
  }

  // 3: Disable the WordHighlighter contribution directly so it never fires
  //    (safe: stop() clears pending timers & decorations; the contribution
  //     checks occurrencesHighlight option on each cursor move so with the
  //     option set to 'off' it will not re-arm itself)
  try {
    const wh = editor.getContribution('editor.contrib.wordHighlighter');
    if (wh) (wh as unknown as { stop(): void }).stop();
  } catch { /* ignore if contribution doesn't exist in this build */ }

  // Cmd+Up -> go to top, Cmd+Down -> go to bottom
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.UpArrow, () => {
    const ed = editor!;
    ed.setPosition({ lineNumber: 1, column: 1 });
    ed.revealLine(1);
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.DownArrow, () => {
    const ed = editor!;
    const model = ed.getModel();
    if (!model) return;
    const lastLine = model.getLineCount();
    const lastCol = model.getLineMaxColumn(lastLine);
    ed.setPosition({ lineNumber: lastLine, column: lastCol });
    ed.revealLine(lastLine);
  });

  return editor;
}

export function getEditor(): monaco.editor.IStandaloneCodeEditor | null {
  return editor;
}

export function updateEditorOptions(options: monaco.editor.IEditorOptions): void {
  editor?.updateOptions({
    ...options,
    occurrencesHighlight: 'off',
    selectionHighlight: false,
    unicodeHighlight: {
      ambiguousCharacters: false,
      invisibleCharacters: false,
      nonBasicASCII: false,
      includeComments: false,
      includeStrings: false,
    },
    renderControlCharacters: false,
  });
}

export function setEditorTheme(theme: string): void {
  const monacoTheme = themeMap[theme] ?? 'neo-tokyo-night';
  monaco.editor.setTheme(monacoTheme);
}

export function setEditorModel(model: monaco.editor.ITextModel | null): void {
  if (!editor) return;

  // Identify outgoing tab by current model (not activeId which may already be updated)
  const currentModel = editor.getModel();
  if (currentModel && getTabByModelFn) {
    const outgoing = getTabByModelFn(currentModel);
    if (outgoing) {
      outgoing.viewState = editor.saveViewState();
      clearDecorations(editor, outgoing.id);
    }
  }

  editor.setModel(model);

  // Restore view state and highlights for the incoming tab
  if (model) {
    const incoming = getTabByModelFn ? getTabByModelFn(model) : null;
    if (incoming?.viewState) {
      editor.restoreViewState(incoming.viewState);
    } else {
      editor.setPosition({ lineNumber: 1, column: 1 });
      editor.revealLine(1);
    }
    if (incoming) restoreHighlights(editor, incoming);
    editor.focus();
  }
}
