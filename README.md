# Somnoscribe

[![CI](https://github.com/alex-macra/somnoscribe/actions/workflows/ci.yml/badge.svg)](https://github.com/alex-macra/somnoscribe/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](CHANGELOG.md)

Experimental, self-hosted software for evidence-linked review of sleep-study artifacts.

> Somnoscribe is clinician-assist research software, not a diagnostic system, medical device, medical advice, or a production-readiness claim. A qualified reviewer must decide every clinical conclusion.

![Synthetic review workspace with a pending finding and its supporting evidence](docs/images/review-workspace.png)

The screenshot is generated from synthetic fixtures. This repository contains no patient data, clinical reference pack, institutional material, or external validation dataset.

## Run

Docker is the quickest evaluation path:

```bash
docker compose up --build --wait
```

Open <http://localhost:5173>. To run locally instead, install Node.js 22, Python 3.12, and the build tools required by `better-sqlite3`:

```bash
./scripts/setup.sh
./scripts/dev.sh
```

An unset `OPENAI_API_KEY` uses the deterministic, non-clinical demo model. Set it in `api/.env` only when using a real provider.

## What it does

- Validates supported EDF, PDF, and image artifacts before processing.
- Builds a compact evidence package through a local FastAPI preprocessor.
- Streams an evidence-linked draft and review workflow over SSE.
- Runs as a loopback, single-operator workspace: no accounts or per-user separation.
- Loads optional, external reference packs; missing packs remain visible to the reviewer.

## Configuration

| Variable                   | Default     | Use                                                               |
| -------------------------- | ----------- | ----------------------------------------------------------------- |
| `HOST`                     | `127.0.0.1` | Widen only for an intentional deployment boundary.                |
| `TRUST_PROXY`              | `false`     | Set the actual proxy topology: `false`, `loopback`, or hop count. |
| `CORS_ORIGINS`             | unset       | Allow exact browser origins for mutations.                        |
| `OPENAI_API_KEY`           | unset       | Enables provider-backed analysis; unset is demo mode.             |
| `SOMNOSCRIBE_ACCESS_TOKEN` | unset       | Shared bearer guard for `/api`; not user authentication.          |
| `REFERENCE_DIR`            | unset       | External directory of validated Markdown rules.                   |

Reference packs stay outside source control. See the [schema](docs/reference-pack-schema.md) and [synthetic example](examples/reference-pack/synthetic-rules.md).

## Documentation

- [Architecture](ARCHITECTURE.md) — services, data flow, and API boundaries.
- [Safety](SAFETY.md) — intended use, limits, and data handling.
- [Security](SECURITY.md) — disclosure and deployment checklist.
- [Contributing](CONTRIBUTING.md) — setup, checks, DCO, and data rules.
- [Changelog](CHANGELOG.md) — alpha release notes.

## Data and compatibility

Never add patient artifacts, real identifiers, clinical reference material, or generated reports to this repository. The public-boundary check blocks known artifact types and publish-boundary markers; it cannot assess arbitrary content.

SOMNOtouch™ RESP and DOMINO™ are mentioned only to describe interoperability. Somnoscribe is independent of, and not endorsed by, SOMNOmedics. See [NOTICE](NOTICE).

## License

Copyright 2026 Alex Macra. Somnoscribe is [AGPL-3.0-only](LICENSE); network users of modified versions must receive the corresponding source. [Commercial terms](LICENSE-COMMERCIAL.md), [third-party notices](THIRD_PARTY_NOTICES.md), and [citation metadata](CITATION.cff) are available separately.
