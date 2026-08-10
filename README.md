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

Browser tests require the Playwright browser binaries. Install them once with
`npx playwright install` if they are not already available.

## Verification

| Command | Purpose |
| --- | --- |
| `npm test` | Fast Vitest unit, component, numerical, schema, and evidence-contract tests. |
| `npm run typecheck` | Strict TypeScript checking without emitting files. |
| `npm run test:browser:smoke` | Production-preview smoke coverage in bundled Chromium, Firefox, WebKit, and installed Chrome. |
| `npm run verify` | Required merge check: typecheck, Vitest, evidence freshness, production build, and browser smoke tests. |
| `npm run verify:engine` | Merge checks plus the real CPU guide and installed-Firefox WebGPU guide. |
| `npm run validate:quality-tiers` | Regenerate the CPU/WebGPU manifests and evidence lock. |
| `npm run verify:release` | Regenerate and reject evidence drift, run merge checks, and enforce CPU browser-matrix and Firefox WebGPU guide gates. |

`npm run validate:quality-tiers` intentionally performs the long scientific
evidence generation that is excluded from the normal merge path.

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
