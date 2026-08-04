# Somnoscribe Sleep Study Review Assistant

[![CI](https://github.com/alex-macra/somnoscribe/actions/workflows/ci.yml/badge.svg)](https://github.com/alex-macra/somnoscribe/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)](CHANGELOG.md)

Somnoscribe is an experimental, self-hosted review workspace for sleep-study artifacts. It preprocesses supported files, drafts evidence-linked observations with an LLM, and requires a human reviewer to adjudicate the output before sign-off.

> Somnoscribe is clinician-assist research software. It is not an autonomous diagnostic system, medical advice, a medical device, or a claim of regulatory or production readiness. Do not use it as the sole basis for diagnosis or treatment.

This alpha release is independently buildable from this repository. It includes no patient data, clinical reference pack, licensed institutional material, or external validation dataset.

## Capabilities

- Accepts EDF, PDF, and image artifacts after signature validation, and strips identifying EDF header fields before signal processing.
- Produces signal-quality metrics, candidate windows, and a compact evidence package.
- Streams a multi-stage evidence extraction and report-drafting workflow over SSE, preserving claim-to-evidence links and a reviewer audit trail.
- Requires authentication for reference reads and administrator authorization for reference mutations.
- Starts normally without a reference pack, and says so rather than hiding that deterministic reference validation is off.
- Ships synthetic unit, integration, and three-service browser tests that make no live model call.

## Screenshots

Captured from the synthetic browser journey, so every value shown is generated
fixture data rather than a study.

| Upload                                                                             | Case list                                                                   |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| ![Upload form with cohort selection and study file inputs](docs/images/upload.png) | ![Case list showing a signed-off synthetic case](docs/images/case-list.png) |

Review workspace, with the three analysis passes, the reference-pack warning, and an evidence-linked finding awaiting adjudication:

![Review workspace showing analysis passes and a pending finding with its supporting evidence](docs/images/review-workspace.png)

Drafted report sections, each requiring a reviewer decision before sign-off:

![Structured report sections with confirm, reject, uncertain, and edit controls](docs/images/report-sections.png)

Regenerate them with `npm run screenshots`.

## Services

| Service       | Stack                       | Default address         |
| ------------- | --------------------------- | ----------------------- |
| Web interface | React, TypeScript, Vite     | `http://127.0.0.1:5173` |
| API           | Express, TypeScript, SQLite | `http://127.0.0.1:3001` |
| Preprocessor  | FastAPI, MNE, pyEDFlib      | `http://127.0.0.1:8001` |

See [ARCHITECTURE.md](ARCHITECTURE.md) for boundaries and data flow, and [SAFETY.md](SAFETY.md) before evaluating the application.

## Run with Docker

The fastest way to evaluate the application. Needs only Docker, not a local Node,
Python, or C/C++ toolchain.

```bash
cp api/.env.example api/.env    # then set JWT_SECRET to a real 32-byte value
docker compose up --build
docker compose run --rm tools scripts/generateLicenses.ts 1 starter
```

The web interface is published on `http://127.0.0.1:5173` and proxies `/api` to the API container, so the browser sees a single origin. The API refuses to start, and names the variable, if `JWT_SECRET` is absent or too short.

Case data, the SQLite database, and generated evidence live in the `evidence` volume; `docker compose down -v` deletes them.

This stack is an evaluation aid, not a hardened deployment: plain HTTP on loopback, no TLS, secret manager, backup, or retention policy. Read [SECURITY.md](SECURITY.md) before exposing it anywhere.

## Quick start

To run the services directly on the host instead. Needs Node.js 22, Python 3.12,
and a C/C++ toolchain supported by `better-sqlite3`.

```bash
./scripts/setup.sh                                    # installs deps, writes api/.env
npm --prefix api run license:generate -- 1 starter    # mint an invitation
./scripts/dev.sh                                      # all three services on loopback
```

Use the generated invitation with `/api/auth/activate` or the activation form. A model API key is needed only for real analysis; the services boot and serve health checks without one.

The `license` naming here is historical and unrelated to the software's own licence. These keys are seats you mint against your own database: nothing contacts a licensing service, there is no paid tier, and the `tier` column is inert because no feature reads it. The `licenseKey` field and `licenses` table keep their names for deployment compatibility.

## Configuration

Important API environment variables:

| Variable           | Default                 | Meaning                                                                               |
| ------------------ | ----------------------- | ------------------------------------------------------------------------------------- |
| `HOST`             | `127.0.0.1`             | API bind address. Set a wider address explicitly for containers.                      |
| `TRUST_PROXY`      | `false`                 | `false`, `loopback`, or a positive proxy hop count.                                   |
| `CORS_ORIGINS`     | empty                   | Comma-separated allowed browser origins. Authenticated mutations enforce this policy. |
| `JWT_SECRET`       | development fallback    | Required in production and must be at least 32 bytes.                                 |
| `DB_PATH`          | `api/data/cases.sqlite` | SQLite database path.                                                                 |
| `PREPROCESSOR_URL` | `http://localhost:8001` | Preprocessor base URL.                                                                |
| `OPENAI_API_KEY`   | unset                   | Needed for real analysis calls.                                                       |
| `REFERENCE_DIR`    | unset                   | Optional external directory of validated Markdown rules.                              |

For reverse-proxy deployments, explicitly configure `HOST`, `TRUST_PROXY`, TLS, and `CORS_ORIGINS`. Production cookies are HTTP-only, SameSite=Lax, and Secure.

### Optional reference packs

Reference packs must stay outside the repository. When `REFERENCE_DIR` is unset, the app reports `{ enabled: false, filesLoaded: 0, rulesLoaded: 0 }` from authenticated `GET /api/references/status` and displays a warning during analysis.

The accepted file format and validation rules are documented in [docs/reference-pack-schema.md](docs/reference-pack-schema.md). A non-clinical example is available in [examples/reference-pack/synthetic-rules.md](examples/reference-pack/synthetic-rules.md).

## Checks

The full check list is in [CONTRIBUTING.md](CONTRIBUTING.md#checks). The one worth knowing about is `npm run check:boundary`, which rejects sensitive artifact types, symlinks, machine-specific paths, private source markers, non-example email addresses, and secret-like values before they can be published.

## Data handling

Never use real patient artifacts here; CI rejects them. See [SAFETY.md](SAFETY.md#data-governance) for the data policy and [SECURITY.md](SECURITY.md#deployment-responsibility) for what a self-hoster owns.

## Compatibility and trademarks

Somnoscribe contains parsers intended to interoperate with exports from SOMNOtouch™ RESP devices and DOMINO™ software. Those names are used only to describe compatibility. SOMNOtouch is a registered trademark of SOMNOmedics GmbH, and DOMINO is identified as a vendor mark. This project is independent and is not affiliated with, endorsed by, sponsored by, or supported by SOMNOmedics.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md). Please use a private GitHub security advisory for vulnerability reports; never include clinical data in a report.

## License

Copyright 2026 Alex Macra. Licensed under the [GNU Affero General Public License v3.0](LICENSE).

Evaluating, self-hosting, modifying, and running Somnoscribe inside your own organisation are all covered at no cost. The condition is reciprocity: if you modify it and let anyone reach it over a network, AGPL section 13 requires you to offer those users your modified source.

If that does not suit you — hosting it as a service, embedding it in a proprietary product, or combining it with code you cannot release under the AGPL — commercial terms are available. See [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md).

Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). [NOTICE](NOTICE) records the SOMNOmedics trademark position stated above.

To cite this software, use [CITATION.cff](CITATION.cff) or the "Cite this repository" control on the GitHub project page.
