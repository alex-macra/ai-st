// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Merged rather than redeclared, so plugins and module resolution -- including
// the @contracts alias to the API's wire types -- cannot drift from the build.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: false,
      include: ['src/__tests__/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/__tests__/setup.ts'],
      css: false,
    },
  }),
);
