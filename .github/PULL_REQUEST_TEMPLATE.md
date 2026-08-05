# Summary

<!-- The user-visible outcome, and the safety implications if any. -->

## Sign-off

- [ ] Every commit is signed off (`git commit -s`) under the [DCO](../DCO), and I
      agree the maintainer may license this contribution under both the AGPL and
      the separate commercial terms. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Data policy

- [ ] No patient data, real identifiers, clinical PDFs or EDFs, databases,
      generated reports, private reference material, copied standards, or
      institutional documents are added by this change.
- [ ] No symlinks or machine-specific absolute paths are added.

## Checks

- [ ] `npm run check:boundary`
- [ ] `npm run lint` and `ruff check preprocessor`
- [ ] `npm --prefix api run typecheck && npm --prefix api test`
- [ ] `npm --prefix frontend run typecheck && npm --prefix frontend test`
- [ ] `pytest -q preprocessor/tests`
- [ ] `npm run test:e2e`

## Review

- [ ] Tests cover the changed behaviour and its failure paths.
- [ ] API and SSE contracts stay backward compatible, or the break is described
      above and was discussed first.
- [ ] Public documentation is updated if configuration or boundaries changed.
- [ ] Interactive changes preserve keyboard operation, focus visibility,
      semantic roles, theme behaviour, and readable error feedback.
- [ ] No unrelated formatting or generated output is included.
