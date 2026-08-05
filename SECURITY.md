# Security

The current `0.2.x` alpha line receives security fixes. Pre-release interfaces may change.

## Report privately

Use GitHub private vulnerability reporting or a draft security advisory. Do not open a public issue for an unpatched vulnerability, leaked credential, or sensitive-data exposure.

Include the affected version or commit, impact, required access, a synthetic reproduction, and a mitigation if known. Never include patient artifacts, identifiers, tokens, logs, databases, or private references.

## Deploy deliberately

Somnoscribe defaults to loopback binding and no trusted proxy. It has no accounts, sessions, roles, or per-user isolation. `SOMNOSCRIBE_ACCESS_TOKEN` is a shared bearer guard, not authentication.

Before exposing a deployment:

- Keep loopback binding unless a deliberate network boundary exists.
- Put real authentication and TLS in front of any network-accessible instance.
- Set exact `CORS_ORIGINS`, `HOST`, `TRUST_PROXY`, and an access token where appropriate.
- Restrict permissions on the database, uploads, screenshots, temporary files, and reference packs.
- Keep clinical data and reference packs out of source control and logs.
- Own encryption, backups, retention/deletion, access review, monitoring, incident response, privacy obligations, and provider agreements.

See [Safety](SAFETY.md) for clinical and data-handling limits.
