import { log } from '../utils/logger';

const STORAGE_KEY = 'neo-edit-recently-closed';
const MAX_ENTRIES = 20;

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function save(list: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch (err) {
    log.error('recently-closed: save failed', err instanceof Error ? err.message : String(err));
  }
}

/** Record a file that was just closed so it can be reopened. */
export function pushRecentlyClosed(filePath: string): void {
  if (!filePath) return;
  const list = load();
  // Remove any existing occurrence so the most recent lands at the front
  const filtered = list.filter((p) => p !== filePath);
  filtered.unshift(filePath);
  save(filtered);
}

/** Pop the most-recently-closed file path, or null if none. */
export function popRecentlyClosed(): string | null {
  const list = load();
  if (list.length === 0) return null;
  const [head, ...rest] = list;
  save(rest);
  return head;
}

export function getRecentlyClosed(): string[] {
  return load();
}

export function clearRecentlyClosed(): void {
  save([]);
}
