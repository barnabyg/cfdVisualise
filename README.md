# Flow Visualisation

Flow Visualisation is a browser-based fluid-intuition sandbox for exploring the
two-dimensional wake behind a circular cylinder. It uses a Reynolds-similar
D2Q9 TRT lattice Boltzmann model and presents only the validated Reynolds-number
envelope `Re = 5–150`.

The application is qualitative rather than an engineering analysis tool. Its
purpose, terminology, and scientific boundaries are defined in
[`prd-flow-visualiser.md`](./prd-flow-visualiser.md), [`CONTEXT.md`](./CONTEXT.md),
and the [architecture decisions](./docs/adr/).

## Current implementation

The current application includes:

- CPU-worker and WebGPU quality tiers, both at 18 cells per cylinder diameter.
- A capability benchmark that selects a bundled, validated tier and an explicit
  tier selector that restarts the experiment.
- A guided experiment from a steady `Re = 20` wake to periodic shedding at
  `Re = 100`, including prediction and baseline comparison.
- Coupled logarithmic controls for speed, cylinder diameter, and kinematic
  viscosity, constrained to the validated envelope.
- Play, pause, fixed `0.05 D/U` step, restart, playback-rate, and passive-tracer
  controls.
- Worker-owned full-domain normalized-vorticity rendering, regime and Strouhal
  readouts, unavailable-result handling, and reduced-motion startup.
- Generated validation manifests and an in-product Method and validation panel.

The following PRD features are not implemented yet: reference-fluid markers,
the saved-scenario library and its migration schema, and automated axe/manual
assistive-technology evidence. Local storage currently records only guide
completion and the selected quality tier.

## Run locally

Use a Node.js version accepted by the locked Vite toolchain (`^20.19` or
`>=22.12`) and install from the lockfile:

```sh
npm ci
npm run dev
```

Vite prints the local development URL. To exercise the production artifact:

```sh
npm run build
npm run preview
```

Routine browser smoke tests require installed Chrome. Explicit compatibility
and release testing also require the Playwright browser binaries; install them
once with `npx playwright install chromium firefox webkit` if they are not
already available.

## Verification

| Command | Purpose |
| --- | --- |
| `npm test` | Fast Vitest unit, component, numerical, schema, and evidence-contract tests. |
| `npm run typecheck` | Strict TypeScript checking without emitting files. |
| `npm run test:browser:smoke` | Production-preview smoke coverage in the primary installed Chrome browser. |
| `npm run test:browser:compat` | Explicit compatibility coverage in Chromium, Firefox, WebKit, and installed Chrome. |
| `npm run verify` | Required routine check: typecheck, Vitest, evidence freshness, production build, and primary-browser smoke tests. |
| `npm run verify:engine` | Routine checks plus the real CPU guide in the primary browser. |
| `npm run verify:compat` | Explicit cross-browser compatibility matrix plus the installed-Firefox WebGPU guide. |
| `npm run validate:quality-tiers` | Regenerate the CPU/WebGPU manifests and evidence lock. |
| `npm run verify:release` | Regenerate and reject evidence drift, run core checks and the compatibility matrix, and enforce CPU browser-matrix and Firefox WebGPU guide gates. |

`npm run validate:quality-tiers` intentionally performs the long scientific
evidence generation that is excluded from the normal merge path.

Cross-browser compatibility is intentionally excluded from routine development
and merge verification. Run `npm run verify:compat` only when compatibility
coverage is explicitly requested or when preparing a release; release
verification retains the complete browser matrix.

Verification commands report ordinal progress in the terminal as well as the
dashboard. The orchestrator reports stage progress, Vitest reports completed
test files, Playwright reports individual tests, and scientific evidence
generation reports components and cases. Long-running validation cases also
report intermediate flow-through progress.

### Live verification dashboard

Every local `verify*` command starts a dashboard at `http://127.0.0.1:4176/`
and prints that URL as `TEST_DASHBOARD_URL`. The page shows the active
verification stage, individual Vitest and Playwright activity, recent output,
timings, and failures. The server binds only to `127.0.0.1`, shuts down when
verification completes, and is not started when `CI` is set. Set
`CFD_TEST_DASHBOARD=0` to opt out locally, or set `CFD_TEST_DASHBOARD_PORT` when
the default port is unavailable.
If another verification already owns the default port, a concurrent run
automatically chooses a free port and prints the resulting URL.

Codex agents are instructed in [`AGENTS.md`](./AGENTS.md) to open the URL when
full verification begins. The reusable integration and global-instruction
pattern are documented in
[`docs/agents/test-dashboard.md`](./docs/agents/test-dashboard.md).

## Architecture and evidence

The Preact UI communicates through a typed protocol with a dedicated worker.
The worker owns simulation state, diagnostics, tracers, and canvas rendering;
large numerical fields do not enter component state. CPU and WebGPU use the same
scenario definitions and validation observables. WebGPU fields remain GPU
resident during normal advancement and rendering.

The selected production domain is `6D` upstream, `14D` downstream, and `8D` to
each lateral boundary. Both shipped tiers use 18 cells per diameter. The CPU
default playback target is `1.3 D/U/s`; the WebGPU default is `2 D/U/s`.

The generated evidence consumed by the application is committed at:

- [`src/engine/cpu-production-manifest.json`](./src/engine/cpu-production-manifest.json)
- [`src/validation/webgpu-backend-manifest.json`](./src/validation/webgpu-backend-manifest.json)
- [`validation-evidence-lock.json`](./validation-evidence-lock.json)

Key source boundaries are `src/ui/`, `src/engine/`, and `src/validation/`.
Browser-boundary coverage lives in `tests/browser/`; the remaining tests are in
`tests/`.
