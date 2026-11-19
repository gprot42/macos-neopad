import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

const host = process.env.TAURI_DEV_HOST;
// version.md holds the version on the line after "## Current Version", then the changelog.
const version =
  readFileSync('version.md', 'utf-8').match(/^## Current Version\s*\n\s*(\S+)/m)?.[1] ?? '0.0.0';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    // Monaco Editor chunks are intentionally large — suppress misleading warning
    chunkSizeWarningLimit: 5000,
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 5174 }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
