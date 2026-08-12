# Live test dashboard integration

The verification dashboard is a presentation layer over the repository's real
quality gates. `scripts/run-verification.mjs` owns the ordered profiles and
preserves their exit codes. It starts a localhost-only server for interactive
local runs, while CI receives the same terminal output without a server.

Vitest and Playwright use no-op-safe custom reporters. They send test lifecycle
events only when `CFD_TEST_DASHBOARD_EVENTS_URL` is present, so focused tests and
direct runner use continue to work when no dashboard exists. Stage output is
captured by the verification orchestrator and mirrored unchanged to the
terminal.

## Applying the pattern to another repository

1. Copy `scripts/test-dashboard/` and adapt the branding in its HTML and CSS.
2. Define that repository's ordered verification profiles in an orchestrator
   like `scripts/run-verification.mjs`.
3. Register the Vitest and/or Playwright reporters without removing the normal
   terminal reporter.
4. Route the repository's canonical `verify` commands through the orchestrator.
5. Give the dashboard a documented stable localhost URL, then add the agent
   instruction below to the repository `AGENTS.md`.
6. Verify both an interactive run and a run with `CI=1` before relying on it.

The build process can start and populate a page, but repository code does not
control the Codex application chrome. The agent instruction is what makes the
in-app browser display the page at the appropriate time.

When several agents verify concurrently, the first run uses the documented
stable port. Later runs fall back to OS-assigned ports and must be opened from
their emitted `TEST_DASHBOARD_URL`. This prevents the dashboard itself from
becoming another shared-port failure mode.

## Portable global `AGENTS.md` policy

This policy is suitable for a global file once each participating repository
provides a verification command that prints `TEST_DASHBOARD_URL`:

```md
## Live verification dashboards

- When an implementation task reaches its full local verification step, run the
  repository's canonical verification command as a yielded/background-capable
  process.
- If the repository documents a stable dashboard URL, immediately use the Codex
  panel's browser opener to open or focus it after launching verification,
  without waiting for command output or asking for another user prompt. Merely
  displaying the panel does not require taking browser-control ownership.
  Otherwise, open the exact
  `TEST_DASHBOARD_URL` emitted by the command as soon as it is observable, then
  continue waiting on the original verification process.
- Do not open a dashboard for every short focused test or in CI. If browser
  control is unavailable, surface the clickable URL and continue in the
  terminal.
- Treat dashboards as observational: their failure must not alter the result of
  the underlying verification command.
```

The global policy alone cannot add instrumentation to a repository. Projects
that do not print `TEST_DASHBOARD_URL` continue using their normal verification
output.
