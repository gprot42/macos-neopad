// Where plugin files come from. In the app, the Rust side owns the plugins
// folder (see src-tauri/src/plugins.rs). In a plain browser (`bun run
// dev:vite`) there is no file system, so the built-in plugins are served
// read-only straight from the bundle.

import { invoke, isTauri } from '@tauri-apps/api/core';
import { BUILTIN_PLUGINS } from './builtin';

export interface InstalledPlugin {
  dirName: string;
  path: string;
  /** Raw package.json text. */
  manifest: string;
}

export interface PluginBackend {
  /** False in the browser fallback, which can only show built-in plugins. */
  readonly writable: boolean;
  list(): Promise<InstalledPlugin[]>;
  readText(dirName: string, path: string): Promise<string>;
  readBase64(dirName: string, path: string): Promise<string>;
  installVsix(filePath: string): Promise<InstalledPlugin>;
  installFromOpenVsx(namespace: string, name: string, version: string): Promise<InstalledPlugin>;
  uninstall(dirName: string): Promise<void>;
  reveal(dirName?: string): Promise<void>;
  /** Copies the built-in plugins into the plugins folder, once per plugin ever. */
  seedBuiltins(): Promise<void>;
}

const tauriBackend: PluginBackend = {
  writable: true,
  list: () => invoke('plugins_list'),
  readText: (dirName, path) => invoke('plugins_read_text', { dirName, path }),
  readBase64: (dirName, path) => invoke('plugins_read_base64', { dirName, path }),
  installVsix: (path) => invoke('plugins_install_vsix', { path }),
  installFromOpenVsx: (namespace, name, version) =>
    invoke('plugins_install_openvsx', { namespace, name, version }),
  uninstall: (dirName) => invoke('plugins_uninstall', { dirName }),
  reveal: (dirName) => invoke('plugins_reveal', { dirName: dirName ?? null }),
  async seedBuiltins() {
    for (const p of BUILTIN_PLUGINS) {
      await invoke('plugins_seed', {
        pluginId: p.id,
        dirName: p.dirName,
        files: Object.entries(p.files),
      });
    }
  },
};

function builtinFile(dirName: string, path: string): string {
  const plugin = BUILTIN_PLUGINS.find((p) => p.dirName === dirName);
  const content = plugin?.files[path.replace(/^\.\//, '')];
  if (content === undefined) throw new Error(`Not found: ${path}`);
  return content;
}

const unavailable = () => Promise.reject(new Error('Installing plugins needs the NeoPad app'));

const browserBackend: PluginBackend = {
  writable: false,
  list: async () =>
    BUILTIN_PLUGINS.map((p) => ({ dirName: p.dirName, path: `(built in)/${p.dirName}`, manifest: p.files['package.json'] })),
  readText: async (dirName, path) => builtinFile(dirName, path),
  readBase64: async (dirName, path) => btoa(unescape(encodeURIComponent(builtinFile(dirName, path)))),
  installVsix: unavailable,
  installFromOpenVsx: unavailable,
  uninstall: unavailable,
  reveal: unavailable,
  seedBuiltins: async () => {},
};

export const backend: PluginBackend = isTauri() ? tauriBackend : browserBackend;
