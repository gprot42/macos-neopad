import { invoke } from '@tauri-apps/api/core';
import { getActiveTab, onTabsChange } from '../tabs/tab-store';
import {
  getProjectName,
  getProjectRoot,
  getProjectState,
  onProjectChange,
  openProjectFile,
  pickFolder,
  saveProjectState,
  setProjectRoot,
} from './project';
import { log } from '../utils/logger';

/**
 * The project sidebar: the open folder's file tree, and Find in Files.
 *
 * The tree reads one directory at a time as folders are expanded, and
 * re-reads the visible ones on a timer so files created outside NeoPad (or in
 * the terminal panel) show up.
 */

const REFRESH_INTERVAL_MS = 3000;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_WIDTH = 160;
const MAX_WIDTH = 600;

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface SearchMatch {
  line: number;
  startColumn: number;
  endColumn: number;
  preview: string;
  previewStart: number;
  previewEnd: number;
}

interface FileMatches {
  path: string;
  rel: string;
  matches: SearchMatch[];
}

interface SearchResults {
  files: FileMatches[];
  matchCount: number;
  truncated: boolean;
}

type View = 'files' | 'search';

let sidebarEl: HTMLElement;
let handleEl: HTMLElement;
let bodyEl: HTMLElement;
let view: View = 'files';

// ── File tree ───────────────────────────────────────────────────────────────

/** Directory listings read so far, by directory path. */
const listings = new Map<string, DirEntry[]>();
const rows = new Map<string, HTMLElement>();
let treeEl: HTMLElement | null = null;
let refreshing = false;

async function readDir(path: string): Promise<boolean> {
  try {
    const entries = await invoke<DirEntry[]>('project_read_dir', { path });
    const changed = JSON.stringify(entries) !== JSON.stringify(listings.get(path));
    listings.set(path, entries);
    return changed;
  } catch (err) {
    log.warn('sidebar: cannot read', path, err instanceof Error ? err.message : String(err));
    const changed = listings.has(path);
    listings.delete(path);
    return changed;
  }
}

/** The root and every expanded folder that is actually on screen. */
function visibleDirs(root: string): string[] {
  const expanded = new Set(getProjectState().expanded);
  const dirs: string[] = [];
  const visit = (dir: string): void => {
    dirs.push(dir);
    for (const entry of listings.get(dir) ?? []) {
      if (entry.isDir && expanded.has(entry.path)) visit(entry.path);
    }
  };
  visit(root);
  return dirs;
}

async function refreshTree(): Promise<void> {
  const root = getProjectRoot();
  if (!root || refreshing) return;
  refreshing = true;
  try {
    let changed = false;
    // Reading a folder can reveal expanded subfolders not read yet, so go
    // round until nothing new turns up.
    const seen = new Set<string>();
    for (;;) {
      const todo = visibleDirs(root).filter((d) => !seen.has(d));
      if (todo.length === 0) break;
      todo.forEach((d) => seen.add(d));
      const results = await Promise.all(todo.map(readDir));
      if (getProjectRoot() !== root) return;
      changed = changed || results.some(Boolean);
    }
    if (changed) renderTree();
  } finally {
    refreshing = false;
  }
}

async function toggleDir(path: string): Promise<void> {
  const state = getProjectState();
  if (state.expanded.includes(path)) {
    state.expanded = state.expanded.filter((p) => p !== path);
  } else {
    state.expanded.push(path);
    if (!listings.has(path)) await readDir(path);
  }
  saveProjectState();
  renderTree();
}

function renderTree(): void {
  const root = getProjectRoot();
  if (!treeEl || !root) return;
  const expanded = new Set(getProjectState().expanded);
  const scrollTop = treeEl.scrollTop;
  rows.clear();
  treeEl.replaceChildren();

  const addDir = (dir: string, depth: number): void => {
    for (const entry of listings.get(dir) ?? []) {
      const open = entry.isDir && expanded.has(entry.path);
      const row = document.createElement('div');
      row.className = `tree-row ${entry.isDir ? 'tree-dir' : 'tree-file'}`;
      row.style.paddingLeft = `${8 + depth * 12}px`;
      row.title = entry.path;
      const twist = document.createElement('span');
      twist.className = 'tree-twist';
      twist.textContent = entry.isDir ? (open ? '▾' : '▸') : '';
      const name = document.createElement('span');
      name.className = 'tree-name';
      name.textContent = entry.name;
      row.append(twist, name);
      row.addEventListener('click', () => {
        if (entry.isDir) void toggleDir(entry.path);
        else void openProjectFile(entry.path);
      });
      treeEl!.appendChild(row);
      rows.set(entry.path, row);
      if (open) addDir(entry.path, depth + 1);
    }
  };
  addDir(root, 0);

  if (treeEl.childElementCount === 0) {
    const empty = document.createElement('div');
    empty.className = 'project-empty';
    empty.textContent = listings.has(root) ? 'This folder is empty.' : 'Reading folder…';
    treeEl.appendChild(empty);
  }
  treeEl.scrollTop = scrollTop;
  markActiveFile();
}

function markActiveFile(): void {
  const active = getActiveTab()?.filePath ?? null;
  for (const [path, row] of rows) {
    row.classList.toggle('active', path === active);
  }
}

// ── Find in Files ───────────────────────────────────────────────────────────

const search = {
  query: '',
  caseSensitive: false,
  regex: false,
  results: null as SearchResults | null,
  error: '',
  busy: false,
  collapsed: new Set<string>(),
};
let searchSeq = 0;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let resultsEl: HTMLElement | null = null;

async function runSearch(): Promise<void> {
  const root = getProjectRoot();
  const seq = ++searchSeq;
  if (searchTimer) clearTimeout(searchTimer);
  search.error = '';
  search.collapsed.clear();
  if (!root || !search.query) {
    search.results = null;
    search.busy = false;
    renderResults();
    return;
  }
  search.busy = true;
  renderResults();
  try {
    const results = await invoke<SearchResults>('project_search', {
      root,
      query: search.query,
      caseSensitive: search.caseSensitive,
      regex: search.regex,
    });
    if (seq !== searchSeq) return;
    search.results = results;
  } catch (err) {
    if (seq !== searchSeq) return;
    search.results = null;
    search.error = err instanceof Error ? err.message : String(err);
  }
  search.busy = false;
  renderResults();
}

function scheduleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void runSearch(), SEARCH_DEBOUNCE_MS);
}

function renderResults(): void {
  if (!resultsEl) return;
  resultsEl.replaceChildren();

  const status = document.createElement('div');
  status.className = 'search-status';
  const results = search.results;
  if (search.error) {
    status.textContent = search.error;
    status.classList.add('error');
  } else if (search.busy) {
    status.textContent = 'Searching…';
  } else if (!results) {
    status.textContent = '';
  } else if (results.matchCount === 0) {
    status.textContent = 'No results';
  } else {
    const lines = results.matchCount === 1 ? '1 line' : `${results.matchCount} lines`;
    const files = results.files.length === 1 ? '1 file' : `${results.files.length} files`;
    status.textContent = `${lines} in ${files}${results.truncated ? ' (first results only)' : ''}`;
  }
  resultsEl.appendChild(status);
  if (!results) return;

  for (const file of results.files) {
    const collapsed = search.collapsed.has(file.path);
    const slash = file.rel.lastIndexOf('/');
    const head = document.createElement('div');
    head.className = 'search-file';
    head.title = file.path;
    const twist = document.createElement('span');
    twist.className = 'tree-twist';
    twist.textContent = collapsed ? '▸' : '▾';
    const name = document.createElement('span');
    name.className = 'search-file-name';
    name.textContent = file.rel.slice(slash + 1);
    const dir = document.createElement('span');
    dir.className = 'search-file-dir';
    dir.textContent = slash === -1 ? '' : file.rel.slice(0, slash);
    const count = document.createElement('span');
    count.className = 'search-file-count';
    count.textContent = String(file.matches.length);
    head.append(twist, name, dir, count);
    head.addEventListener('click', () => {
      if (collapsed) search.collapsed.delete(file.path);
      else search.collapsed.add(file.path);
      renderResults();
    });
    resultsEl.appendChild(head);
    if (collapsed) continue;

    for (const m of file.matches) {
      // Preview offsets count characters, not UTF-16 units.
      const chars = Array.from(m.preview);
      const row = document.createElement('div');
      row.className = 'search-match';
      row.title = `Line ${m.line}`;
      const hit = document.createElement('mark');
      hit.textContent = chars.slice(m.previewStart, m.previewEnd).join('');
      row.append(
        chars.slice(0, m.previewStart).join(''),
        hit,
        chars.slice(m.previewEnd).join(''),
      );
      row.addEventListener('click', () => {
        void openProjectFile(file.path, m);
      });
      resultsEl.appendChild(row);
    }
  }
}

// ── Sidebar shell ───────────────────────────────────────────────────────────

function iconButton(label: string, title: string, onClick: () => void, active = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.title = title;
  if (active) btn.classList.add('active');
  btn.addEventListener('click', onClick);
  return btn;
}

function renderSidebar(): void {
  const state = getProjectState();
  const root = getProjectRoot();
  sidebarEl.classList.toggle('hidden', !state.sidebarVisible);
  handleEl.classList.toggle('hidden', !state.sidebarVisible);
  sidebarEl.style.width = `${state.sidebarWidth}px`;
  sidebarEl.replaceChildren();
  treeEl = null;
  resultsEl = null;
  rows.clear();
  if (!state.sidebarVisible) return;

  const header = document.createElement('div');
  header.className = 'project-header';
  const title = document.createElement('span');
  title.className = 'project-title';
  title.textContent = root ? getProjectName() : 'No Folder';
  title.title = root ?? '';
  header.appendChild(title);
  if (root) {
    header.append(
      iconButton('Files', 'Show the file tree', () => setView('files'), view === 'files'),
      iconButton('Search', 'Find in Files (⇧⌘F)', () => setView('search'), view === 'search'),
    );
  }
  header.appendChild(iconButton('×', 'Hide sidebar (⇧⌘B)', () => toggleSidebar()));
  sidebarEl.appendChild(header);

  bodyEl = document.createElement('div');
  bodyEl.className = 'project-body';
  sidebarEl.appendChild(bodyEl);

  if (!root) {
    const empty = document.createElement('div');
    empty.className = 'project-empty';
    empty.textContent = 'Open a folder to browse and search its files.';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'project-open-btn';
    btn.textContent = 'Open Folder…';
    btn.addEventListener('click', () => void pickFolder());
    empty.appendChild(btn);
    bodyEl.appendChild(empty);
    return;
  }

  if (view === 'files') {
    treeEl = document.createElement('div');
    treeEl.className = 'project-tree';
    bodyEl.appendChild(treeEl);
    renderTree();
    void refreshTree();
    return;
  }

  const form = document.createElement('div');
  form.className = 'search-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'project-search-input';
  input.placeholder = 'Find in files…';
  input.spellcheck = false;
  input.value = search.query;
  input.addEventListener('input', () => {
    search.query = input.value;
    scheduleSearch();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void runSearch();
  });
  const option = (label: string, title: string, key: 'caseSensitive' | 'regex'): HTMLButtonElement => {
    const btn = iconButton(label, title, () => {
      search[key] = !search[key];
      btn.classList.toggle('active', search[key]);
      void runSearch();
    }, search[key]);
    return btn;
  };
  form.append(
    input,
    option('Aa', 'Match case', 'caseSensitive'),
    option('.*', 'Regular expression', 'regex'),
  );
  resultsEl = document.createElement('div');
  resultsEl.className = 'search-results';
  bodyEl.append(form, resultsEl);
  renderResults();
}

function setView(next: View): void {
  view = next;
  renderSidebar();
  if (view === 'search') focusSearchInput();
}

function focusSearchInput(): void {
  const input = document.getElementById('project-search-input') as HTMLInputElement | null;
  input?.focus();
  input?.select();
}

export function toggleSidebar(): void {
  const state = getProjectState();
  state.sidebarVisible = !state.sidebarVisible;
  saveProjectState();
  renderSidebar();
}

/** Show the sidebar's search view and put the cursor in its field. */
export function showFindInFiles(): void {
  const state = getProjectState();
  state.sidebarVisible = true;
  saveProjectState();
  view = 'search';
  renderSidebar();
  focusSearchInput();
}

export function closeFolder(): void {
  getProjectState().sidebarVisible = false;
  void setProjectRoot(null);
}

function initResize(): void {
  handleEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    handleEl.setPointerCapture(e.pointerId);
    const state = getProjectState();
    const startX = e.clientX;
    const startWidth = state.sidebarWidth;
    const move = (ev: PointerEvent): void => {
      state.sidebarWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + ev.clientX - startX));
      sidebarEl.style.width = `${state.sidebarWidth}px`;
    };
    const up = (): void => {
      handleEl.removeEventListener('pointermove', move);
      handleEl.removeEventListener('pointerup', up);
      handleEl.removeEventListener('pointercancel', up);
      saveProjectState();
    };
    handleEl.addEventListener('pointermove', move);
    handleEl.addEventListener('pointerup', up);
    handleEl.addEventListener('pointercancel', up);
  });
}

export function initSidebar(): void {
  sidebarEl = document.getElementById('project-sidebar')!;
  handleEl = document.getElementById('project-resize-handle')!;
  initResize();

  onProjectChange(() => {
    listings.clear();
    search.results = null;
    search.error = '';
    searchSeq++;
    if (!getProjectRoot()) view = 'files';
    renderSidebar();
  });
  onTabsChange(markActiveFile);

  const refresh = (): void => {
    if (getProjectState().sidebarVisible && view === 'files') void refreshTree();
  };
  setInterval(refresh, REFRESH_INTERVAL_MS);
  window.addEventListener('focus', refresh);

  renderSidebar();
}
