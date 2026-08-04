# Contributing

Thank you for helping improve Somnoscribe. Contributions must preserve the evidence-first, human-review boundary and the public repository's strict data policy.

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

Formatting is automated and enforced in CI. Prettier owns TypeScript, JavaScript,
CSS, and Markdown; `ruff format` owns Python. Run both before opening a pull
request:

```bash
npm run format
cd preprocessor && ruff format . && ruff check --fix .
```

CI runs the checking form of each (`npm run format:check`, `ruff format --check .`),
so an unformatted file fails the build. Because the formatters decide layout,
review comments should be about behaviour rather than style, and you should never
need to hand-align anything.

Lint is separate and is limited to correctness rules: unused code, unsafe
patterns, import order, and the rules of hooks. `npm run lint` and `ruff check .`
must both pass with no warnings.

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
