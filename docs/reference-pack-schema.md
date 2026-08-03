# Reference pack schema

Somnoscribe can optionally load operator-supplied validation rules from the directory named by `REFERENCE_DIR`. Reference packs are not bundled with the application. Operators are responsible for accuracy, licensing, review, and change control.

The directory must be a real directory, not a symbolic link. Only direct `.md` files are read; nested directories and symlinked files are rejected. Each file must be no larger than 256 KiB, a pack may contain at most 100 Markdown files, and the combined pack may contain at most 1,000 rules. All files are validated before any rules are loaded.

Each file begins with strict front matter:

```yaml
---
ref_id: unique-source-id
source: Human-readable source title
cohort: adult
type: hsat
license: open
---
```

Allowed `cohort` values are `adult`, `pediatric`, and `generic`. Allowed `type` values are `hsat`, `psg`, and `generic`. The supported license value for a public, redistributable example is `open`; do not place restricted or institutional content in this repository.

Rules use this Markdown shape:

```markdown
- **id**: `unique-rule-id`
  **rule**: A concise, independently reviewable statement.
  **page**: Optional source location.
  **applies_to**: A concise statement of when the rule applies.
```

Rule IDs must be unique within a file. The combined `ref_id:rule-id` must also be unique across the directory. Malformed metadata, incomplete rules, duplicate IDs, unsupported values, oversized files, and symlinks stop loading with an explicit startup error.

When `REFERENCE_DIR` is unset, Somnoscribe starts with reference validation disabled. Authenticated users can inspect `GET /api/references/status`, which returns `{ enabled, filesLoaded, rulesLoaded }`. Each analysis also emits `reference_pack_unavailable` so the interface cannot imply that deterministic reference validation ran.
