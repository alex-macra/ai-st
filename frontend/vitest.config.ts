import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/__tests__/setup.ts'],
    css: false,
  },
});
