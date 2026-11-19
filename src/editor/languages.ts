const extensionToLanguage: Record<string, string> = {
  // JavaScript / TypeScript
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  // Python
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  // Rust
  rs: 'rust',
  // Go
  go: 'go',
  // Java
  java: 'java',
  // C / C++
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  // C#
  cs: 'csharp',
  // HTML
  html: 'html',
  htm: 'html',
  // CSS
  css: 'css',
  // SCSS / LESS
  scss: 'scss',
  less: 'less',
  // JSON
  json: 'json',
  jsonc: 'json',
  // Markdown
  md: 'markdown',
  mdx: 'markdown',
  // YAML
  yaml: 'yaml',
  yml: 'yaml',
  // XML
  xml: 'xml',
  svg: 'xml',
  plist: 'xml',
  // SQL
  sql: 'sql',
  // Shell
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  // PHP
  php: 'php',
  // Ruby
  rb: 'ruby',
  // Swift
  swift: 'swift',
  // Misc
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  log: 'plaintext',
  txt: 'plaintext',
  text: 'plaintext',
  csv: 'plaintext',
  tsv: 'plaintext',
  env: 'plaintext',
  gitignore: 'plaintext',
  dockerfile: 'dockerfile',
  makefile: 'plaintext',
};

// Languages contributed by plugins (VS Code `contributes.languages`). They are
// checked before the built-in table: installing a language is an explicit
// choice, e.g. a TOML plugin should beat the built-in ".toml → ini" fallback.
export interface PluginLanguage {
  id: string;
  extensions?: string[];
  filenames?: string[];
}

let pluginFilenames = new Map<string, string>();
let pluginExtensions: [string, string][] = [];
let pluginLanguageIds: string[] = [];

export function setPluginLanguages(languages: PluginLanguage[]): void {
  pluginFilenames = new Map();
  const extensions = new Map<string, string>();
  for (const lang of languages) {
    for (const name of lang.filenames ?? []) pluginFilenames.set(name.toLowerCase(), lang.id);
    for (const ext of lang.extensions ?? []) extensions.set(ext.toLowerCase(), lang.id);
  }
  // Longest first, so ".blade.php" wins over ".php".
  pluginExtensions = [...extensions].sort((a, b) => b[0].length - a[0].length);
  pluginLanguageIds = [...new Set(languages.map((l) => l.id))];
}

export function detectLanguage(filePath: string): string {
  const parts = filePath.split('/').pop() ?? '';
  const lower = parts.toLowerCase();

  const fromPlugin = pluginFilenames.get(lower) ?? pluginExtensions.find(([ext]) => lower.endsWith(ext))?.[1];
  if (fromPlugin) return fromPlugin;

  // Special filenames
  if (lower === 'dockerfile') return 'dockerfile';
  if (lower === 'makefile' || lower === 'gnumakefile') return 'plaintext';
  if (lower === '.gitignore' || lower === '.dockerignore') return 'plaintext';

  const ext = lower.split('.').pop() ?? '';
  return extensionToLanguage[ext] ?? 'plaintext';
}

export const availableLanguages = [
  'plaintext',
  'javascript',
  'typescript',
  'python',
  'rust',
  'go',
  'java',
  'c',
  'cpp',
  'csharp',
  'html',
  'css',
  'scss',
  'less',
  'json',
  'markdown',
  'yaml',
  'xml',
  'sql',
  'shell',
  'php',
  'ruby',
  'swift',
  'dockerfile',
  'ini',
];

/** Built-in languages plus any contributed by plugins, for the language picker. */
export function getAvailableLanguages(): string[] {
  return [...new Set([...availableLanguages, ...pluginLanguageIds])];
}
