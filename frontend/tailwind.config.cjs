// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ui: {
          bg: 'rgb(var(--ui-bg) / <alpha-value>)',
          'bg-raised': 'rgb(var(--ui-bg-raised) / <alpha-value>)',
          'bg-muted': 'rgb(var(--ui-bg-muted) / <alpha-value>)',
          'bg-subtle': 'rgb(var(--ui-bg-subtle) / <alpha-value>)',
          text: 'rgb(var(--ui-text) / <alpha-value>)',
          'text-muted': 'rgb(var(--ui-text-muted) / <alpha-value>)',
          'text-subtle': 'rgb(var(--ui-text-subtle) / <alpha-value>)',
          border: 'rgb(var(--ui-border) / <alpha-value>)',
          accent: 'rgb(var(--ui-accent) / <alpha-value>)',
          'accent-solid': 'rgb(var(--ui-accent-solid) / <alpha-value>)',
          'accent-solid-hover': 'rgb(var(--ui-accent-solid-hover) / <alpha-value>)',
          'accent-fg': 'rgb(var(--ui-accent-fg) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
