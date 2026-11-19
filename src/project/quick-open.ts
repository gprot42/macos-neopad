import { invoke } from '@tauri-apps/api/core';
import { getProjectRoot, onProjectChange, openProjectFile, pickFolder } from './project';
import { log } from '../utils/logger';

/** Go to File: a palette that filters the open folder's files by name. */

const MAX_SHOWN = 50;

interface FileList {
  files: string[];
  truncated: boolean;
}

let files: string[] = [];
let filesRoot: string | null = null;
let overlay: HTMLElement | null = null;

async function loadFiles(root: string): Promise<void> {
  try {
    const list = await invoke<FileList>('project_list_files', { root });
    if (getProjectRoot() !== root) return;
    files = list.files;
    filesRoot = root;
    if (list.truncated) log.warn('quick-open: file list truncated at', list.files.length);
  } catch (err) {
    log.error('quick-open: listing files failed:', err instanceof Error ? err.message : String(err));
  }
}

/**
 * How well `rel` matches `query` (both lower-case), or null if it does not.
 * A hit in the file name beats one in the folders, which beats the letters
 * merely appearing in order.
 */
function score(query: string, rel: string): number | null {
  const penalty = rel.length * 0.1;
  const baseStart = rel.lastIndexOf('/') + 1;
  const inBase = rel.indexOf(query, baseStart);
  if (inBase !== -1) return 1000 - (inBase - baseStart) * 5 - penalty;
  if (rel.includes(query)) return 500 - penalty;

  let total = 100;
  let from = 0;
  let last = -2;
  for (const ch of query) {
    const at = rel.indexOf(ch, from);
    if (at === -1) return null;
    if (at === last + 1) total += 5;
    if (at === 0 || '/._-'.includes(rel[at - 1])) total += 8;
    last = at;
    from = at + 1;
  }
  return total - penalty;
}

function matches(query: string): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return files.slice(0, MAX_SHOWN);
  const scored: { rel: string; s: number }[] = [];
  for (const rel of files) {
    const s = score(q, rel.toLowerCase());
    if (s !== null) scored.push({ rel, s });
  }
  scored.sort((a, b) => b.s - a.s || a.rel.localeCompare(b.rel));
  return scored.slice(0, MAX_SHOWN).map((m) => m.rel);
}

function close(): void {
  overlay?.remove();
  overlay = null;
}

export function openQuickOpen(): void {
  if (overlay) {
    close();
    return;
  }
  const root = getProjectRoot();

  overlay = document.createElement('div');
  overlay.id = 'quick-open-overlay';
  const box = document.createElement('div');
  box.className = 'quick-open-box';
  overlay.appendChild(box);
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  document.body.appendChild(overlay);

  if (!root) {
    const empty = document.createElement('div');
    empty.className = 'quick-open-empty';
    empty.textContent = 'Open a folder to jump to its files by name.';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Open Folder…';
    btn.addEventListener('click', () => {
      close();
      void pickFolder();
    });
    empty.appendChild(btn);
    box.appendChild(empty);
    overlay.tabIndex = -1;
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    btn.focus();
    return;
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Go to file…';
  input.spellcheck = false;
  const list = document.createElement('div');
  list.className = 'quick-open-list';
  box.append(input, list);

  let shown: string[] = [];
  let selected = 0;

  const render = (): void => {
    shown = matches(input.value);
    selected = Math.min(selected, Math.max(0, shown.length - 1));
    list.replaceChildren();
    if (shown.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'quick-open-empty';
      empty.textContent = filesRoot === root ? 'No matching files' : 'Reading folder…';
      list.appendChild(empty);
      return;
    }
    shown.forEach((rel, i) => {
      const slash = rel.lastIndexOf('/');
      const item = document.createElement('div');
      item.className = `quick-open-item${i === selected ? ' selected' : ''}`;
      const name = document.createElement('span');
      name.className = 'quick-open-name';
      name.textContent = rel.slice(slash + 1);
      const dir = document.createElement('span');
      dir.className = 'quick-open-dir';
      dir.textContent = slash === -1 ? '' : rel.slice(0, slash);
      item.append(name, dir);
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(i);
      });
      list.appendChild(item);
    });
    list.children[selected]?.scrollIntoView({ block: 'nearest' });
  };

  const choose = (i: number): void => {
    const rel = shown[i];
    if (!rel) return;
    close();
    void openProjectFile(`${root}/${rel}`);
  };

  input.addEventListener('input', () => {
    selected = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter') {
      choose(selected);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      selected = (selected + step + shown.length) % shown.length;
      render();
    }
  });

  if (filesRoot !== root) files = [];
  render();
  input.focus();
  // The list may be stale (or not loaded yet): refresh it behind the palette.
  const mine = overlay;
  void loadFiles(root).then(() => {
    if (overlay === mine) render();
  });
}

export function initQuickOpen(): void {
  onProjectChange(() => {
    files = [];
    filesRoot = null;
    const root = getProjectRoot();
    if (root) void loadFiles(root);
  });
}
