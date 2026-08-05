# Contributing

Thank you for helping improve Somnoscribe. Contributions must preserve the evidence-first, human-review boundary and the public repository's strict data policy.

## Before opening a change

- Read [SAFETY.md](SAFETY.md) and [ARCHITECTURE.md](ARCHITECTURE.md), then search existing issues and pull requests.
- Follow the data policy in [SAFETY.md](SAFETY.md#data-governance): synthetic deterministic fixtures only, no clinical artifacts or real identifiers, reference packs outside this repository.
- Do not add symlinks or machine-specific absolute paths.

If provenance or redistribution rights are unclear, do not submit the material. Describe the needed interface or schema with a non-clinical example instead.

## Local setup

```bash
./scripts/setup.sh
```

## Checks

Run the focused tests while developing, then the full release checks:

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

Browser tests use a guarded synthetic model adapter and must not require a live model key. They serve `api/dist`, so run the API build first after changing API source.

## Formatting

Prettier owns TypeScript, JavaScript, CSS, and Markdown; `ruff format` owns Python. Both are enforced in CI, so an unformatted file fails the build.

```bash
npm run format
cd preprocessor && ruff format . && ruff check --fix .
```

Because the formatters decide layout, review comments should be about behaviour, not style. Lint is separate and covers correctness only: unused code, unsafe patterns, import order, and the rules of hooks.

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

## License and sign-off

Somnoscribe is licensed under [AGPL-3.0](LICENSE), and commercial terms are offered separately ([LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md)). That second track only stays possible if the maintainer can license the whole work, so every contribution needs a sign-off.

Sign each commit:

```bash
git commit -s
```

The `Signed-off-by` line certifies the [Developer Certificate of Origin 1.1](DCO): you wrote the contribution, or you have the right to submit it. By signing off you also agree that the maintainer may license your contribution under both the AGPL and the separate commercial terms. You keep your copyright.

If you cannot agree to that, say so in the pull request. A contribution can still be discussed and reimplemented independently.
