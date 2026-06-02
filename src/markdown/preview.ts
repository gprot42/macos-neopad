import { marked } from 'marked';
import { getEditor } from '../editor/editor-manager';
import { getActiveTab } from '../tabs/tab-store';
import { settingsStore } from '../settings/settings-store';

let previewEl: HTMLElement | null = null;
let visible = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let scrollDisposable: { dispose(): void } | null = null;
let contentDisposable: { dispose(): void } | null = null;

// Bumped on every renderPreview() call so async mermaid work from a stale
// render can detect it has been superseded and bail out.
let renderSeq = 0;

// ── Mermaid integration ─────────────────────────────────────────────────────
// marked turns ```mermaid fences into <div class="mermaid-block">…</div> (with
// the graph source HTML-escaped inside).  After the HTML is written into the
// preview iframe we walk those divs and replace each with an inline SVG that
// mermaid renders in the parent document (the SVG is self-contained, so it
// transplants cleanly into the iframe).
type MermaidApi = {
  initialize(cfg: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
};
let mermaidApi: MermaidApi | null = null;
let mermaidLoad: Promise<MermaidApi> | null = null;
let mermaidCounter = 0;

function loadMermaid(): Promise<MermaidApi> {
  if (mermaidApi) return Promise.resolve(mermaidApi);
  if (!mermaidLoad) {
    mermaidLoad = import('mermaid').then((m) => {
      mermaidApi = m.default as unknown as MermaidApi;
      return mermaidApi;
    });
  }
  return mermaidLoad;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Custom code renderer: divert ```mermaid fences, fall back to default for the rest.
marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      if ((lang ?? '').trim().toLowerCase() === 'mermaid') {
        return `<div class="mermaid-block">${escapeHtml(text)}</div>`;
      }
      return false; // use marked's default code renderer
    },
  },
});

async function renderMermaidBlocks(doc: Document, seq: number): Promise<void> {
  const blocks = Array.from(doc.querySelectorAll<HTMLElement>('.mermaid-block:not(.mermaid-done)'));
  if (blocks.length === 0) return;

  const mermaid = await loadMermaid();
  if (seq !== renderSeq) return; // superseded while loading

  const theme = settingsStore.get().theme === 'light' ? 'default' : 'dark';
  mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'loose', fontFamily: 'inherit' });

  for (const block of blocks) {
    const code = block.textContent ?? '';
    const id = `mmd-${++mermaidCounter}`;
    try {
      const { svg } = await mermaid.render(id, code);
      if (seq !== renderSeq) return; // doc was rewritten; abort
      block.innerHTML = svg;
      block.classList.add('mermaid-done');
      attachZoomPan(block);
    } catch (e) {
      if (seq !== renderSeq) return;
      block.innerHTML = `<pre class="mermaid-error">Mermaid error: ${escapeHtml(String(e))}</pre>`;
      block.classList.add('mermaid-done');
    }
  }
}

// Wheel = zoom (toward cursor), drag = pan, double-click = reset.
function attachZoomPan(block: HTMLElement): void {
  const svg = block.querySelector('svg');
  if (!svg) return;

  let scale = 1;
  let tx = 0;
  let ty = 0;
  let dragging = false;
  let startX = 0;
  let startY = 0;

  svg.style.transformOrigin = '0 0';
  svg.style.cursor = 'grab';
  block.style.userSelect = 'none';

  const apply = () => {
    svg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  };

  // Zoom toward the center of the block by a given factor.
  const zoomBy = (factor: number) => {
    const rect = block.getBoundingClientRect();
    const ox = rect.width / 2;
    const oy = rect.height / 2;
    const prev = scale;
    scale = Math.min(6, Math.max(0.3, scale * factor));
    const ratio = scale / prev;
    tx = ox - (ox - tx) * ratio;
    ty = oy - (oy - ty) * ratio;
    apply();
  };

  // +/- zoom buttons (top-right corner overlay). Use the block's own document
  // so the elements are created inside the preview iframe.
  const od = block.ownerDocument;
  const controls = od.createElement('div');
  controls.className = 'mermaid-zoom-controls';
  const btnOut = od.createElement('button');
  btnOut.type = 'button';
  btnOut.className = 'mermaid-zoom-btn';
  btnOut.textContent = '−';
  btnOut.title = 'Zoom out';
  const btnIn = od.createElement('button');
  btnIn.type = 'button';
  btnIn.className = 'mermaid-zoom-btn';
  btnIn.textContent = '+';
  btnIn.title = 'Zoom in';
  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  btnIn.addEventListener('mousedown', stop);
  btnOut.addEventListener('mousedown', stop);
  btnIn.addEventListener('dblclick', stop);
  btnOut.addEventListener('dblclick', stop);
  btnIn.addEventListener('click', (e) => {
    stop(e);
    zoomBy(1.2);
  });
  btnOut.addEventListener('click', (e) => {
    stop(e);
    zoomBy(1 / 1.2);
  });
  controls.appendChild(btnOut);
  controls.appendChild(btnIn);
  block.appendChild(controls);

  block.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      const rect = block.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const prev = scale;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      scale = Math.min(6, Math.max(0.3, scale * factor));
      const ratio = scale / prev;
      // keep the point under the cursor fixed while zooming
      tx = ox - (ox - tx) * ratio;
      ty = oy - (oy - ty) * ratio;
      apply();
    },
    { passive: false },
  );

  block.addEventListener('mousedown', (e: MouseEvent) => {
    dragging = true;
    startX = e.clientX - tx;
    startY = e.clientY - ty;
    svg.style.cursor = 'grabbing';
    e.preventDefault();
  });
  block.addEventListener('mousemove', (e: MouseEvent) => {
    if (!dragging) return;
    tx = e.clientX - startX;
    ty = e.clientY - startY;
    apply();
  });
  const endDrag = () => {
    dragging = false;
    svg.style.cursor = 'grab';
  };
  block.addEventListener('mouseup', endDrag);
  block.addEventListener('mouseleave', endDrag);
  block.addEventListener('dblclick', () => {
    scale = 1;
    tx = 0;
    ty = 0;
    apply();
  });
}

const previewStyles: Record<string, string> = {
  light: `
    body { background: #fff; color: #24292f; }
    a { color: #0969da; }
    code { background: #f0f3f6; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    pre { background: #f6f8fa; padding: 16px; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #d1d9e0; padding: 0 16px; color: #636c76; margin: 16px 0; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d1d9e0; padding: 8px 12px; text-align: left; }
    th { background: #f6f8fa; font-weight: 600; }
    hr { border: none; border-top: 2px solid #d1d9e0; margin: 24px 0; }
    img { max-width: 100%; }
    h1, h2 { border-bottom: 1px solid #d1d9e0; padding-bottom: 8px; }
    .task-list-item { list-style: none; }
    .task-list-item input { margin-right: 6px; }
  `,
  dark: `
    body { background: #1e1e1e; color: #d4d4d4; }
    a { color: #4fc1ff; }
    code { background: #2d2d2d; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    pre { background: #252526; padding: 16px; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid #3c3c3c; padding: 0 16px; color: #858585; margin: 16px 0; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #3c3c3c; padding: 8px 12px; text-align: left; }
    th { background: #252526; font-weight: 600; }
    hr { border: none; border-top: 2px solid #3c3c3c; margin: 24px 0; }
    img { max-width: 100%; }
    h1, h2 { border-bottom: 1px solid #3c3c3c; padding-bottom: 8px; }
    .task-list-item { list-style: none; }
    .task-list-item input { margin-right: 6px; }
  `,
  'tokyo-night': `
    body { background: #1a1b26; color: #a9b1d6; }
    a { color: #7aa2f7; }
    code { background: #1f2335; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; color: #9ece6a; }
    pre { background: #16161e; padding: 16px; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; color: #a9b1d6; }
    blockquote { border-left: 4px solid #292e42; padding: 0 16px; color: #565f89; margin: 16px 0; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #292e42; padding: 8px 12px; text-align: left; }
    th { background: #16161e; font-weight: 600; }
    hr { border: none; border-top: 2px solid #292e42; margin: 24px 0; }
    img { max-width: 100%; }
    h1, h2 { border-bottom: 1px solid #292e42; padding-bottom: 8px; }
    h1 { color: #c0caf5; }
    h2 { color: #bb9af7; }
    h3 { color: #7aa2f7; }
    h4 { color: #7dcfff; }
    h5 { color: #73daca; }
    h6 { color: #9ece6a; }
    strong { color: #c0caf5; }
    .task-list-item { list-style: none; }
    .task-list-item input { margin-right: 6px; }
  `,
};

function getPreviewHTML(markdown: string): string {
  const theme = settingsStore.get().theme;
  const css = previewStyles[theme] ?? previewStyles['tokyo-night'];
  const html = marked.parse(markdown, { async: false }) as string;
  return `<!DOCTYPE html>
<html><head><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 15px;
    line-height: 1.7;
    padding: 24px;
    word-wrap: break-word;
  }
  h1 { font-size: 2em; margin: 24px 0 16px; }
  h2 { font-size: 1.5em; margin: 24px 0 16px; }
  h3 { font-size: 1.25em; margin: 20px 0 12px; }
  h4, h5, h6 { margin: 16px 0 8px; }
  p { margin: 0 0 16px; }
  ul, ol { padding-left: 2em; margin: 0 0 16px; }
  li { margin: 4px 0; }
  .mermaid-block { margin: 16px 0; text-align: center; overflow: hidden; position: relative; border: 1px solid rgba(127,127,127,0.18); border-radius: 6px; padding: 8px; }
  .mermaid-block svg { max-width: 100%; height: auto; will-change: transform; }
  .mermaid-block.mermaid-done::after { content: 'scroll to zoom · drag to pan · double-click to reset'; position: absolute; bottom: 4px; right: 8px; font-size: 10px; opacity: 0.35; pointer-events: none; }
  .mermaid-zoom-controls { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; z-index: 2; }
  .mermaid-zoom-btn { width: 24px; height: 24px; line-height: 1; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 600; border: 1px solid rgba(127,127,127,0.35); border-radius: 4px; background: rgba(127,127,127,0.12); color: inherit; cursor: pointer; opacity: 0.4; transition: opacity 0.15s, background 0.15s; padding: 0; }
  .mermaid-block:hover .mermaid-zoom-btn { opacity: 0.85; }
  .mermaid-zoom-btn:hover { opacity: 1; background: rgba(127,127,127,0.28); }
  .mermaid-error { color: #f7768e; text-align: left; white-space: pre-wrap; }
  ${css}
</style></head><body>${html}</body></html>`;
}

function renderPreview(): void {
  if (!visible || !previewEl) return;
  const tab = getActiveTab();
  if (!tab || tab.language !== 'markdown') return;

  const iframe = previewEl.querySelector('iframe');
  if (!iframe) return;

  const content = tab.model.getValue();
  const doc = iframe.contentDocument;
  if (doc) {
    const seq = ++renderSeq;
    const scrollY = doc.documentElement?.scrollTop ?? 0;
    doc.open();
    doc.write(getPreviewHTML(content));
    doc.close();
    doc.documentElement.scrollTop = scrollY;
    void renderMermaidBlocks(doc, seq);
  }
}

function scheduleRender(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(renderPreview, 150);
}

function syncScroll(): void {
  const editor = getEditor();
  if (!editor || !previewEl || !visible) return;

  const iframe = previewEl.querySelector('iframe');
  if (!iframe?.contentDocument) return;

  const editorScrollTop = editor.getScrollTop();
  const editorScrollHeight = editor.getScrollHeight() - editor.getLayoutInfo().height;
  if (editorScrollHeight <= 0) return;

  const ratio = editorScrollTop / editorScrollHeight;
  const previewDoc = iframe.contentDocument.documentElement;
  const previewScrollHeight = previewDoc.scrollHeight - previewDoc.clientHeight;
  previewDoc.scrollTop = ratio * previewScrollHeight;
}

export function isPreviewVisible(): boolean {
  return visible;
}

export function togglePreview(): void {
  visible = !visible;
  const el = document.getElementById('markdown-preview');
  if (el) {
    el.classList.toggle('hidden', !visible);
  }

  const editor = getEditor();

  if (visible) {
    renderPreview();
    if (editor) {
      scrollDisposable = editor.onDidScrollChange(() => syncScroll());
      contentDisposable = editor.onDidChangeModelContent(() => scheduleRender());
    }
  } else {
    scrollDisposable?.dispose();
    scrollDisposable = null;
    contentDisposable?.dispose();
    contentDisposable = null;
  }

  // Trigger layout recalc
  editor?.layout();
}

export function showPreviewIfMarkdown(): void {
  const tab = getActiveTab();
  const isMarkdown = tab?.language === 'markdown';

  if (isMarkdown && visible) {
    renderPreview();
    const editor = getEditor();
    if (editor) {
      scrollDisposable?.dispose();
      contentDisposable?.dispose();
      scrollDisposable = editor.onDidScrollChange(() => syncScroll());
      contentDisposable = editor.onDidChangeModelContent(() => scheduleRender());
    }
  }

  const el = document.getElementById('markdown-preview');
  if (el) {
    el.classList.toggle('hidden', !isMarkdown || !visible);
  }

  getEditor()?.layout();
}

export function initPreview(): void {
  previewEl = document.getElementById('markdown-preview');
  if (!previewEl) return;

  const iframe = document.createElement('iframe');
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  previewEl.appendChild(iframe);

  // Re-render when theme changes
  settingsStore.onChange(() => {
    if (visible) renderPreview();
  });
}

export function getPreviewHTMLForExport(): string {
  const tab = getActiveTab();
  if (!tab) return '';
  return getPreviewHTML(tab.model.getValue());
}
