# Reference-pack schema

`REFERENCE_DIR` points to an operator-owned directory outside this repository. Operators own the pack’s accuracy, licensing, review, and change control.

## Files

- The directory must be real, not a symbolic link.
- Direct `.md` entries are considered; nested directories and non-Markdown files are ignored.
- A symlinked or non-regular `.md` entry fails the pack.
- Limit: 100 files, 256 KiB per file, and 1,000 rules total.
- A load error leaves reference validation disabled and logs `reference_docs_seed_failed`.

Each file starts with strict front matter:

```yaml
---
ref_id: unique-source-id
source: Human-readable source title
cohort: adult
type: hsat
license: open
---
```

`cohort` is `adult`, `pediatric`, or `generic`; `type` is `hsat`, `psg`, or `generic`; `license` is `open`, `institutional`, or `restricted`. Public examples must use `open`.

## Rules

```markdown
- **id**: `unique-rule-id`
  **rule**: A concise, independently reviewable statement.
  **page**: Optional source location.
  **applies_to**: A concise statement of when the rule applies.
```

Rule IDs must be unique within a file, and each `ref_id:rule-id` pair must be unique across the pack.

## Runtime

Without `REFERENCE_DIR`, validation is disabled. `GET /api/references/status` returns `{ enabled, filesLoaded, rulesLoaded }`, and analysis emits `reference_pack_unavailable`. The optional access token guards this endpoint only when it is configured.
