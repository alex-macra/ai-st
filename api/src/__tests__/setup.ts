// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env['NODE_ENV'] = 'test';
process.env['OPENAI_API_KEY'] = 'sk-test-openai-key';
process.env['DB_PATH'] = ':memory:';
process.env['PREPROCESSOR_URL'] = 'http://localhost:8001';
// Uploads write screenshots to disk. Without this they land in the repo's own
// `data/screenshots`, which is where real cases go.
process.env['SCREENSHOTS_DIR'] = path.join(tmpdir(), 'somnoscribe-test-screenshots');
