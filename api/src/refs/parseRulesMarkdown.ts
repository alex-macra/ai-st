import type { ReferenceRule } from '../shared/types.js';
import { z } from 'zod';

export interface ParsedRulesFile {
  sourceRefId: string;
  sourceTitle: string;
  cohort: 'adult' | 'pediatric' | 'generic';
  type: 'hsat' | 'psg' | 'generic';
  license: 'open' | 'institutional' | 'restricted';
  rules: ReferenceRule[];
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
const metadataSchema = z
  .object({
    ref_id: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9._-]*$/),
    source: z.string().trim().min(1).max(500),
    cohort: z.enum(['adult', 'pediatric', 'generic']),
    type: z.enum(['hsat', 'psg', 'generic']),
    license: z.enum(['open', 'institutional', 'restricted']),
  })
  .strict();

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) throw new Error('Missing YAML frontmatter');
  const yamlBlock = m[1] ?? '';
  const body = m[2] ?? '';
  const meta: Record<string, string> = {};
  for (const line of yamlBlock.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && value && !value.startsWith('|')) {
      meta[key] = value;
    }
  }
  return { meta, body };
}

const ID_LINE_RE = /^- \*\*id\*\*:\s*`([^`]+)`\s*$/;
const FIELD_LINE_RE = /^\s+\*\*([a-z_]+)\*\*:\s*(.+)$/;
const ruleIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);

export function parseRulesMarkdown(raw: string): ParsedRulesFile {
  const { meta, body } = parseFrontmatter(raw);

  const parsedMetadata = metadataSchema.safeParse(meta);
  if (!parsedMetadata.success) {
    throw new Error(
      `Invalid reference metadata: ${parsedMetadata.error.issues.map((issue) => issue.path.join('.') || issue.message).join(', ')}`,
    );
  }
  const sourceRefId = parsedMetadata.data.ref_id;
  const sourceTitle = parsedMetadata.data.source;
  const cohort = parsedMetadata.data.cohort;
  const type = parsedMetadata.data.type;
  const license = parsedMetadata.data.license;

  const rules: ReferenceRule[] = [];
  let current: Partial<ReferenceRule> | null = null;

  const flush = (): void => {
    if (!current) return;
    if (!current.id || !current.rule || !current.appliesTo) {
      throw new Error(`Incomplete rule block: ${JSON.stringify(current)}`);
    }
    rules.push({
      id: current.id,
      rule: current.rule,
      page: current.page ?? '',
      appliesTo: current.appliesTo,
      sourceRefId,
    });
    current = null;
  };

  for (const line of body.split('\n')) {
    const idMatch = line.match(ID_LINE_RE);
    if (idMatch && idMatch[1]) {
      flush();
      const parsedRuleId = ruleIdSchema.safeParse(idMatch[1]);
      if (!parsedRuleId.success) throw new Error(`Invalid rule id: ${idMatch[1]}`);
      current = { id: parsedRuleId.data, sourceRefId };
      continue;
    }
    if (!current) continue;
    const fieldMatch = line.match(FIELD_LINE_RE);
    if (!fieldMatch) continue;
    const key = fieldMatch[1];
    const value = (fieldMatch[2] ?? '').trim();
    if (key === 'rule' || key === 'pattern') current.rule = current.rule ?? value;
    else if (key === 'page') current.page = value;
    else if (key === 'applies_to' || key === 'implication')
      current.appliesTo = current.appliesTo ?? value;
    else if (key === 'channel' && !current.appliesTo) current.appliesTo = `${value} channel`;
  }
  flush();

  if (rules.length === 0) throw new Error('No rule blocks found in markdown body');
  const ids = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error(`Duplicate rule id: ${rule.id}`);
    ids.add(rule.id);
  }

  return { sourceRefId, sourceTitle, cohort, type, license, rules };
}
