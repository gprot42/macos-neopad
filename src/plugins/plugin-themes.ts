// Converted plugin themes, keyed by theme id (`publisher.name/Label`).
//
// The active one is also snapshotted to localStorage: plugins load
// asynchronously, so without it a plugin theme would flash the default theme
// on every launch.

import * as monaco from 'monaco-editor';
import type { ConvertedTheme } from './vscode-theme';

const SNAPSHOT_KEY = 'neopad-plugin-theme-snapshot';
const themes = new Map<string, ConvertedTheme>();

/** Built-in theme ids are plain words; plugin theme ids are `extension/theme`. */
export function isPluginThemeId(id: string): boolean {
  return id.includes('/');
}

/** Monaco only accepts [a-z0-9-] theme names, so derive a stable one. */
export function monacoThemeName(id: string): string {
  let h = 0;
  for (const ch of id) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `plugin-${slug}-${(h >>> 0).toString(36)}`;
}

export function registerPluginTheme(id: string, theme: ConvertedTheme): void {
  monaco.editor.defineTheme(monacoThemeName(id), theme.monaco);
  themes.set(id, theme);
}

export function getPluginTheme(id: string): ConvertedTheme | undefined {
  return themes.get(id);
}

export function savePluginThemeSnapshot(id: string): void {
  const theme = themes.get(id);
  if (theme) localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ id, theme }));
}

/** Re-registers the last applied plugin theme, if it is `id`. Call before creating the editor. */
export function restorePluginThemeSnapshot(id: string): boolean {
  if (!isPluginThemeId(id)) return false;
  try {
    const saved = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? 'null') as { id: string; theme: ConvertedTheme } | null;
    if (saved?.id !== id) return false;
    registerPluginTheme(id, saved.theme);
    return true;
  } catch {
    return false;
  }
}
