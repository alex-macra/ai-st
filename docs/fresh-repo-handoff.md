# Fresh-repo handoff

This tree is prepared to be cloned into a new repository whose first commit is
already AGPL-3.0. Nothing here has been executed; it is the checklist for when
that happens.

## Why a fresh repository

`v0.1.0-alpha.1` was published under Apache-2.0. Those rights are irrevocable
for that snapshot: anyone can check out that tag and fork it permissively,
forever. Relicensing binds what comes after it, not what was already released.

A new repository whose history begins under AGPL-3.0 leaves nothing permissive
reachable. It also drops the `codex/` head-ref names still visible on the closed
pull requests of the current repository.

## Sequence

1. Create the new repository, private at first.
2. Copy the working tree in, without `.git`. Confirm `npm run check:boundary`
   passes before the first commit, since it is the only gate that runs against
   untracked files.
3. Commit once. Sign it off (`git commit -s`) — the DCO applies to the
   maintainer too, and the first commit is what sets the example.
4. Tag a release only after CI is green.

## Re-enable per-repository settings

None of these carry over from a copied tree:

- Private vulnerability reporting.
- Secret scanning and push protection.
- Dependabot (`.github/dependabot.yml` comes with the tree, but the feature must
  be switched on).
- Repository topics: `sleep-medicine`, `edf`, `polysomnography`, `self-hosted`,
  `clinical-decision-support`, `typescript`, `fastapi`, `llm`.
- Repository description.
- Branch protection is unavailable on the free plan. The local merge guard has to
  be reinstalled per clone; it is machine-local, not part of the repository.

## Update the hard-coded URLs

These name `alex-macra/somnoscribe` and only need touching if the new repository
has a different owner or name:

- `README.md` — the CI badge.
- `CITATION.cff` — `repository-code`.
- `CHANGELOG.md` — the compare and release links at the foot.

The commercial-enquiry and issue-template links are repository-relative, so they
follow a copied tree automatically. The commercial contact remains a GitHub route
rather than a mailbox because the boundary check rejects non-example addresses.

## What to do with the old repository

Archive rather than delete. Deleting frees the name for anyone, and the existing
URL redirects are the only thing pointing anyone who already has the old clone at
the new home. Archiving also leaves the Apache-2.0 release visible, which is
honest: it was published, and pretending otherwise helps nobody.
