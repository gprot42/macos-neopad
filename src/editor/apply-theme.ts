// Applies a theme — built-in or from a plugin — to the whole window.
// Built-in themes style the chrome through [data-theme="…"] rules in
// themes.css; plugin themes set the same CSS variables inline instead.

import { setEditorTheme } from './editor-manager';
import { themeRuleTokens } from './themes';
import { getPluginTheme } from '../plugins/plugin-themes';
import { setThemeRuleTokens } from '../plugins/textmate';

let inlineVars: string[] = [];

/** Window chrome only; safe to call before the editor exists. */
export function applyChromeTheme(themeId: string): void {
  const root = document.documentElement;
  const plugin = getPluginTheme(themeId);
  root.setAttribute('data-theme', plugin ? 'plugin' : themeId);
  for (const name of inlineVars) root.style.removeProperty(name);
  inlineVars = [];
  if (plugin) {
    for (const [name, value] of Object.entries(plugin.chrome)) root.style.setProperty(name, value);
    inlineVars = Object.keys(plugin.chrome);
  }
}

export function applyTheme(themeId: string): void {
  applyChromeTheme(themeId);
  // Before switching Monaco's theme, which re-tokenizes with these rules.
  setThemeRuleTokens(themeRuleTokens(themeId));
  setEditorTheme(themeId);
}
