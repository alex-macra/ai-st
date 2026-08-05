// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { createUser, getUserByEmail } from '../db.js';

const DEV_EMAIL = 'reviewer@example.test';

const existing = getUserByEmail(DEV_EMAIL);
if (existing) {
  console.log(`Development user already exists (id: ${existing.id})`);
} else {
  const user = createUser(DEV_EMAIL);
  console.log(`Development user created (id: ${user.id})`);
}

console.log('Use the configured development email at /login.');
console.log('The local bypass code requires DEV_OTP_BYPASS=true and a non-production environment.');
