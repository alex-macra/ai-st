// Copyright 2026 Alex Macra
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { parseRulesMarkdown } from '../refs/parseRulesMarkdown.js';

const FIXTURE = `---
ref_id: synthetic-example
source: Synthetic Reference Example
cohort: adult
type: hsat
license: open
---

# Header that should be ignored

- **id**: \`example-rule-one\`
  **rule**: Synthetic rule text used only for parser verification.
  **page**: example-1
  **applies_to**: synthetic claims in test fixtures.

- **id**: \`example-rule-two\`
  **rule**: A second deterministic synthetic rule.
  **page**: example-2
  **applies_to**: additional synthetic claims.
`;

describe('parseRulesMarkdown', () => {
  it('parses validated frontmatter metadata and rule blocks', () => {
    const parsed = parseRulesMarkdown(FIXTURE);
    expect(parsed).toMatchObject({
      sourceRefId: 'synthetic-example',
      sourceTitle: 'Synthetic Reference Example',
      cohort: 'adult',
      type: 'hsat',
      license: 'open',
    });
    expect(parsed.rules).toHaveLength(2);
    expect(parsed.rules[0]).toEqual({
      id: 'example-rule-one',
      rule: 'Synthetic rule text used only for parser verification.',
      page: 'example-1',
      appliesTo: 'synthetic claims in test fixtures.',
      sourceRefId: 'synthetic-example',
    });
  });

  it('throws on missing frontmatter', () => {
    expect(() => parseRulesMarkdown('no frontmatter here')).toThrow(/frontmatter/i);
  });

  it('throws on incomplete rule blocks', () => {
    const broken = `---
ref_id: synthetic-incomplete
source: Synthetic Incomplete Example
cohort: adult
type: hsat
license: open
---
- **id**: \`broken\`
  **rule**: Something synthetic.
  **page**: example-1
`;
    expect(() => parseRulesMarkdown(broken)).toThrow(/incomplete/i);
  });

  it('throws on an empty body', () => {
    const empty = `---
ref_id: synthetic-empty
source: Synthetic Empty Example
cohort: adult
type: hsat
license: open
---

(no rules here)
`;
    expect(() => parseRulesMarkdown(empty)).toThrow(/no rule blocks/i);
  });

  it('rejects unsupported metadata values', () => {
    expect(() => parseRulesMarkdown(FIXTURE.replace('license: open', 'license: private'))).toThrow(
      /invalid reference metadata/i,
    );
  });

  it('rejects duplicate rule IDs', () => {
    expect(() =>
      parseRulesMarkdown(FIXTURE.replace('example-rule-two', 'example-rule-one')),
    ).toThrow(/duplicate rule id/i);
  });

  it('rejects unsafe rule IDs', () => {
    expect(() => parseRulesMarkdown(FIXTURE.replace('example-rule-one', '../../outside'))).toThrow(
      /invalid rule id/i,
    );
  });
});
