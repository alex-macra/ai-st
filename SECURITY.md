# Security policy

## Supported versions

The current `0.2.x` alpha line receives security fixes. Earlier lines, including `0.1.x`, do not. Pre-release builds are for evaluation and may change without notice.

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

**Somnoscribe does not authenticate anyone.** It has no accounts, sessions, or roles: whoever reaches the port has every case and every control. That is a single-operator local design, and exposing it to a network without your own authentication layer in front means publishing the clinical artifacts it holds. `SOMNOSCRIBE_ACCESS_TOKEN` adds a single shared bearer secret, which is a speed bump, not an identity system.

Before exposing a deployment:

- Keep the loopback binding unless a deliberate network boundary is configured.
- Put a real authenticating reverse proxy in front, or accept that every reachable client is an administrator. Set `SOMNOSCRIBE_ACCESS_TOKEN` at minimum, and terminate TLS.
- Configure exact `CORS_ORIGINS` and the real reverse-proxy hop count.
- Keep reference packs and clinical artifacts outside source control.
- Restrict filesystem permissions on the database, temporary uploads, and screenshots.
- Review logs and monitoring exports for sensitive-data leakage.
- Test restore and deletion procedures before handling governed data.
