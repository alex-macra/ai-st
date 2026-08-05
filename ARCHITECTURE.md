# Architecture

Somnoscribe is a three-service, single-operator review workspace. Generated text remains a draft linked to evidence; a reviewer decides the outcome.

## Topology

```text
Browser ── REST/SSE ──> Express API ──> SQLite + local artifacts
                              │
                              ├──> FastAPI preprocessor
                              └──> configured model provider
```

| Service         | Responsibility                                                                   |
| --------------- | -------------------------------------------------------------------------------- |
| `frontend/`     | React interface, local API/SSE client, theme, and accessibility behavior.        |
| `api/`          | Uploads, validation, persistence, review state, SSE, and provider orchestration. |
| `preprocessor/` | De-identification, file inspection, signal quality, and evidence packaging.      |

The browser never accesses the database, preprocessor, model credential, or reference directory directly. All dependencies are public packages or application-owned code; no sibling repository is required.

## Data flow

1. The API rate-limits and validates uploads by signature, then uses a private temporary directory.
2. The preprocessor removes EDF header identifiers and crops screenshot banners before downstream storage or model use.
3. The API persists a compact evidence package, drafts reviewable findings and report sections, and streams progress over SSE.
4. A reviewer adjudicates findings and sections before sign-off. Sign-off is an attestation, not verified identity.

Temporary files are removed in `finally`. The preprocessor retains no source files.

## API boundary

- `GET /healthz` reports liveness.
- `POST /api/upload` accepts supported EDF, PDF, and image artifacts.
- `/api/cases/*` exposes case state, analysis SSE, review actions, and sign-off.
- `GET /api/references/status` returns optional reference-pack state.
- `/api/references/*` manages local SQLite reference documents; it does not write `REFERENCE_DIR`.
- `GET /api/config` exposes the active model mode for the interface.

SSE frames are `data: <json>\n\n`. The frontend parses progress, completion, warning, and error messages incrementally and can abort a stream.

## Operating model

- Local scripts bind the API and preprocessor to loopback. Compose keeps them on its private network; `HOST`, `TRUST_PROXY`, and `CORS_ORIGINS` must be set deliberately for other deployments.
- `SOMNOSCRIBE_ACCESS_TOKEN` is an optional shared bearer guard, not accounts, roles, or per-user access control.
- Without `OPENAI_API_KEY`, the deterministic demo adapter runs and the interface declares demo mode.
- `REFERENCE_DIR` is optional. Direct Markdown files are validated as a pack; a load error leaves validation disabled, and analysis emits `reference_pack_unavailable`.

See [Safety](SAFETY.md), [Security](SECURITY.md), and the [reference-pack schema](docs/reference-pack-schema.md) for operational limits.

## Repository boundary

Only source, synthetic fixtures, and public documentation belong here. The boundary check rejects known clinical artifact types, databases, generated reports, private reference material, symlinks, machine paths, and secret-like values.
