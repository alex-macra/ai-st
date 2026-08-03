import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/__tests__/**/*.test.ts'],
    testTimeout: 15_000,
    setupFiles: ['./src/__tests__/setup.ts']
  }
});
