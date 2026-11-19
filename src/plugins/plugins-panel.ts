// The Plugins window (⌘⇧X): installed plugins, and search/install from
// Open VSX. Plugin and registry text is untrusted, so everything here is built
// with textContent — never innerHTML.

import { open } from '@tauri-apps/plugin-dialog';
import {
  describeIgnored,
  getPlugins,
  installFromFile,
  installFromOpenVsx,
  loadAll,
  onPluginsChange,
  pluginsWritable,
  revealPluginFolder,
  selectTheme,
  setPluginEnabled,
  uninstallPlugin,
  type InstallResult,
  type LoadedPlugin,
} from './plugin-manager';
import { settingsStore } from '../settings/settings-store';

const OPEN_VSX = 'https://open-vsx.org';
const CATEGORIES = ['Themes', 'Programming Languages', 'Snippets', ''] as const;

interface RegistryExtension {
  namespace: string;
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  downloadCount?: number;
  files?: { icon?: string };
}

let overlay: HTMLElement | null = null;
let view: 'installed' | 'browse' = 'installed';
let notice: { error: boolean; text: string } | null = null;
let highlight: string | null = null;
const busy = new Set<string>();
const browse = {
  query: '',
  category: 'Themes' as (typeof CATEGORIES)[number],
  results: [] as RegistryExtension[],
  status: '' as string,
  seq: 0,
};

// ── DOM helper ──────────────────────────────────────────────────────────────

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; dataset?: Record<string, string> } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, dataset, ...rest } = props;
  if (cls) el.className = cls;
  if (dataset) Object.assign(el.dataset, dataset);
  Object.assign(el, rest);
  for (const c of children) if (c) el.append(c);
  return el;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function formatCount(n = 0): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
}

// ── Open / close ────────────────────────────────────────────────────────────

export function openPlugins(): void {
  if (overlay) return;
  overlay = h('div', { id: 'plugins-overlay' });
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closePlugins();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  render();
  if (view === 'browse' && !browse.results.length) void search();
}

export function closePlugins(): void {
  overlay?.remove();
  overlay = null;
  notice = null;
  highlight = null;
  document.removeEventListener('keydown', onKey, true);
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation();
    closePlugins();
  }
}

onPluginsChange(() => overlay && render());
settingsStore.onChange(() => overlay && view === 'installed' && render());

// ── Actions ─────────────────────────────────────────────────────────────────

async function run(key: string, action: () => Promise<void>): Promise<void> {
  busy.add(key);
  render();
  try {
    await action();
  } catch (e) {
    notice = { error: true, text: String((e as Error)?.message ?? e) };
  } finally {
    busy.delete(key);
    render();
  }
}

function reportInstall(result: InstallResult): void {
  if (result.rejected) {
    notice = { error: true, text: result.rejected };
    return;
  }
  const p = result.plugin!;
  const what = p.themes.length ? ` Pick one of its themes below to try it.` : '';
  notice = { error: false, text: `Installed ${p.name} ${p.version}.${what}` };
  highlight = p.id;
  view = 'installed';
}

async function installFile(): Promise<void> {
  const path = await open({ multiple: false, filters: [{ name: 'VS Code extension', extensions: ['vsix'] }] });
  if (typeof path !== 'string') return;
  await run('file', async () => reportInstall(await installFromFile(path)));
}

function confirmUninstall(p: LoadedPlugin): void {
  const extra = p.builtin ? '\n\nThis sample plugin came with NeoPad and will not be reinstalled.' : '';
  if (!confirm(`Uninstall ${p.name}? Its files will be deleted.${extra}`)) return;
  void run(p.id, async () => {
    await uninstallPlugin(p.id);
    notice = { error: false, text: `Uninstalled ${p.name}.` };
  });
}

async function search(): Promise<void> {
  const seq = ++browse.seq;
  browse.status = 'Searching…';
  render();
  const params = new URLSearchParams({ query: browse.query, size: '30', sortBy: 'downloadCount', sortOrder: 'desc' });
  if (browse.category) params.set('category', browse.category);
  try {
    const res = await fetch(`${OPEN_VSX}/api/-/search?${params}`);
    if (!res.ok) throw new Error(`Open VSX returned ${res.status}`);
    const data = (await res.json()) as { extensions?: RegistryExtension[] };
    if (seq !== browse.seq) return;
    browse.results = Array.isArray(data.extensions) ? data.extensions : [];
    browse.status = browse.results.length ? '' : 'No extensions found.';
  } catch (e) {
    if (seq !== browse.seq) return;
    browse.results = [];
    browse.status = `Couldn't reach Open VSX: ${(e as Error).message ?? e}`;
  }
  render();
}

// ── Rendering ───────────────────────────────────────────────────────────────

function render(): void {
  if (!overlay) return;
  const scroller = overlay.querySelector('.plugins-body');
  const scrollTop = scroller?.scrollTop ?? 0;
  const focusedSearch = document.activeElement?.classList.contains('plugins-search');
  const caret = focusedSearch ? (document.activeElement as HTMLInputElement).selectionStart : null;

  const installed = getPlugins();
  const panel = h('div', { class: 'plugins-panel', role: 'dialog', ariaLabel: 'Plugins' },
    h('header', { class: 'plugins-header' },
      h('h2', {}, 'Plugins'),
      h('div', { class: 'plugins-actions' },
        actionButton('Install from file…', 'Install a .vsix file', () => void installFile(), !pluginsWritable || busy.has('file')),
        actionButton('Open folder', 'Show the plugins folder in Finder', () => void revealPluginFolder(), !pluginsWritable),
        actionButton('Reload', 'Re-read every plugin from disk', () => void run('reload', loadAll), busy.has('reload')),
        h('button', { class: 'plugins-close', title: 'Close', ariaLabel: 'Close', onclick: closePlugins }, '×'),
      ),
    ),
    h('p', { class: 'plugins-intro' },
      'NeoPad uses the themes, syntax highlighting, snippets and language settings from VS Code extensions. ',
      h('strong', {}, 'It never runs extension code.'),
    ),
    h('nav', { class: 'plugins-tabs', role: 'tablist' },
      tabButton('installed', `Installed (${installed.length})`),
      tabButton('browse', 'Browse Open VSX'),
    ),
    notice && h('div', { class: `plugins-notice${notice.error ? ' error' : ''}`, role: notice.error ? 'alert' : 'status' }, notice.text),
    h('div', { class: 'plugins-body' }, ...(view === 'installed' ? renderInstalled(installed) : renderBrowse(installed))),
  );

  overlay.replaceChildren(panel);
  panel.querySelector('.plugins-body')!.scrollTop = scrollTop;
  if (focusedSearch) {
    const input = panel.querySelector<HTMLInputElement>('.plugins-search')!;
    input.focus();
    input.setSelectionRange(caret, caret);
  }
}

function actionButton(label: string, title: string, onclick: () => void, disabled = false): HTMLButtonElement {
  return h('button', { class: 'plugins-btn', title, onclick, disabled }, label);
}

function tabButton(target: typeof view, label: string): HTMLButtonElement {
  return h('button', {
    class: `plugins-tab${view === target ? ' active' : ''}`,
    role: 'tab',
    ariaSelected: String(view === target),
    onclick: () => {
      view = target;
      notice = null;
      render();
      if (target === 'browse' && !browse.results.length) void search();
    },
  }, label);
}

function icon(url: string | undefined, name: string): HTMLElement {
  return url
    ? h('img', { class: 'plugin-icon', src: url, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' })
    : h('div', { class: 'plugin-icon placeholder', ariaHidden: 'true' }, (name.trim()[0] ?? '?').toUpperCase());
}

function renderInstalled(installed: LoadedPlugin[]): Child[] {
  if (!installed.length) {
    return [h('div', { class: 'plugins-empty' },
      'No plugins installed. ',
      h('button', { class: 'plugins-link', onclick: () => { view = 'browse'; render(); void search(); } }, 'Browse Open VSX'),
      ' to find themes and languages.',
    )];
  }
  const activeTheme = settingsStore.get().theme;
  return installed.map((p) => {
    const chips = [
      p.themes.length && plural(p.themes.length, 'theme'),
      p.languages.length && plural(p.languages.length, 'language'),
      p.grammarCount && plural(p.grammarCount, 'grammar'),
      p.snippetCount && plural(p.snippetCount, 'snippet'),
    ].filter((c): c is string => Boolean(c));
    const ignored = describeIgnored(p);
    const isBusy = busy.has(p.id);

    return h('article', { class: `plugin-card${p.enabled ? '' : ' disabled'}${highlight === p.id ? ' highlight' : ''}` },
      icon(p.iconUrl, p.name),
      h('div', { class: 'plugin-main' },
        h('div', { class: 'plugin-title-row' },
          h('span', { class: 'plugin-name' }, p.name),
          h('span', { class: 'plugin-version' }, `v${p.version}`),
          p.builtin && h('span', { class: 'plugin-badge', title: 'Came with NeoPad' }, 'Sample'),
          h('label', { class: 'plugin-switch', title: p.enabled ? 'Turn off' : 'Turn on' },
            h('input', {
              type: 'checkbox',
              checked: p.enabled,
              disabled: isBusy,
              onchange: (e: Event) => void run(p.id, () => setPluginEnabled(p.id, (e.target as HTMLInputElement).checked)),
            }),
            p.enabled ? 'On' : 'Off',
          ),
        ),
        h('div', { class: 'plugin-publisher' }, `by ${p.publisher}`),
        p.description && h('p', { class: 'plugin-desc' }, p.description),
        chips.length > 0 && h('div', { class: 'plugin-chips' }, ...chips.map((c) => h('span', { class: 'plugin-chip' }, c))),
        p.enabled && p.themes.length > 0 && h('div', { class: 'plugin-themes' },
          ...p.themes.map((t) => {
            const active = t.id === activeTheme;
            const light = t.uiTheme === 'vs' || t.uiTheme === 'hc-light';
            return h('button', {
              class: `theme-pick${active ? ' active' : ''}`,
              title: active ? 'Current theme' : `Use ${t.label}`,
              disabled: active || busy.has(t.id),
              onclick: () => void run(t.id, async () => {
                notice = (await selectTheme(t.id)) ? null : { error: true, text: `Couldn't load ${t.label}; see the errors below.` };
              }),
            }, h('span', { class: 'theme-pick-mode', ariaHidden: 'true' }, light ? '☀' : '☾'), t.label, active && h('span', { class: 'theme-pick-state' }, 'In use'));
          }),
        ),
        ignored && h('p', { class: 'plugin-note' }, `Also includes ${ignored}, which NeoPad doesn't use.`),
        p.errors.length > 0 && h('ul', { class: 'plugin-errors' }, ...p.errors.map((e) => h('li', {}, e))),
        h('div', { class: 'plugin-footer' },
          pluginsWritable && h('button', { class: 'plugins-link', onclick: () => void revealPluginFolder(p.id) }, 'Show files'),
          pluginsWritable && h('button', { class: 'plugins-link danger', disabled: isBusy, onclick: () => confirmUninstall(p) }, 'Uninstall'),
        ),
      ),
    );
  });
}

function renderBrowse(installed: LoadedPlugin[]): Child[] {
  const installedById = new Map(installed.map((p) => [p.id, p]));
  let debounce = 0;
  const bar = h('div', { class: 'browse-bar' },
    h('input', {
      class: 'plugins-search',
      type: 'search',
      placeholder: 'Search Open VSX',
      value: browse.query,
      oninput: (e: Event) => {
        browse.query = (e.target as HTMLInputElement).value;
        clearTimeout(debounce);
        debounce = window.setTimeout(() => void search(), 300);
      },
    }),
    h('select', {
      class: 'plugins-category',
      ariaLabel: 'Category',
      onchange: (e: Event) => {
        browse.category = (e.target as HTMLSelectElement).value as typeof browse.category;
        void search();
      },
    }, ...CATEGORIES.map((c) => h('option', { value: c, selected: c === browse.category }, c || 'All categories'))),
  );

  const rows = browse.results.map((x) => {
    const id = `${x.namespace}.${x.name}`.toLowerCase();
    const have = installedById.get(id);
    const key = `ovsx:${id}`;
    const label = busy.has(key) ? 'Installing…' : !have ? 'Install' : have.version === x.version ? 'Installed' : `Update to ${x.version}`;
    return h('article', { class: 'plugin-card' },
      icon(x.files?.icon, x.displayName || x.name),
      h('div', { class: 'plugin-main' },
        h('div', { class: 'plugin-title-row' },
          h('span', { class: 'plugin-name' }, x.displayName || x.name),
          h('span', { class: 'plugin-version' }, `v${x.version}`),
          h('span', { class: 'plugin-downloads', title: 'Downloads' }, `${formatCount(x.downloadCount)} ↓`),
          h('button', {
            class: 'plugins-btn primary',
            disabled: !pluginsWritable || busy.has(key) || have?.version === x.version,
            title: pluginsWritable ? '' : 'Installing plugins needs the NeoPad app',
            onclick: () => void run(key, async () => reportInstall(await installFromOpenVsx(x.namespace, x.name, x.version))),
          }, label),
        ),
        h('div', { class: 'plugin-publisher' }, `by ${x.namespace}`),
        x.description && h('p', { class: 'plugin-desc' }, x.description),
      ),
    );
  });

  return [
    bar,
    browse.status && h('div', { class: 'plugins-empty' }, browse.status),
    ...rows,
    h('p', { class: 'plugins-fineprint' },
      'Results come from open-vsx.org, the Eclipse Foundation\'s open registry of VS Code extensions. ' +
      'If an extension turns out to have nothing NeoPad can use — an icon pack, say, or one that is only code — ' +
      'it is removed again straight after download.'),
  ];
}
