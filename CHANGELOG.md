# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the version stays below `1.0.0`, any release may change interfaces.

## [Unreleased]

### Removed

- `docs/fresh-repo-handoff.md`. It was a one-off internal checklist for moving
  the tree into this repository, which has happened; publishing it exposed
  process notes that tell a reader of the project nothing about using it.

### Fixed

- The audit trail attributed sign-off to `operator`, the fixed internal actor,
  and never showed the reviewer name it had stored. The name was persisted and
  printed on the report, so the record was intact — the review tab just would
  not show it. Report-section decisions also appeared as raw `section confirm`
  next to humanised labels, and did not say which section they applied to.
- The supported-versions statement in [SECURITY.md](SECURITY.md) still named the
  `0.1.x` line.
- The root and frontend lockfiles still declared `0.1.0-alpha.1`.

## [0.2.0-alpha.1] - 2026-08-05

Somnoscribe no longer has accounts. A fresh clone now reaches a drafted report
with nothing configured — no invitation to mint, no sign-in, and no model key.
That removed roughly a fifth of the codebase.

### Removed

- **Accounts, in full.** Sign-up, sign-in, invitation keys, OTP email, sessions,
  the administrator role, organizations, per-user token quotas, the admin
  console, the usage page, and per-user case scoping. Somnoscribe is a
  single-operator workspace: every request that reaches the API gets the whole
  workspace. Read [SAFETY.md](SAFETY.md#no-authentication) before exposing it —
  this is a real change in security posture, not only a smaller codebase.
- `JWT_SECRET`, `AUTH_RATE_LIMIT_MAX`, and the startup check that refused to
  boot without a secret. Nothing signs a session any more.
- `SOMNOSCRIBE_DEMO_MODE` and `SOMNOSCRIBE_DEMO_MAX_ACTIVE_PRINCIPALS`, together
  with the demo principal, its four-hour expiry, concurrency caps, reserved
  email, and artifact purge. Most of that machinery existed to hand out a
  keyless _account_, which is moot now there are none.
- The `licenses`, `users`, `organizations`, `auth_otps`, `analysis_audit`, and
  `admin_audit_log` tables, and the `created_by` / `organization_id` columns on
  `cases`.
- The `license:generate` and `make:admin` scripts.
- The `jsonwebtoken`, `cookie-parser`, and `nodemailer` dependencies, and the
  SMTP module that only the removed OTP sign-in used.
- Unreachable UI: the account menu, `QuotaCard`, `StatCard`, `Pagination`, and
  the confidence-tone helper that was provably always one value.

### Added

- `SOMNOSCRIBE_ACCESS_TOKEN`. When set, every `/api` route except `/healthz` and
  `/api/config` requires it as a bearer token, compared in constant time. It is
  a single shared secret with no identity attached — a safety valve for an
  operator who exposes the port, not an authentication system.
- A required reviewer name at sign-off, stored in the audit entry and printed on
  the report. With no accounts it is an attestation the reviewer types, not a
  verified identity, and the documentation says so.

### Changed

- **The offline model is the default rather than a switch.** No
  `OPENAI_API_KEY` means every analysis pass is answered by the offline
  generator, with the banner on screen throughout; set a key and the same
  workflow calls the provider. The `unconfigured` state, in which analysis
  refused to run at all, is gone. `SOMNOSCRIBE_SYNTHETIC_LLM` keeps its narrower
  test-environment-only rule.
- **The database schema is declared once with no upgrade path.** The 21 `ALTER
TABLE` statements and the legacy table rebuild are gone. **Breaking: delete
  any existing `data/cases.sqlite`** — it will not be migrated. Versioned
  migrations return at 1.0.
- The Docker quick start is `docker compose up --build --wait` with no
  preceding configuration step.
- Uploading the generated demo study is now recognised by hash for provenance
  rather than enforced as the only permitted upload.

### Fixed

- **Screenshots were stored without being de-identified.** The DOMINO patient
  banner was cropped by a function nothing ever called: the preprocessor read
  the uploaded bytes and discarded them, and the API wrote the originals
  straight to disk, from where analysis read them back and sent them to the
  model provider. The API now crops every screenshot through the
  preprocessor's new `POST /deidentify/screenshot` before the first write, and
  **rejects an upload it cannot de-identify** rather than falling back to the
  original. The crop is a fixed strip, not content detection —
  [SAFETY.md](SAFETY.md#what-de-identification-does-and-does-not-do) states what
  it does not cover.
- The primary respiratory index was never bounds-checked. `metricBounds` keyed
  on `study_metrics.provisional_ahi_per_hour` while the Pass-1 prompt emits
  `provisional_rei_per_hour`, so the impossible-value and out-of-range guards
  silently skipped the headline metric of every EDF case while still checking
  the SpO2 and ODI values.
- `confidenceFactors` and `confidenceRationale` were stripped before
  persistence. The Pass-1 prompt asked for both and zod discarded them as
  unknown keys, so the confidence popover always rendered generic fallback text
  and never showed a factor chip.
- `evidence_packager` opened each EDF four separate times, once per channel
  summary, and restated the quality-floor gate at each site.

## [0.1.0-alpha.2] - 2026-08-05

### Added

- Docker Compose stack running the web interface, API, and preprocessor, so the
  application can be evaluated without a host Node, Python, or C/C++ toolchain.
- ESLint and ruff configuration, enforced by a `Lint` job in CI.
- Prettier and `ruff format`, applied across the repository and enforced in CI
  by `npm run format:check` and `ruff format --check`.
- `.editorconfig`, issue and pull request templates, and this changelog.
- `CITATION.cff`, so the project can be cited from its GitHub page.
- An explicit `license` field on each package manifest.
- `docs/fresh-repo-handoff.md`, recording what a re-publication would need.
- Randomised tests comparing the shared run-length scan against a reference
  implementation written by a different method, plus the window and degenerate-
  input properties the three detectors built on it must hold.
- A generated demo study, so the application can be evaluated without a sleep
  study to hand. The upload page offers to build a two-hour synthetic recording
  from a fixed seed and states what it wrote into the signal; it then goes
  through the same upload, de-identification, and preprocessing path as a real
  file. Served by the preprocessor at `/demo/study.edf`.
- `SOMNOSCRIBE_DEMO_MODE`, which answers every analysis pass from the offline
  adapter that until now only the browser suite could reach. The workflow is
  otherwise unchanged, and the interface carries a banner while it is on.
  `SOMNOSCRIBE_SYNTHETIC_LLM` keeps its narrower test-environment-only rule.
- A demo user. While demo mode is on, the sign-in screen offers **Continue as
  demo user**, which creates a fresh isolated principal while displaying
  `demo@example.test`, with no invitation key, emailed code, or SMTP
  configuration. It holds no administrator rights, expires with cleanup, and is
  gated on the same switch that routes analysis to the offline model, so it
  cannot expose a real provider credential to an anonymous visitor.
- `GET /api/config`, reporting whether analysis is available and which model
  backs it. It never returns the credential.

### Changed

- **The project is relicensed from Apache-2.0 to AGPL-3.0-only**, with commercial
  terms offered separately in `LICENSE-COMMERCIAL.md`. Self-hosting, modifying,
  and internal use stay free; running a modified version as a network service now
  requires offering that source to its users. Contributions are accepted under the
  Developer Certificate of Origin with a commercial-relicensing grant, which is
  what keeps the second track available. Every source file carries an SPDX header.
  The `v0.1.0-alpha.1` tag remains available under Apache-2.0; the change binds
  everything after it.
- **The project is renamed from AI-ST to Somnoscribe.** This renames the
  repository, the package names, the Docker image and volume paths
  (`/var/lib/somnoscribe`), and the `SOMNOSCRIBE_*` environment variables that
  were previously `AI_ST_*`. GitHub redirects the old repository URL, but any
  existing deployment must rename its environment variables and either move or
  re-point its data volume.
- The public boundary check rejects any dot-path outside a small allowlist,
  replacing the previously enumerated tool directories. The rule also applies to
  nested paths, which the top-level allowlist did not cover.
- The boundary check's private-marker list no longer carries person, dataset, or
  source names.
- README states plainly that invitation keys are self-issued seats rather than a
  commercial licence, and that the inert `tier` column gates nothing.
- The frontend imports the wire contract from the API through a `@contracts/*`
  alias instead of maintaining its own copy of the types by hand. Three types had
  drifted; `User` is now split into the persisted row and the `AuthenticatedUser`
  payload the auth routes actually send.
- Documentation states each policy once and links to it, rather than restating
  the data policy and deployment responsibilities across five files.
- Data-fetching effects no longer set loading state synchronously. A refresh in
  the case list keeps the current list visible until the new one arrives instead
  of flashing a spinner.

- Newly minted invitation keys carry a `SOMNO-` prefix rather than the
  pre-rename `AIST-`. Keys are looked up by exact value, so keys minted before
  this change keep working.

### Fixed

- An empty `OPENAI_API_KEY` crashed the API at import with a raw provider stack
  trace, contradicting the documented behaviour that the services boot without
  one. `api/.env.example` shipped the variable set to a placeholder, so blanking
  it rather than deleting the line — the obvious move for anyone without a key —
  was enough to trigger it. An empty or whitespace-only value now counts as
  absent, and the provider client is constructed when an analysis job begins
  rather than at import, so an unconfigured API starts and serves everything up
  to the analysis passes.
  Analysis alone fails, and names the variable to set.
- Flow reduction detection raised a broadcast error, surfacing as a failed
  ingest, whenever a recording was longer than the minimum event duration but
  shorter than the two-minute rolling baseline. The baseline window is now
  capped at the length of the recording.
- `QuotaCard` read the clock during render, so an unrelated re-render could jump
  the reset countdown. The clock is state, updated on its own interval.
- The web image could not be built: the frontend resolves the wire contracts
  through a `@contracts` alias into `api/src/shared`, which the build stage never
  received.
- Mutations issued through the Compose proxy were rejected as cross-origin. nginx
  normalised the browser's port out of the `Host` header, so the API's
  same-origin check compared `localhost` against `localhost:5173`.
- The README gave the web interface as `http://127.0.0.1:5173`, which the Vite
  dev server refuses — it listens on the IPv6 loopback, while the Compose stack
  publishes the IPv4 one. Documented as `localhost`, which reaches both.

### Security

- `JWT_SECRET` is rejected in production when it is still a value published in
  this repository. The previous check only measured length, and the sample value
  in `api/.env.example` was long enough to pass it while being public knowledge.
  That sample is now empty.
- The Compose stack no longer publishes the API and preprocessor on host ports.
  Only the web interface is reachable from the host, so browser traffic cannot
  route around the proxy and reach the API's upload and authorization checks
  from an origin it does not expect.

### Removed

- `preprocessor/validation/`, an offline benchmarking harness reachable from no
  entry point: no route, no CLI, no CI step. Its `xlrd` dependency went with it.
- The tier badge on the account page, which rendered a chip for a column no
  feature reads. The column and its README explanation stay.
- Duplicated code: a hand-maintained copy of the wire types, a second copy of the
  review helpers, three copies of the same signal run-length scan, four copies of
  the SpO2 physiological clamp, and two definitions each of the apnea threshold,
  the quality floor, and the metric formatter.
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

[Unreleased]: https://github.com/alex-macra/somnoscribe/compare/v0.2.0-alpha.1...HEAD
[0.2.0-alpha.1]: https://github.com/alex-macra/somnoscribe/compare/v0.1.0-alpha.2...v0.2.0-alpha.1
[0.1.0-alpha.2]: https://github.com/alex-macra/somnoscribe/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/alex-macra/somnoscribe/releases/tag/v0.1.0-alpha.1
