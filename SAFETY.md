# Safety

Somnoscribe is experimental clinician-assist software for an evidence-linked review workflow. It is not a diagnostic system, treatment tool, medical device, patient-facing service, emergency system, or compliance claim.

## Required review

Every result is a draft. A qualified reviewer must inspect the source artifacts, adjudicate material findings and report sections, and apply the full clinical context before relying on an output. Sign-off records workflow completion; it does not certify medical validity or verify the reviewer’s identity.

Do not use Somnoscribe alone to diagnose, rule out, screen for a condition, select treatment, or replace waveform, report, history, examination, or laboratory review.

## Limits

- Candidate windows and quality metrics are heuristics, not authoritative scoring.
- Device exports, channel labels, PDFs, and screenshots can be incomplete or misread.
- Model output can be wrong, incomplete, inconsistent, or overconfident.
- A valid reference-pack schema does not establish a rule’s accuracy, currency, applicability, or license.
- Local SQLite and filesystem storage are not a regulated multi-tenant platform.

## Data

Never put patient artifacts, identifiers, reports, databases, reference material, copied standards, or institutional documents in issues, pull requests, fixtures, demos, or CI. Use deterministic synthetic data in this repository. Its boundary check blocks known unsafe paths and patterns; it cannot prove arbitrary content is non-clinical.

Uploads receive two limited transformations before downstream storage:

- EDF patient and recording fields are overwritten; signal data and start date remain.
- Screenshot images lose EXIF/XMP and a fixed 40-pixel top strip.

This is not content detection. It does not remove names elsewhere in an image, may miss scaled banners, and does not inspect PDFs for identifiers. Inspect every upload yourself. Screenshots are stored locally and, with a provider key configured, may be sent to that provider during analysis.

## Access and deployment

Somnoscribe has no accounts, roles, sessions, or per-user case separation. Anyone who reaches the API has the workspace. It is intended for one local operator and binds to `127.0.0.1` by default.

Do not expose it to a shared machine or network with clinical artifacts. `SOMNOSCRIBE_ACCESS_TOKEN` adds one shared bearer secret; it is not authentication or reviewer attribution. Deployments that need identities, isolation, or accountable audit records must provide them outside the application. See [Security](SECURITY.md).

## Models and references

Without `OPENAI_API_KEY`, the deterministic demo adapter produces deliberately non-clinical text. It tests software plumbing, not model or clinical validity. The interface and `GET /api/config` disclose this mode.

Reference packs stay outside the repository. Operators own their provenance, licensing, clinical review, versioning, and update process. When `REFERENCE_DIR` is absent, the interface and analysis explicitly report that deterministic reference validation is unavailable.

## Report a concern

Use a private GitHub security advisory for sensitive-data or security concerns. For other safety defects, open an issue with a fully synthetic reproduction. Never attach source studies, reports, screenshots, identifiers, or clinical logs.
