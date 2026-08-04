# Safety

## Intended use

Somnoscribe is experimental clinician-assist software for exploring an evidence-linked review workflow. It can organize supported sleep-study artifacts, surface candidate observations, and record a human review decision.

It is not intended to:

- diagnose, rule out, or screen for a condition without independent clinician review;
- recommend or select treatment;
- replace source-waveform, report, history, examination, or laboratory review;
- provide patient-facing advice;
- operate as an emergency, monitoring, or life-support system;
- establish medical-device, privacy, security, or regulatory compliance.

## Human review is mandatory

Model output can be incorrect, incomplete, internally inconsistent, overconfident, or built on a preprocessing error. Evidence links reduce risk; they do not establish correctness. A qualified reviewer must inspect the source artifacts, adjudicate every material claim and populated section, and apply the full clinical context before relying on any output.

Sign-off records workflow completion. It is not a certification of medical validity.

## Known limitations

- Candidate-window algorithms are heuristics, not authoritative scoring.
- EDF channel labels and quality vary across devices and exports.
- PDF extraction can miss, transpose, or misread values.
- Home recordings may not contain sleep staging or sufficient channels for a requested interpretation.
- A language model may invent relationships even when prompted to remain evidence-bound.
- Optional reference rules may be inaccurate, outdated, inapplicable, or improperly licensed.
- The public release has no bundled clinical reference pack and therefore disables deterministic reference checks by default.
- Local SQLite and filesystem storage lack controls expected of a regulated production platform.

## Reference-pack responsibility

Operators who set `REFERENCE_DIR` own the provenance, licensing, clinical review, versioning, applicability, and update process for every rule. A successful schema load means only that the files are structurally valid. It does not validate clinical accuracy.

The interface and `/api/references/status` expose whether rules loaded. Analysis emits an explicit warning when they did not.

## Data governance

Never use real patient artifacts in public issues, pull requests, fixtures, demos, or CI. That covers clinical PDFs and EDFs, databases, generated reports, private reference material, copied standards, institutional documents, and real identifiers. Evaluate with deterministic synthetic data unless an appropriately governed private environment, legal basis, consent process, and data-handling program are in place.

What a self-hoster owns, and the safeguards to configure before exposing a deployment, are in [SECURITY.md](SECURITY.md#deployment-responsibility).

## Test mode

Synthetic model mode exists only to exercise software plumbing. Its output is explicitly non-clinical and the API refuses to enable it outside the test environment. It must never be presented as model or clinical validation.

## Reporting a safety issue

Use a private GitHub security advisory for security or sensitive-data concerns. For non-sensitive safety defects, open an issue with a fully synthetic reproduction. Do not attach source studies, reports, screenshots, identifiers, or logs containing clinical content.
