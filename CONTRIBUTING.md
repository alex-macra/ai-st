# Contributing

Thank you for helping improve AI-ST. Contributions must preserve the evidence-first, human-review boundary and the public repository's strict data policy.

## Before opening a change

- Read [SAFETY.md](SAFETY.md) and [ARCHITECTURE.md](ARCHITECTURE.md).
- Search existing issues and pull requests.
- Use synthetic, deterministic fixtures only.
- Do not add clinical PDFs, EDFs, databases, generated reports, private reference material, copied standards, institutional documents, or real identifiers.
- Do not add symlinks or machine-specific absolute paths.
- Keep optional reference packs outside this repository.

If provenance or redistribution rights are unclear, do not submit the material. Describe the needed interface or schema with a non-clinical example instead.

## Local setup

```bash
./scripts/setup.sh
```

Run the focused tests while developing, then the full release checks:

```bash
npm run check:boundary
npm run lint
preprocessor/.venv/bin/ruff check preprocessor
npm --prefix api run typecheck
npm --prefix api test
npm --prefix api run build
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
preprocessor/.venv/bin/pytest -q preprocessor/tests
npm run test:e2e
```

Browser tests use a guarded synthetic model adapter and must not require a live model key.

## Formatting

Linting is enforced; formatting is not. `npm run lint` and `ruff check` must
pass, and both are limited to correctness rules — unused code, unsafe patterns,
and the rules of hooks.

The repository is not uniformly auto-formatted. A Prettier configuration and an
`.editorconfig` are provided so new code lands in a consistent style, but do not
reformat files you are not otherwise changing: a repository-wide rewrite would
bury behavioral changes in unrelated diff noise and erase the history that makes
clinical logic reviewable.

## Pull requests

A pull request should:

- explain the user-visible outcome and safety implications;
- include tests for changed behavior and failure paths;
- keep API and SSE contracts backward compatible unless the change is explicitly discussed;
- update public documentation when configuration or boundaries change;
- pass the repository-boundary and dependency checks;
- avoid unrelated formatting or generated output.

Accessibility is part of correctness. Interactive changes should preserve keyboard operation, focus visibility, semantic roles, theme behavior, and readable error feedback.

## Clinical and security changes

Do not use an issue for an undisclosed vulnerability or a sensitive-data leak. Follow [SECURITY.md](SECURITY.md). Clinical interpretation changes need an independently reviewable rationale and synthetic tests, but the repository still must not include restricted source material.

## License

Unless stated otherwise, contributions intentionally submitted for inclusion are licensed under Apache-2.0 as described in [LICENSE](LICENSE).
