# Contributing

Keep changes evidence-first, reviewable, and safe to publish.

## Start

```bash
./scripts/setup.sh
```

Use only deterministic synthetic fixtures. Never add clinical artifacts, real identifiers, private reference material, generated reports, symlinks, or machine-specific paths. If provenance or redistribution rights are unclear, leave the material out.

## Checks

```bash
npm run check:boundary
npm run lint && npm run format:check
preprocessor/.venv/bin/ruff check preprocessor
preprocessor/.venv/bin/ruff format --check preprocessor
npm --prefix api run typecheck && npm --prefix api test && npm --prefix api run build
npm --prefix frontend run typecheck && npm --prefix frontend test && npm --prefix frontend run build
preprocessor/.venv/bin/pytest -q preprocessor/tests
npm run test:e2e
```

Browser tests use the guarded synthetic model adapter and must not call a live provider.

## Pull requests

- Explain the user-visible and safety impact.
- Test changed behavior and failure paths.
- Preserve API and SSE contracts, or discuss a breaking change first.
- Update documentation when configuration or boundaries change.
- Keep keyboard access, focus visibility, semantic roles, theme behavior, and readable errors.
- Avoid unrelated formatting and generated output.

Report undisclosed vulnerabilities or sensitive-data leaks through [Security](SECURITY.md), not an issue.

## Sign-off

Every commit needs a Developer Certificate of Origin sign-off:

```bash
git commit -s
```

By signing, you confirm you can submit the contribution and allow the maintainer to license it under [AGPL-3.0](LICENSE) and the existing [commercial terms](LICENSE-COMMERCIAL.md). You retain your copyright.
