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

## Live verification dashboard

- Local `npm run verify`, `npm run verify:engine`, `npm run verify:evidence`, and `npm run verify:release` commands stream progress to `http://127.0.0.1:4176/`, print that address as `TEST_DASHBOARD_URL`, and remain headless in CI. `CFD_TEST_DASHBOARD_PORT` may override the port when necessary.
- For implementation tickets, run the relevant verification command as a yielded/background-capable process. As soon as the process has launched, use the Codex panel's browser opener to open or focus the known dashboard URL without asking the user for another prompt, then continue waiting on the verification process. Opening the panel does not require taking browser-control ownership. When the default port is busy, a concurrent run chooses a free port; open the emitted `TEST_DASHBOARD_URL` instead.
- Open the dashboard for the full verification tier, not for every short focused test. If the Codex panel browser opener is unavailable, surface the clickable URL and continue verification in the terminal.
- The dashboard is observational. A dashboard or reporter failure must never replace, soften, or change the exit status of the underlying verification command.
