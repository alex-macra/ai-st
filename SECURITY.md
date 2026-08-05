# Security policy

## Supported versions

The current `0.1.x` alpha line receives security fixes. Pre-release builds are for evaluation and may change without notice.

## Report privately

Use GitHub's private vulnerability reporting or a draft security advisory in this repository. Do not open a public issue for an unpatched vulnerability, leaked credential, or sensitive-data exposure.

Include:

- the affected version or commit;
- impact and required attacker access;
- a minimal synthetic reproduction;
- suggested mitigation, if known.

Never include patient artifacts, real identifiers, access tokens, production logs, database copies, or private reference content. Replace them with synthetic placeholders.

The maintainers will acknowledge a complete report when practical, investigate, coordinate a fix and disclosure, and credit reporters who request attribution. This alpha project does not promise a fixed response deadline or bug bounty.

## Deployment responsibility

The source defaults to loopback binding and no trusted proxy. Self-hosters own everything above that line: TLS, network controls, secure secret storage, access review and least privilege, encryption at rest, backup protection, retention and deletion controls, incident response, dependency updates, monitoring, regional privacy requirements, vendor agreements, and model-provider data controls.

Before exposing a deployment:

- Keep the loopback binding unless a deliberate network boundary is configured.
- Set a production-grade `JWT_SECRET` and terminate TLS. The API rejects a secret that is short or is an example value published in this repository.
- Configure exact `CORS_ORIGINS` and the real reverse-proxy hop count.
- Keep reference packs and clinical artifacts outside source control.
- Restrict filesystem permissions on the database, temporary uploads, and screenshots.
- Review logs and monitoring exports for sensitive-data leakage.
- Test restore and deletion procedures before handling governed data.
