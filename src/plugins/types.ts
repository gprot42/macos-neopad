// The subset of a VS Code extension manifest (package.json) that NeoPad reads.
// See https://code.visualstudio.com/api/references/contribution-points

export interface ExtensionManifest {
  name: string;
  publisher: string;
  version: string;
  displayName?: string;
  description?: string;
  icon?: string;
  /** Present when the extension ships code. NeoPad never runs it. */
  main?: string;
  browser?: string;
  contributes?: Contributions;
}

export interface Contributions {
  themes?: ThemeContribution[];
  languages?: LanguageContribution[];
  grammars?: GrammarContribution[];
  snippets?: SnippetContribution[];
  [contributionPoint: string]: unknown;
}

export type UiTheme = 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';

export interface ThemeContribution {
  id?: string;
  label?: string;
  uiTheme?: UiTheme;
  path: string;
}

export interface LanguageContribution {
  id: string;
  aliases?: string[];
  extensions?: string[];
  filenames?: string[];
  firstLine?: string;
  mimetypes?: string[];
  configuration?: string;
}

export interface GrammarContribution {
  language?: string;
  scopeName: string;
  path: string;
  injectTo?: string[];
  embeddedLanguages?: Record<string, string>;
}

export interface SnippetContribution {
  language?: string;
  path: string;
}

/** The contribution points NeoPad understands; everything else is reported as unsupported. */
export const SUPPORTED_CONTRIBUTIONS = ['themes', 'languages', 'grammars', 'snippets'] as const;
