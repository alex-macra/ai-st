# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version stays below `1.0.0`, any release may change interfaces.

## [Unreleased]

### Added

- Docker Compose stack running the web interface, API, and preprocessor, so the
  application can be evaluated without a host Node, Python, or C/C++ toolchain.
- ESLint and ruff configuration, enforced by a `Lint` job in CI.
- `.editorconfig` and a Prettier configuration for new code. The repository is
  not uniformly auto-formatted; see CONTRIBUTING.md.
- Issue and pull request templates, and this changelog.

### Changed

- The public boundary check rejects any dot-path outside a small allowlist,
  replacing the previously enumerated tool directories. The rule also applies to
  nested paths, which the top-level allowlist did not cover.
- The boundary check's private-marker list no longer carries person, dataset, or
  source names.

### Removed

- Dead code surfaced by the new linters: unused imports in the API, frontend,
  and preprocessor, and an unreferenced filename-sanitising helper.

## [0.1.0-alpha.1] - 2026-08-03

First public alpha. Independently buildable from this repository, with no
patient data, clinical reference pack, licensed institutional material, or
external validation dataset.

### Added

- EDF, PDF, and image ingestion behind signature validation, with identifying
  EDF header fields removed before signal processing.
- Signal-quality metrics, candidate window detection, and evidence packaging.
- A multi-stage evidence extraction and report-drafting workflow streamed over
  SSE, with claim-to-evidence links preserved.
- Reviewer adjudication, audit trail, and sign-off.
- Authentication for reference reads and administrator authorization for
  reference mutations. The application starts without a reference pack and
  reports that deterministic reference validation is disabled.
- Optional external reference packs, documented in
  [docs/reference-pack-schema.md](docs/reference-pack-schema.md).
- Synthetic unit, integration, and three-service browser tests that make no
  live model call.
- A public boundary check rejecting sensitive artifact types, symlinks,
  machine-specific paths, private source markers, non-example email addresses,
  and secret-like values.

[Unreleased]: https://github.com/alex-macra/ai-st/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/alex-macra/ai-st/releases/tag/v0.1.0-alpha.1
