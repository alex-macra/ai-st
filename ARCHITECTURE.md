# Architecture

AI-ST is a three-service, self-hosted application. Its primary design constraint is that generated content remains a review draft tied to observable evidence, never an autonomous conclusion.

## Runtime topology

```text
Browser
  │ same-origin REST and SSE
  ▼
Express API ───────────────► SQLite and private local artifacts
  │
  ├─ authenticated upload ─► FastAPI preprocessor
  │                          ├─ de-identification
  │                          ├─ signal inventory and quality checks
  │                          ├─ candidate-window generation
  │                          └─ compact evidence package
  │
  └─ analysis request ─────► configured model API
                             ├─ evidence extraction
                             ├─ structured draft
                             └─ unsupported-claim validation
```

The web interface has no direct access to the database, preprocessing service, model credentials, or external reference directory.

## Repository layout

```text
api/             Express API, SQLite migrations, authentication, SSE, uploads
frontend/        React interface and application-owned UI/API client
preprocessor/    FastAPI signal and document preprocessing
e2e/             synthetic Playwright journeys
docs/            public operator-facing specifications
examples/        non-clinical examples
scripts/         setup and repository-boundary checks
```

Clinical artifacts, generated output, databases, private reference material, and internal planning records are outside the public source boundary.

## API boundaries

The API owns the public wire contracts:

- `/healthz` reports process health.
- `/api/auth/*` handles local invitations, OTP sessions, and account state.
- `/api/upload` accepts multipart EDF, PDF, and image artifacts.
- `/api/cases/*` provides case state, review actions, analysis SSE, and sign-off.
- `/api/references/status` reports optional reference-pack availability.
- `/api/references/*` exposes authenticated reads and administrator-only mutations.

Long model operations use SSE messages framed as `data: <json>\n\n`. Existing progress, completion, warning, and error contracts are parsed incrementally by the local frontend client and can be aborted with `AbortController`.

## Application-owned modules

The API uses direct public dependencies behind small local boundaries:

- `jsonwebtoken` for restricted HS256 session tokens.
- `better-sqlite3` for connection and migration logic.
- `openai` for non-streaming model calls inside an SSE workflow.
- `pino` for structured, redacted logs and hashed IP addresses.
- Zod for request, model-output, and reference-pack validation.
- Helmet and Express Rate Limit behind adapters that preserve response headers and error shapes.

The frontend owns its HTTP/SSE client, semantic design tokens, primitives, overlays, navigation widgets, and theme persistence. These modules have no package-time or runtime dependency on a sibling repository.

## Upload lifecycle

1. Authentication and rate limits run before upload processing.
2. Multer writes randomized filenames into a per-request directory with mode `0700` under the configured private temporary root.
3. The API enforces aggregate and per-artifact limits, then validates file signatures rather than trusting extensions or MIME labels.
4. Only normalized filenames are forwarded to the preprocessor or persisted as screenshot metadata.
5. The preprocessor de-identifies EDF header fields before downstream parsing.
6. The API stores the compact package and an artifact hash, never the original upload filename.
7. Temporary request files are deleted in `finally`; partially persisted screenshot directories are removed on failure.

The preprocessor uses its own temporary directory context and does not retain incoming source files.

## Analysis lifecycle

1. Pass 1 extracts findings that must each carry at least one evidence reference.
2. Deterministic bounds checks remove impossible numeric values before drafting.
3. Pass 2 builds a typed structured report and section citations.
4. A local citation check records unsupported sections as visible warnings.
5. Pass 3 performs an additional unsupported-claim review.
6. Pass 3b runs only when a valid external reference pack is enabled.
7. Findings, report, warnings, flags, token use, and audit metadata are persisted.
8. A reviewer confirms, rejects, edits, or marks uncertainty and must review populated sections before sign-off.

Public prompts do not bundle a clinical reference source. They prohibit adding external thresholds, guideline claims, or treatment recommendations that are absent from supplied evidence or a validated optional rule.

## Optional references

`REFERENCE_DIR` is resolved at process startup. The loader accepts direct regular Markdown files only, rejects symlink directories and entries, limits each file to 256 KiB, validates strict metadata, rejects duplicate IDs, and loads all-or-nothing.

If the variable is absent, startup succeeds with reference validation disabled. Status is explicit through the API and each analysis emits `reference_pack_unavailable`. See [docs/reference-pack-schema.md](docs/reference-pack-schema.md).

## Authentication and authorization

Invitation keys and OTP values use cryptographic randomness. Activation burns an invitation transactionally. Sessions use HTTP-only cookies with SameSite=Lax; production adds Secure. JWT verification restricts algorithms to HS256.

Case and reference reads require authentication. Administrative account and reference mutations require the administrator role. Authenticated mutating methods enforce the configured browser origin policy. API logs exclude raw email addresses, filenames, clinical bodies, model payload fragments, and OTP values.

## Network defaults

The API and development preprocessor bind to loopback. `TRUST_PROXY` defaults to `false`; deployments must opt into `loopback` or a positive hop count after matching the actual proxy chain. A container deployment must explicitly widen `HOST`.

## Test-only model adapter

The browser smoke journey sets `AI_ST_SYNTHETIC_LLM=true` with `NODE_ENV=test`. The adapter returns deterministic, non-clinical JSON for every analysis pass. Enabling it in any other environment throws during initialization. This path proves activation, upload, preprocessing, SSE, persistence, review, and sign-off without a network model call.

## Persistence limits

SQLite and local artifact storage are appropriate for controlled single-node evaluation, not a claim of multi-tenant production readiness. There is no built-in encryption-at-rest, key management, retention scheduler, high-availability topology, or regulated audit export. Operators must provide those controls where required.
