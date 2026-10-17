import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
// @ts-expect-error — JS-модуль без типов, общий с scripts/serve.mjs.
import { attachRelay } from './scripts/relay.mjs';

// База для GitHub Pages задаётся переменной VITE_BASE (например, /gonki-na-vyzhivanie/).
const base = process.env.VITE_BASE ?? '/';

/** Ретранслятор /relay и в dev-сервере, как в scripts/serve.mjs. */
const relay = (): Plugin => ({
  name: 'gonki-relay',
  configureServer(server) {
    if (server.httpServer) attachRelay(server.httpServer);
  },
});

export default defineConfig({
  base,
  plugins: [relay()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 8192,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        control: resolve(import.meta.dirname, 'control/index.html'),
        overlay: resolve(import.meta.dirname, 'overlay/index.html'),
      },
    },
  },
  server: { host: '127.0.0.1', port: 5173 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
