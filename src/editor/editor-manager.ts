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
    // Disable the yellow "occurrence highlight" boxes that appear when a word is selected
    occurrencesHighlight: 'off',
    selectionHighlight: false,
  });

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
