// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
process.env['NODE_ENV'] = 'test';
process.env['OPENAI_API_KEY'] = 'sk-test-openai-key';
process.env['DB_PATH'] = ':memory:';
process.env['PREPROCESSOR_URL'] = 'http://localhost:8001';
