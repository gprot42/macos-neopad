// Plugins that ship inside NeoPad. On first launch each one is copied into
// the user's plugins folder, where it behaves like any installed plugin: it
// can be inspected, edited, disabled or uninstalled (and stays uninstalled).

export interface BuiltinPlugin {
  /** VS Code extension id, `publisher.name`, lower-cased. */
  id: string;
  /** Folder name in the plugins directory. */
  dirName: string;
  /** Relative path → file contents. */
  files: Record<string, string>;
}

const raw = import.meta.glob('./*/**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function collect(folder: string): Record<string, string> {
  const prefix = `./${folder}/`;
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, content]) => [path.slice(prefix.length), content]),
  );
}

export const BUILTIN_PLUGINS: BuiltinPlugin[] = [
  { id: 'neopad.sample-themes', dirName: 'neopad.sample-themes-1.0.0', files: collect('neopad.sample-themes') },
];
