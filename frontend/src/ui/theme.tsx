// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

const STORAGE_KEY = 'dark-mode';

function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function useDarkMode(): { dark: boolean; toggle: () => void } {
  const [dark, setDark] = useState(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === null ? systemPrefersDark() : saved === 'true';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.themeSwitching = 'true';
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
    // Settle the theme while transitions are disabled so intermediate colours cannot lose contrast.
    void root.offsetWidth;
    delete root.dataset.themeSwitching;
  }, [dark]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      if (window.localStorage.getItem(STORAGE_KEY) === null) setDark(event.matches);
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  const toggle = useCallback(() => {
    setDark((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return { dark, toggle };
}

export function DarkModeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="focus-ring rounded-xl p-2 text-ui-text-muted transition-colors hover:bg-ui-bg-muted hover:text-ui-text"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      onClick={onToggle}
    >
      {dark ? <Sun aria-hidden="true" size={18} /> : <Moon aria-hidden="true" size={18} />}
    </button>
  );
}
