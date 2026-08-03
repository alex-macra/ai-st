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

The source defaults to loopback binding and no trusted proxy. Self-hosters must provide TLS, network controls, secure secret storage, access review, encryption at rest, backup protection, retention and deletion controls, dependency updates, and monitoring appropriate to their environment.

Before internet exposure, configure a production-grade `JWT_SECRET`, exact `CORS_ORIGINS`, the real proxy trust setting, SMTP, restrictive filesystem permissions, and a reviewed external reference directory if used.
