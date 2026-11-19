// Loads installed plugins (VS Code extensions) and registers what they
// contribute: themes, languages, TextMate grammars and snippets. NeoPad only
// reads these data files; extension code is never run.
//
// Contributions are rebuilt from scratch on every load, so enabling,
// disabling, installing and the panel's Reload button all go through loadAll().

import * as monaco from 'monaco-editor';
import { backend, type InstalledPlugin } from './backend';
import { BUILTIN_PLUGINS } from './builtin';
import { convertTheme, parseJsoncObject, resolvePath } from './vscode-theme';
import { isPluginThemeId, registerPluginTheme, savePluginThemeSnapshot } from './plugin-themes';
import { registerGrammars, type GrammarRegistration, type GrammarSource } from './textmate';
import { toMonacoLanguageConfiguration } from './language-config';
import { parseSnippets, registerSnippets } from './snippets';
import {
  SUPPORTED_CONTRIBUTIONS,
  type ExtensionManifest,
  type LanguageContribution,
  type ThemeContribution,
  type UiTheme,
} from './types';
import { detectLanguage, setPluginLanguages, type PluginLanguage } from '../editor/languages';
import { DEFAULT_THEME, settingsStore } from '../settings/settings-store';
import { getTabs, setTabLanguage } from '../tabs/tab-store';
import { log } from '../utils/logger';

export interface PluginTheme {
  /** `publisher.name/label` — the value stored in settings.theme. */
  id: string;
  label: string;
  uiTheme: UiTheme;
  pluginName: string;
}

export interface LoadedPlugin {
  /** VS Code extension id, `publisher.name`, lower-cased. */
  id: string;
  dirName: string;
  path: string;
  name: string;
  publisher: string;
  version: string;
  description: string;
  builtin: boolean;
  enabled: boolean;
  themes: PluginTheme[];
  languages: string[];
  grammarCount: number;
  snippetCount: number;
  /** Contribution points NeoPad ignores (commands, keybindings, debuggers…). */
  unsupported: string[];
  /** The extension also ships code, which NeoPad doesn't run. */
  hasCode: boolean;
  errors: string[];
  iconUrl?: string;
}

// Plain-language names for VS Code contribution points NeoPad doesn't use.
const IGNORED_NAMES: Record<string, string> = {
  iconThemes: 'file icons',
  productIconThemes: 'product icons',
  commands: 'commands',
  keybindings: 'keyboard shortcuts',
  menus: 'menu items',
  configuration: 'settings',
  configurationDefaults: 'settings',
  debuggers: 'debuggers',
  breakpoints: 'debuggers',
  views: 'panels',
  viewsContainers: 'panels',
  viewsWelcome: 'panels',
  walkthroughs: 'walkthroughs',
  taskDefinitions: 'tasks',
  problemMatchers: 'task output parsing',
  problemPatterns: 'task output parsing',
  jsonValidation: 'JSON schemas',
  semanticTokenTypes: 'semantic highlighting',
  semanticTokenModifiers: 'semantic highlighting',
  semanticTokenScopes: 'semantic highlighting',
  colors: 'custom colours',
  customEditors: 'custom editors',
  notebooks: 'notebooks',
  terminal: 'terminal profiles',
  authentication: 'sign-in providers',
};

/** What a plugin contains that NeoPad ignores, in plain words ("code, file icons"). */
export function describeIgnored(p: LoadedPlugin): string {
  const parts = [...new Set([...(p.hasCode ? ['code'] : []), ...p.unsupported.map((k) => IGNORED_NAMES[k] ?? k)])];
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? '';
}

export interface InstallResult {
  plugin?: LoadedPlugin;
  /** Set when the extension had nothing NeoPad can use and was removed again. */
  rejected?: string;
}

let plugins: LoadedPlugin[] = [];
let manifests = new Map<string, { manifest: ExtensionManifest; dirName: string }>();
let disposables: monaco.IDisposable[] = [];
let grammarRegistration: GrammarRegistration | null = null;
const listeners: (() => void)[] = [];
let queue: Promise<void> = Promise.resolve();

export const pluginsWritable = backend.writable;

export function getPlugins(): LoadedPlugin[] {
  return plugins;
}

/** Themes from enabled plugins, for the Settings picker. */
export function getPluginThemes(): PluginTheme[] {
  return plugins.filter((p) => p.enabled).flatMap((p) => p.themes);
}

export function onPluginsChange(fn: () => void): void {
  listeners.push(fn);
}

// ── Reading manifests ───────────────────────────────────────────────────────

const ICON_TYPES: Record<string, string> = {
  png: 'image/png', svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};

/** Replaces "%key%" placeholders with text from package.nls.json, as VS Code does. */
function localize<T>(value: T, nls: Record<string, unknown>): T {
  if (typeof value === 'string') {
    const m = /^%(.+)%$/.exec(value);
    const text = m ? nls[m[1]] : undefined;
    const message = typeof text === 'string' ? text : (text as { message?: unknown } | undefined)?.message;
    return (typeof message === 'string' ? message : value) as T;
  }
  if (Array.isArray(value)) return value.map((v) => localize(v, nls)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, localize(v, nls)])) as T;
  }
  return value;
}

async function readManifest(installed: InstalledPlugin): Promise<ExtensionManifest> {
  let manifest = parseJsoncObject(installed.manifest, 'package.json') as unknown as ExtensionManifest;
  for (const field of ['publisher', 'name', 'version'] as const) {
    if (typeof manifest[field] !== 'string') throw new Error(`package.json has no "${field}"`);
  }
  if (JSON.stringify(manifest).includes('%')) {
    try {
      const nls = parseJsoncObject(await backend.readText(installed.dirName, 'package.nls.json'), 'package.nls.json');
      manifest = localize(manifest, nls);
    } catch {
      // No translations file; keep the placeholders.
    }
  }
  return manifest;
}

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function themeId(pluginId: string, t: ThemeContribution): string {
  return `${pluginId}/${t.id ?? t.label ?? t.path}`;
}

// ── Loading ─────────────────────────────────────────────────────────────────

/** Reloads every plugin. Calls are queued, never run concurrently. */
export function loadAll(): Promise<void> {
  queue = queue.then(doLoad, doLoad);
  return queue;
}

async function doLoad(): Promise<void> {
  for (const d of disposables) d.dispose();
  disposables = [];
  // Awaited, so restoring built-in highlighters can't race the new grammars.
  await grammarRegistration?.dispose();
  grammarRegistration = null;

  const disabled = new Set(settingsStore.get().disabledPlugins);
  const builtinIds = new Set(BUILTIN_PLUGINS.map((p) => p.id));
  const loaded: LoadedPlugin[] = [];
  const nextManifests = new Map<string, { manifest: ExtensionManifest; dirName: string }>();
  const languages: PluginLanguage[] = [];
  const grammars: GrammarSource[] = [];
  const grammarOwners = new Map<GrammarSource, LoadedPlugin>();

  let installed: InstalledPlugin[] = [];
  try {
    installed = await backend.list();
  } catch (e) {
    log.error('Cannot list plugins:', e);
  }

  for (const entry of installed) {
    let manifest: ExtensionManifest;
    try {
      manifest = await readManifest(entry);
    } catch (e) {
      log.warn(`Skipping plugin ${entry.dirName}:`, e);
      continue;
    }
    const id = `${manifest.publisher}.${manifest.name}`.toLowerCase();
    const contributes = manifest.contributes ?? {};
    const read = (path: string) => backend.readText(entry.dirName, path.replace(/^\.\//, ''));
    const plugin: LoadedPlugin = {
      id,
      dirName: entry.dirName,
      path: entry.path,
      name: manifest.displayName || manifest.name,
      publisher: manifest.publisher,
      version: manifest.version,
      description: manifest.description ?? '',
      builtin: builtinIds.has(id),
      enabled: !disabled.has(id),
      themes: asArray<ThemeContribution>(contributes.themes)
        .filter((t) => typeof t?.path === 'string')
        .map((t) => ({ id: themeId(id, t), label: t.label ?? t.id ?? t.path, uiTheme: t.uiTheme ?? 'vs-dark', pluginName: manifest.displayName || manifest.name })),
      languages: [],
      grammarCount: 0,
      snippetCount: 0,
      unsupported: Object.keys(contributes).filter((k) => !(SUPPORTED_CONTRIBUTIONS as readonly string[]).includes(k)),
      hasCode: Boolean(manifest.main || manifest.browser),
      errors: [],
    };
    nextManifests.set(id, { manifest, dirName: entry.dirName });

    if (manifest.icon) {
      const type = ICON_TYPES[manifest.icon.split('.').pop()?.toLowerCase() ?? ''];
      if (type) {
        try {
          plugin.iconUrl = `data:${type};base64,${await backend.readBase64(entry.dirName, manifest.icon.replace(/^\.\//, ''))}`;
        } catch {
          // No icon; the panel shows a placeholder.
        }
      }
    }

    // Languages: ids and file associations, plus editing behaviour.
    for (const lang of asArray<LanguageContribution>(contributes.languages)) {
      if (typeof lang?.id !== 'string') continue;
      plugin.languages.push(lang.id);
      if (!plugin.enabled) continue;
      languages.push({ id: lang.id, extensions: asArray<string>(lang.extensions), filenames: asArray<string>(lang.filenames) });
      if (!monaco.languages.getLanguages().some((l) => l.id === lang.id)) {
        monaco.languages.register({
          id: lang.id,
          aliases: asArray<string>(lang.aliases),
          extensions: asArray<string>(lang.extensions),
          filenames: asArray<string>(lang.filenames),
        });
      }
      if (typeof lang.configuration === 'string') {
        try {
          const raw = parseJsoncObject(await read(lang.configuration), lang.configuration);
          disposables.push(monaco.languages.setLanguageConfiguration(lang.id, toMonacoLanguageConfiguration(raw)));
        } catch (e) {
          plugin.errors.push(`Language settings for ${lang.id}: ${(e as Error).message ?? e}`);
        }
      }
    }

    // Grammars are registered together below, so they can include each other.
    for (const g of asArray<{ scopeName?: unknown; path?: unknown; language?: unknown; injectTo?: unknown }>(contributes.grammars)) {
      if (typeof g?.scopeName !== 'string' || typeof g.path !== 'string') continue;
      if (typeof g.language === 'string') plugin.grammarCount++;
      if (!plugin.enabled) continue;
      const path = resolvePath('package.json', g.path);
      const source: GrammarSource = {
        scopeName: g.scopeName,
        language: typeof g.language === 'string' ? g.language : undefined,
        injectTo: asArray<string>(g.injectTo),
        path,
        load: () => read(path),
      };
      grammars.push(source);
      grammarOwners.set(source, plugin);
    }

    for (const sn of asArray<{ language?: unknown; path?: unknown }>(contributes.snippets)) {
      if (typeof sn?.path !== 'string' || typeof sn.language !== 'string') continue;
      try {
        const snippets = parseSnippets(parseJsoncObject(await read(sn.path), sn.path));
        plugin.snippetCount += snippets.length;
        if (plugin.enabled && snippets.length) disposables.push(registerSnippets(sn.language, snippets, plugin.name));
      } catch (e) {
        plugin.errors.push(`Snippets ${sn.path}: ${(e as Error).message ?? e}`);
      }
    }

    loaded.push(plugin);
  }

  // Re-detect open tabs whose language was picked automatically.
  const before = new Map(getTabs().filter((t) => t.filePath).map((t) => [t.id, detectLanguage(t.filePath!)]));
  setPluginLanguages(languages);
  for (const tab of getTabs()) {
    const was = before.get(tab.id);
    const now = tab.filePath ? detectLanguage(tab.filePath) : undefined;
    if (was && now && tab.language === was && now !== was) setTabLanguage(tab.id, now);
  }

  grammarRegistration = await registerGrammars(grammars, (source, e) => {
    const message = `Grammar ${source.path}: ${(e as Error).message ?? e}`;
    grammarOwners.get(source)?.errors.push(message);
    log.warn(message);
  });

  plugins = loaded;
  manifests = nextManifests;
  log.info(`Plugins: ${loaded.length} installed, ${loaded.filter((p) => p.enabled).length} on` +
    loaded.filter((p) => p.errors.length).map((p) => `; ${p.id}: ${p.errors.join(' / ')}`).join(''));
  await refreshActiveTheme();
  listeners.forEach((fn) => fn());
}

// ── Themes ──────────────────────────────────────────────────────────────────

/** Converts (or re-converts) a plugin theme and registers it with Monaco. */
async function prepareTheme(id: string): Promise<boolean> {
  const pluginId = id.slice(0, id.indexOf('/'));
  const plugin = plugins.find((p) => p.id === pluginId && p.enabled);
  const entry = manifests.get(pluginId);
  const contribution = asArray<ThemeContribution>(entry?.manifest.contributes?.themes).find((t) => themeId(pluginId, t) === id);
  if (!plugin || !entry || !contribution) return false;
  const prefix = `Theme ${contribution.label ?? id}:`;
  plugin.errors = plugin.errors.filter((m) => !m.startsWith(prefix));
  try {
    const theme = await convertTheme((p) => backend.readText(entry.dirName, p), contribution);
    registerPluginTheme(id, theme);
    for (const w of theme.warnings) log.info(`${prefix} ${w}`);
    return true;
  } catch (e) {
    plugin.errors.push(`${prefix} ${(e as Error).message ?? e}`);
    return false;
  }
}

/** Switches to a theme, built-in or from a plugin. Resolves false if it can't be loaded. */
export async function selectTheme(id: string): Promise<boolean> {
  if (isPluginThemeId(id)) {
    if (!(await prepareTheme(id))) {
      listeners.forEach((fn) => fn());
      return false;
    }
    savePluginThemeSnapshot(id);
  }
  settingsStore.update({ theme: id });
  return true;
}

/** After a reload: re-read the active plugin theme (its files may have been edited) or fall back. */
async function refreshActiveTheme(): Promise<void> {
  const current = settingsStore.get().theme;
  if (!isPluginThemeId(current)) return;
  if (await prepareTheme(current)) {
    savePluginThemeSnapshot(current);
    settingsStore.update({ theme: current }); // re-applies everywhere
  } else {
    log.warn(`Theme ${current} is no longer available; switching to the default`);
    settingsStore.update({ theme: DEFAULT_THEME });
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

export async function initPlugins(): Promise<void> {
  try {
    await backend.seedBuiltins();
  } catch (e) {
    log.error('Cannot install built-in plugins:', e);
  }
  try {
    await loadAll();
  } catch (e) {
    log.error('Cannot load plugins:', e);
  }
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  const disabled = new Set(settingsStore.get().disabledPlugins);
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  settingsStore.update({ disabledPlugins: [...disabled] });
  await loadAll(); // falls back to the default theme if this plugin's was active
}

export async function uninstallPlugin(id: string): Promise<void> {
  const plugin = plugins.find((p) => p.id === id);
  if (!plugin) return;
  await backend.uninstall(plugin.dirName);
  await loadAll();
}

async function afterInstall(installed: InstalledPlugin): Promise<InstallResult> {
  await loadAll();
  const plugin = plugins.find((p) => p.dirName === installed.dirName);
  if (!plugin) throw new Error('The extension installed but could not be read');
  const usable = plugin.themes.length || plugin.languages.length || plugin.grammarCount || plugin.snippetCount;
  if (!usable) {
    const contents = describeIgnored(plugin);
    await backend.uninstall(plugin.dirName);
    await loadAll();
    return {
      rejected: contents
        ? `${plugin.name} only contains ${contents}, which NeoPad doesn't use, so it wasn't installed.`
        : `${plugin.name} doesn't contain anything NeoPad can use, so it wasn't installed.`,
    };
  }
  return { plugin };
}

export async function installFromFile(path: string): Promise<InstallResult> {
  return afterInstall(await backend.installVsix(path));
}

export async function installFromOpenVsx(namespace: string, name: string, version: string): Promise<InstallResult> {
  return afterInstall(await backend.installFromOpenVsx(namespace, name, version));
}

export function revealPluginFolder(id?: string): Promise<void> {
  return backend.reveal(id ? plugins.find((p) => p.id === id)?.dirName : undefined);
}

