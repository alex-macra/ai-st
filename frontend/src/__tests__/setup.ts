// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
