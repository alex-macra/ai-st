// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

const contractsDir = fileURLToPath(new URL('../api/src/shared', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: { '@contracts': contractsDir },
  },
  build: {
    modulePreload: { polyfill: false },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
