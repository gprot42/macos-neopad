// Converts a VS Code colour theme into everything NeoPad needs: a Monaco
// theme, CSS variables for the window chrome, an xterm palette and the
// Markdown preview palette.
//
// Handles what real theme files contain: comments and trailing commas,
// `include` chains, `tokenColors` stored in a separate (possibly Sublime/
// TextMate .tmTheme plist) file, and 3/4/6/8-digit hex colours.

import type * as monaco from 'monaco-editor';
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { NO_HIGHLIGHT } from '../editor/themes';
import { flatten, luminance, mix, parseColor, toHex, withAlpha, type Rgba } from './color';
import type { ThemeContribution, UiTheme } from './types';

export interface PreviewPalette {
  bg: string;
  fg: string;
  muted: string;
  link: string;
  heading: string;
  codeBg: string;
  border: string;
  quoteBorder: string;
}

export interface ConvertedTheme {
  label: string;
  base: UiTheme;
  dark: boolean;
  monaco: monaco.editor.IStandaloneThemeData;
  /** The scopes this theme colours; lets the TextMate tokenizer report a coloured scope. */
  ruleTokens: string[];
  /** CSS custom property → colour, for the window chrome. */
  chrome: Record<string, string>;
  /** xterm.js ITheme. */
  terminal: Record<string, string>;
  preview: PreviewPalette;
  warnings: string[];
}

/** Reads a file relative to the plugin's folder. */
export type PluginFileReader = (path: string) => Promise<string>;

interface RawTokenRule {
  scope?: unknown;
  settings?: { foreground?: unknown; fontStyle?: unknown; background?: unknown; [k: string]: unknown };
}

interface RawTheme {
  type?: string;
  colors: Record<string, unknown>;
  tokenColors: RawTokenRule[];
}

const MAX_INCLUDE_DEPTH = 8;

// Monaco's own defaults, used when a theme leaves the editor colours unset.
const BASE_DEFAULTS: Record<UiTheme, { bg: string; fg: string }> = {
  vs: { bg: '#fffffe', fg: '#000000' },
  'vs-dark': { bg: '#1e1e1e', fg: '#d4d4d4' },
  'hc-black': { bg: '#000000', fg: '#ffffff' },
  'hc-light': { bg: '#ffffff', fg: '#292929' },
};

// NeoPad's built-in languages use Monaco's Monarch tokenizers, whose token
// names ("number", "delimiter", "tag"…) aren't TextMate scopes. Give each the
// colour the theme assigns to the equivalent TextMate scope.
const MONARCH_ALIASES: [string, string[]][] = [
  ['number', ['constant.numeric']],
  ['regexp', ['string.regexp']],
  ['type', ['entity.name.type', 'support.type', 'storage.type']],
  ['delimiter', ['punctuation']],
  ['operator', ['keyword.operator']],
  ['tag', ['entity.name.tag']],
  ['metatag', ['entity.name.tag']],
  ['attribute.name', ['entity.other.attribute-name']],
  ['attribute.value', ['string']],
  ['key', ['support.type.property-name']],
  ['string.key.json', ['support.type.property-name.json', 'support.type.property-name']],
  ['string.escape', ['constant.character.escape']],
  ['variable.predefined', ['variable.language', 'support.variable']],
  ['annotation', ['meta.decorator', 'storage.type.annotation']],
  ['keyword.md', ['markup.heading']],
  ['strong.md', ['markup.bold']],
  ['emphasis.md', ['markup.italic']],
  ['variable.md', ['markup.inline.raw']],
  ['variable.source.md', ['markup.fenced_code', 'markup.raw']],
  ['string.link.md', ['markup.underline.link', 'string.other.link']],
  ['comment.md', ['markup.quote']],
];

// ── File loading ────────────────────────────────────────────────────────────

/** Resolves `rel` against the folder containing `from` (both plugin-relative). */
export function resolvePath(from: string, rel: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.filter((p) => p && p !== '.').join('/');
}

export function parseJsoncObject(text: string, path: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const value = parseJsonc(text, errors, { allowTrailingComma: true });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const why = errors.length ? printParseErrorCode(errors[0].error) : 'not a JSON object';
    throw new Error(`${path}: ${why}`);
  }
  return value as Record<string, unknown>;
}

/** Minimal Apple plist reader, for Sublime/TextMate .tmTheme files. */
export function parsePlist(text: string): unknown {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Invalid plist XML');
  const read = (el: Element): unknown => {
    switch (el.tagName) {
      case 'dict': {
        const out: Record<string, unknown> = {};
        const kids = Array.from(el.children);
        for (let i = 0; i + 1 < kids.length; i += 2) {
          if (kids[i].tagName === 'key') out[kids[i].textContent ?? ''] = read(kids[i + 1]);
        }
        return out;
      }
      case 'array': return Array.from(el.children).map(read);
      case 'string': return el.textContent ?? '';
      case 'integer':
      case 'real': return Number(el.textContent);
      case 'true': return true;
      case 'false': return false;
      default: return null;
    }
  };
  const root = doc.documentElement.firstElementChild;
  return root ? read(root) : null;
}

const looksLikePlist = (path: string, text: string) =>
  /\.(tmTheme|plist|xml)$/i.test(path) || text.trimStart().startsWith('<');

async function loadRawTheme(read: PluginFileReader, path: string, depth = 0): Promise<RawTheme> {
  if (depth > MAX_INCLUDE_DEPTH) throw new Error('Theme "include" chain is too deep');
  const text = await read(path);

  if (looksLikePlist(path, text)) {
    const plist = parsePlist(text) as { settings?: unknown } | null;
    return { colors: {}, tokenColors: Array.isArray(plist?.settings) ? plist.settings : [] };
  }

  const json = parseJsoncObject(text, path);
  const theme: RawTheme = typeof json.include === 'string'
    ? await loadRawTheme(read, resolvePath(path, json.include), depth + 1)
    : { colors: {}, tokenColors: [] };

  if (typeof json.type === 'string') theme.type = json.type;
  if (json.colors && typeof json.colors === 'object') Object.assign(theme.colors, json.colors);
  if (typeof json.tokenColors === 'string') {
    const sub = await loadRawTheme(read, resolvePath(path, json.tokenColors), depth + 1);
    theme.tokenColors.push(...sub.tokenColors);
  } else if (Array.isArray(json.tokenColors)) {
    theme.tokenColors.push(...json.tokenColors);
  }
  // Old-style themes put tmTheme-shaped rules under "settings".
  if (Array.isArray(json.settings)) theme.tokenColors.push(...json.settings);
  return theme;
}

// ── Conversion ──────────────────────────────────────────────────────────────

function scopeList(scope: unknown): string[] {
  const raw = Array.isArray(scope) ? scope : [scope];
  return raw
    .filter((s): s is string => typeof s === 'string')
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean);
}

function fontStyleOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value
    .split(/\s+/)
    .filter((w) => ['italic', 'bold', 'underline', 'strikethrough'].includes(w))
    .join(' ');
}

function uiThemeOf(contribution: ThemeContribution, type: string | undefined): UiTheme {
  if (contribution.uiTheme && contribution.uiTheme in BASE_DEFAULTS) return contribution.uiTheme;
  switch (type) {
    case 'light': return 'vs';
    case 'hc':
    case 'hcDark': return 'hc-black';
    case 'hcLight': return 'hc-light';
    default: return 'vs-dark';
  }
}

export async function convertTheme(
  read: PluginFileReader,
  contribution: ThemeContribution,
): Promise<ConvertedTheme> {
  const raw = await loadRawTheme(read, contribution.path.replace(/^\.\//, ''));
  const warnings: string[] = [];
  const base = uiThemeOf(contribution, raw.type);
  const defaults = BASE_DEFAULTS[base];

  // Rules without a scope hold global settings (tmTheme style).
  const globals: Record<string, string> = {
    background: 'editor.background',
    foreground: 'editor.foreground',
    caret: 'editorCursor.foreground',
    selection: 'editor.selectionBackground',
    lineHighlight: 'editor.lineHighlightBackground',
    invisibles: 'editorWhitespace.foreground',
  };
  for (const rule of raw.tokenColors) {
    if (rule.scope === undefined && rule.settings) {
      for (const [from, to] of Object.entries(globals)) {
        if (rule.settings[from] !== undefined && raw.colors[to] === undefined) raw.colors[to] = rule.settings[from];
      }
    }
  }

  // Workbench colours: keep only valid ones, re-serialised.
  const colors: Record<string, string> = {};
  let invalidColors = 0;
  for (const [key, value] of Object.entries(raw.colors)) {
    const c = parseColor(value);
    if (c) colors[key] = toHex(c);
    else if (value !== null) invalidColors++;
  }
  if (invalidColors) warnings.push(`Ignored ${invalidColors} colour value(s) NeoPad can't read`);

  const baseBg = parseColor(defaults.bg)!;
  const bg = flatten(parseColor(colors['editor.background']) ?? baseBg, baseBg);
  const fg = flatten(parseColor(colors['editor.foreground'] ?? colors.foreground) ?? parseColor(defaults.fg)!, bg);
  colors['editor.background'] = toHex(bg);
  colors['editor.foreground'] = toHex(fg);
  const dark = luminance(bg) < 0.4;

  // Token rules. Monaco matches dotted prefixes ("string" covers
  // "string.quoted"), like TextMate, but has no descendant ("a b") or
  // exclusion ("a - b") selectors — those rules are skipped.
  interface Rule { scope: string; fg?: Rgba; fontStyle?: string }
  const scoped: Rule[] = [];
  let skippedSelectors = 0;
  for (const entry of raw.tokenColors) {
    if (!entry || typeof entry !== 'object' || !entry.settings) continue;
    const ruleFg = parseColor(entry.settings.foreground);
    const fontStyle = fontStyleOf(entry.settings.fontStyle);
    if (!ruleFg && fontStyle === undefined) continue;
    for (const scope of scopeList(entry.scope)) {
      if (!/^[\w.+#-]+$/.test(scope)) {
        skippedSelectors++;
        continue;
      }
      scoped.push({ scope, fg: ruleFg ? flatten(ruleFg, bg) : undefined, fontStyle });
    }
  }
  if (skippedSelectors) warnings.push(`Skipped ${skippedSelectors} advanced scope selector(s)`);

  // Most specific rule for a scope; later rules win ties, as in VS Code.
  const styleFor = (scope: string): Rule | undefined => {
    let best: Rule | undefined;
    for (const r of scoped) {
      if ((scope === r.scope || scope.startsWith(r.scope + '.')) && (!best || r.scope.length >= best.scope.length)) best = r;
    }
    return best;
  };

  const toMonacoRule = (token: string, r: Rule): monaco.editor.ITokenThemeRule => ({
    token,
    ...(r.fg ? { foreground: toHex(r.fg) } : {}),
    ...(r.fontStyle !== undefined ? { fontStyle: r.fontStyle } : {}),
  });

  const rules: monaco.editor.ITokenThemeRule[] = [
    { token: '', foreground: toHex(fg), background: toHex(bg) },
  ];
  for (const [token, candidates] of MONARCH_ALIASES) {
    const hit = candidates.map(styleFor).find(Boolean);
    if (hit) rules.push(toMonacoRule(token, hit));
  }
  for (const r of scoped) rules.push(toMonacoRule(r.scope, r));

  // ── Window chrome, terminal, preview ──────────────────────────────────────
  const pick = (...keys: string[]): Rgba | undefined => {
    for (const k of keys) {
      const c = parseColor(colors[k]);
      if (c) return flatten(c, bg);
    }
    return undefined;
  };
  const shade = dark ? parseColor('#000000')! : parseColor('#2c2240')!;
  const sidebar = pick('sideBar.background', 'editorGroupHeader.tabsBackground', 'tab.inactiveBackground') ?? mix(bg, shade, dark ? 0.2 : 0.04);
  const border = pick('tab.border', 'editorGroup.border', 'sideBar.border', 'panel.border', 'contrastBorder') ?? mix(bg, fg, 0.12);
  const accent = pick('focusBorder', 'button.background', 'tab.activeBorderTop', 'tab.activeBorder', 'textLink.foreground', 'editorCursor.foreground')
    ?? parseColor(dark ? '#7aa2f7' : '#0969da')!;
  const muted = mix(fg, bg, 0.4);

  const chrome: Record<string, string> = {
    '--bg': toHex(bg),
    '--fg': toHex(fg),
    '--sidebar': toHex(sidebar),
    '--border': toHex(border),
    '--accent': toHex(accent),
    '--tab-active': toHex(pick('tab.activeBackground') ?? bg),
    '--tab-inactive': toHex(pick('tab.inactiveBackground') ?? sidebar),
    '--tab-hover': toHex(pick('tab.hoverBackground') ?? mix(sidebar, fg, 0.06)),
    '--dirty': toHex(pick('editorWarning.foreground', 'gitDecoration.modifiedResourceForeground') ?? parseColor('#e0af68')!),
    '--btn-hover': toHex(withAlpha(fg, 0.1)),
    '--panel-bg': toHex(sidebar),
    '--text': toHex(fg),
    '--text-muted': toHex(muted),
    '--hover': toHex(withAlpha(fg, 0.08)),
  };

  const terminal: Record<string, string> = {
    background: toHex(pick('terminal.background') ?? bg),
    foreground: toHex(pick('terminal.foreground') ?? fg),
    cursor: toHex(pick('terminalCursor.foreground', 'editorCursor.foreground') ?? fg),
    selectionBackground: toHex(pick('terminal.selectionBackground', 'editor.selectionBackground') ?? mix(bg, accent, 0.35)),
  };
  for (const name of ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White']) {
    const normal = pick(`terminal.ansi${name}`);
    const bright = pick(`terminal.ansiBright${name}`);
    if (normal) terminal[name.toLowerCase()] = toHex(normal);
    if (bright) terminal[`bright${name}`] = toHex(bright);
  }

  const preview: PreviewPalette = {
    bg: toHex(bg),
    fg: toHex(fg),
    muted: toHex(muted),
    link: toHex(pick('textLink.foreground') ?? accent),
    heading: toHex(styleFor('markup.heading')?.fg ?? fg),
    codeBg: toHex(pick('textCodeBlock.background') ?? sidebar),
    border: toHex(border),
    quoteBorder: toHex(pick('textBlockQuote.border') ?? border),
  };

  return {
    label: contribution.label ?? contribution.id ?? contribution.path,
    base,
    dark,
    monaco: { base, inherit: true, rules, colors: { ...colors, ...NO_HIGHLIGHT } },
    ruleTokens: rules.map((r) => r.token).filter(Boolean),
    chrome,
    terminal,
    preview,
    warnings,
  };
}

/** Markdown preview stylesheet for a plugin theme (mirrors the built-in ones). */
export function previewCss(p: PreviewPalette): string {
  return `
    body { background: ${p.bg}; color: ${p.fg}; }
    a { color: ${p.link}; }
    code { background: ${p.codeBg}; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    pre { background: ${p.codeBg}; padding: 16px; border-radius: 6px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { border-left: 4px solid ${p.quoteBorder}; padding: 0 16px; color: ${p.muted}; margin: 16px 0; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid ${p.border}; padding: 8px 12px; text-align: left; }
    th { background: ${p.codeBg}; font-weight: 600; }
    hr { border: none; border-top: 2px solid ${p.border}; margin: 24px 0; }
    img { max-width: 100%; }
    h1, h2 { border-bottom: 1px solid ${p.border}; padding-bottom: 8px; }
    h1, h2, h3, h4, h5, h6 { color: ${p.heading}; }
    .task-list-item { list-style: none; }
    .task-list-item input { margin-right: 6px; }
  `;
}
