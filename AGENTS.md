## Agent skills

### Issue tracker

Issues are tracked in the GitHub repository `barnabyg/cfdVisualise`. See `docs/agents/issue-tracker.md`.

### Triage labels

The repository uses the five default triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses the single-context domain-document layout. See `docs/agents/domain.md`.

## Verification tiers

- `npm run verify` is the required merge check. It runs type checking, fast regression tests, the validation-evidence freshness guard, a production build, and cross-browser smoke coverage.
- Do not add full scientific evidence generation or a real-time guide to the default `npm test` or `npm run verify` paths.
- Run `npm run verify:engine` when engine advancement, Worker lifecycle, regime detection, guide progression, capability benchmarking, or WebGPU execution changes.
- Run `npm run validate:quality-tiers` when `npm run check:evidence` reports stale validation inputs or manifests. Review and commit the generated manifests and `validation-evidence-lock.json` together.
- Run `npm run verify:release` before a release. It regenerates exact CPU/WebGPU evidence, rejects uncommitted evidence drift, runs the fast merge checks, exercises the real CPU guide across the browser matrix, and exercises the installed-Firefox WebGPU guide.
- The generated CPU/WebGPU manifests own the long Reynolds-envelope, grid, placement, domain, and boundary cohorts. Keep fast synthetic failure-path coverage in Vitest instead of duplicating those successful cohorts there.
