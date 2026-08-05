# Architecture

Somnoscribe is a three-service, self-hosted application. Its primary design constraint is that generated content remains a review draft tied to observable evidence, never an autonomous conclusion.

## Runtime topology

```text
Browser
  │ same-origin REST and SSE
  ▼
Express API ───────────────► SQLite and private local artifacts
  │
  ├─ upload ───────────────► FastAPI preprocessor
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
api/             Express API, SQLite schema, SSE, uploads
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
- `/api/upload` accepts multipart EDF, PDF, and image artifacts.
- `/api/cases/*` provides case state, review actions, analysis SSE, and sign-off.
- `/api/references/status` reports optional reference-pack availability.
- `/api/references/*` reads and mutates the optional reference pack.

Long model operations use SSE messages framed as `data: <json>\n\n`. Existing progress, completion, warning, and error contracts are parsed incrementally by the local frontend client and can be aborted with `AbortController`.

## Application-owned modules

The API uses direct public dependencies behind small local boundaries: `better-sqlite3` (connection and migrations), `openai` (non-streaming calls inside an SSE workflow), `pino` (structured, redacted logs with hashed IPs), Zod (request, model-output, and reference-pack validation), and Helmet plus Express Rate Limit behind adapters that preserve response headers and error shapes.

The frontend owns its HTTP/SSE client, semantic design tokens, primitives, overlays, navigation widgets, and theme persistence. It imports the wire contract types from the API's `src/shared/`, which is type-only and pulls in no server code. Neither side depends on a sibling repository.

## Upload lifecycle

1. Rate limits, and the access-token check when one is configured, run before any upload processing.
2. Multer writes randomized filenames into a per-request directory with mode `0700` under the private temporary root.
3. The API enforces aggregate and per-artifact limits, then validates file signatures rather than trusting extensions or MIME labels.
4. Only normalized filenames reach the preprocessor or screenshot metadata.
5. The preprocessor de-identifies EDF header fields before downstream parsing, and crops the patient banner off each screenshot at `POST /deidentify/screenshot`. Screenshots, unlike the EDF, are stored and later read back at analysis time and sent to the model, so the API calls this before the first write and rejects the upload if it fails — it never falls back to the original bytes.
6. The API stores the compact package and an artifact hash, never the original filename.
7. Temporary request files are deleted in `finally`; partially written screenshot directories are removed on failure.

The preprocessor uses its own temporary directory context and retains no source files.

## Analysis lifecycle

1. Pass 1 extracts findings, each of which must carry at least one evidence reference.
2. Deterministic bounds checks drop impossible numeric values before drafting.
3. Pass 2 builds a typed structured report with section citations.
4. A local citation check records unsupported sections as visible warnings.
5. Pass 3 reviews for unsupported claims; pass 3b runs only with a valid external reference pack.
6. Findings, report, warnings, flags, token use, and audit metadata are persisted.
7. A reviewer confirms, rejects, edits, or marks uncertainty, and must review every populated section before sign-off.

Public prompts bundle no clinical reference source, and forbid thresholds, guideline claims, or treatment recommendations absent from the supplied evidence or a validated optional rule.

## Optional references

`REFERENCE_DIR` resolves at startup. The loader takes direct regular Markdown files only, rejects symlinked directories and entries, caps each file at 256 KiB, validates metadata strictly, rejects duplicate IDs, and loads all-or-nothing.

Without the variable, startup succeeds with reference validation disabled: the API reports it and every analysis emits `reference_pack_unavailable`. See [docs/reference-pack-schema.md](docs/reference-pack-schema.md).

## No authentication

There are no accounts, sessions, roles, or per-user case separation. Every request that reaches the API gets the whole workspace. This is a single-operator local tool and the design assumes it is run as one — see [SAFETY.md](SAFETY.md) for the obligations that assumption creates.

`SOMNOSCRIBE_ACCESS_TOKEN`, when set, requires that value as a bearer token on every `/api` route except `/healthz` and `/api/config`; those two stay open so the interface can render and report its model mode before a token is supplied. The comparison is constant-time. It is a shared secret with no identity attached — it cannot distinguish two operators or be revoked for one of them.

Mutating methods enforce the configured browser origin policy whether or not a token is set. Logs exclude filenames, clinical bodies, and model payload fragments.

Sign-off is the only action that names a person, and the name is typed by the reviewer rather than derived from an authenticated session. It is stored verbatim in the audit entry and printed on the report as an attestation, not as verified identity.

## Network defaults

The API and development preprocessor bind to loopback. `TRUST_PROXY` defaults to `false`; deployments must opt into `loopback` or a positive hop count after matching the actual proxy chain. A container deployment must explicitly widen `HOST`.

## Offline model adapter

One adapter returns deterministic, non-clinical JSON for every analysis pass. There is no operator switch: an absent, empty, or whitespace-only `OPENAI_API_KEY` all count as no key, and no key means the offline adapter. This is what lets a fresh clone reach a drafted report with nothing configured. `SOMNOSCRIBE_SYNTHETIC_LLM=true` is the browser smoke journey's narrower switch and still throws during initialization outside `NODE_ENV=test`.

Disclosure carries the weight the old switch used to: `GET /api/config` reports `llmMode`, and the interface shows a banner whenever it is `demo`. Either way the path proves upload, preprocessing, SSE, persistence, review, and sign-off without a network model call.

The provider client is constructed only when an analysis or action-plan job begins, never at import. That job holds one client and one mode for all of its passes, so a job that started offline cannot fall through to a provider if the environment changes mid-stream.

## Demo study

`GET /demo/study.edf` on the preprocessor generates a synthetic recording from a fixed seed — the API passes it through at `/api/demo/study.edf`, and the browser uploads it through the ordinary `/api/upload` route. Nothing about the demo bypasses validation, de-identification, or preprocessing. `GET /demo/summary` returns what the generator wrote in, which is what lets the interface distinguish the events placed in the waveform from the events the detector recovers from it.

## Persistence limits

SQLite and local artifact storage suit controlled single-node evaluation, not multi-tenant production. There is no built-in encryption-at-rest, key management, retention scheduler, high-availability topology, or regulated audit export; see [SECURITY.md](SECURITY.md#deployment-responsibility) for what an operator must supply instead.
