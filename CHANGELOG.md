# Changelog

This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Before `1.0.0`, interfaces may change in any release.

## [0.2.0-alpha.1] - 2026-08-05

First public alpha of the self-hosted, evidence-linked review workspace.

### Added

- Signature-validated EDF, PDF, and image ingestion with EDF-header replacement, screenshot cropping, and private temporary storage.
- FastAPI preprocessing for signal quality, candidate windows, and compact evidence packages.
- SSE analysis, typed report drafts, citation checks, review decisions, and reviewer sign-off records.
- A loopback single-operator mode with an optional shared bearer guard.
- Deterministic demo-model and demo-study paths that do not call a live model or use patient data.
- Optional, externally stored reference packs with strict schema validation and visible unavailable-state warnings.
- Docker Compose, synthetic tests, and a public-boundary check.

### Alpha limits

- Database schemas have no upgrade path. Delete `api/data/cases.sqlite` when moving between alpha versions.
- The tool is clinician-assist research software, not an autonomous diagnostic or production system. Read [Safety](SAFETY.md).
- The open-source license is [AGPL-3.0-only](LICENSE); [commercial terms](LICENSE-COMMERCIAL.md) are separate.
