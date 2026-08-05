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

### What de-identification does and does not do

Two automatic steps run on every upload, before anything is stored:

- **EDF headers.** The patient and recording identification fields are overwritten. The start date is preserved, because readers parse it. Signal data is untouched.
- **Screenshots.** A fixed 40-pixel strip is cropped off the top of every image, which is where DOMINO prints its patient banner. Re-encoding also drops EXIF and XMP. If an image cannot be cropped the upload is rejected rather than stored.

**Neither step inspects content, and the screenshot crop is a fixed height tuned to DOMINO's default window.** It will not remove a name printed inside a chart, in a footer, in a differently sized window, or anywhere but that top strip; on a scaled or high-DPI capture, 40 pixels may not cover the banner at all. Nothing in this tool reads a PDF for identifiers.

Check what you are uploading. The screenshots you attach are stored on disk and sent to the model provider at analysis time when one is configured.

## No authentication

**Somnoscribe has no accounts and does not authenticate anyone.** There is no sign-up, no sign-in, no roles, and no per-user separation of cases. It is a single-operator workspace: whoever can reach the port has every case, every artifact, and every control, including delete and sign-off.

That is a deliberate design choice for a locally run review tool, and it is safe only under the assumption the tool is run locally. The API binds `127.0.0.1` by default. **Do not bind it to a wider address, publish its port, or place it on a shared machine or network** with clinical artifacts in it. If you must, `SOMNOSCRIBE_ACCESS_TOKEN` requires a shared bearer token on every `/api` request — that is a single shared secret, not an identity system. It cannot tell two people apart, it cannot be revoked per person, and it is not a substitute for authentication in any environment where that matters.

Sign-off records a reviewer name that the reviewer types in. **It is an attestation, not a verified identity.** Nothing confirms the name is real or that the person who typed it is who they say. Treat the audit trail as a record of what was decided, not proof of who decided it. Any deployment needing genuine reviewer attribution must supply it at a layer above this application.

## Demo and test modes

The offline model adapter exists only to exercise software plumbing. Its output is fixed text that states its own nature, and it must never be presented as model or clinical validation.

There is no switch to set. An install with no `OPENAI_API_KEY` runs the offline model, and one with a key calls the provider — that is the whole configuration. Wherever the offline model is in use the interface carries a banner on every screen and `GET /api/config` reports `llmMode: "demo"`, so a reader can always tell where a report's words came from. `SOMNOSCRIBE_SYNTHETIC_LLM` is the test suite's narrower switch and the API refuses it outside the test environment.

The consequence worth stating plainly: a deployment with no key configured produces reports that look complete and mean nothing. Do not present one as a working system.

The generated demo study is a waveform drawn from a fixed seed. It is not a recording of a person, contains no identifiers, and the indices derived from it describe the generator, not a patient.

## Reporting a safety issue

Use a private GitHub security advisory for security or sensitive-data concerns. For non-sensitive safety defects, open an issue with a fully synthetic reproduction. Do not attach source studies, reports, screenshots, identifiers, or logs containing clinical content.
