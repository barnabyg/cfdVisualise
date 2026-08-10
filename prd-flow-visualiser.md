# PRD: Flow Visualisation Sandbox

> **Naming status:** "FlowVis" is a working title. Public naming is deferred.

> **Implementation status (10 August 2026):** Phases 0–2 and the release-evidence
> foundation are implemented. Phase 3 is partial. See [`README.md`](./README.md)
> for the current feature boundary. Requirements in this document remain the
> product contract and must not be read as claims that every feature or test is
> already present.

## 1. Product summary

The product is a browser-based fluid-intuition sandbox for STEM students who understand basic mechanics but are not expected to know computational fluid dynamics.

Its anchor experience is the wake behind a centred circular cylinder in two-dimensional open flow. A learner changes flow speed, kinematic viscosity, or cylinder diameter and observes how the wake changes. The product favours direct causal understanding and visual clarity while preserving qualitative scientific honesty.

It is not an engineering analysis package, a general-purpose geometry editor, or a numerical-method workbench.

The canonical vocabulary is defined in [`CONTEXT.md`](./CONTEXT.md). Architectural rationale is recorded in:

- [`ADR 0001: Model an open cylinder wake`](./docs/adr/0001-model-an-open-cylinder-wake.md)
- [`ADR 0002: Use a Reynolds-similar TRT lattice Boltzmann solver`](./docs/adr/0002-use-a-reynolds-similar-trt-lattice-boltzmann-solver.md)

## 2. Product promise

The learner should be able to:

1. Watch a wake develop from uniform incoming flow.
2. Predict how a physical change will affect that wake.
3. Observe the transition from a steady separated wake to periodic vortex shedding.
4. Relate flow speed, cylinder diameter, and kinematic viscosity through Reynolds number.
5. Distinguish a physical unsteady wake from a numerically unavailable result.

The model may sacrifice engineering-grade precision, but it must not knowingly teach the wrong causal relationship. Only scenarios backed by the validation contract may be presented as trustworthy.

## 3. Goals

### 3.1 Primary goals

- Build honest qualitative intuition for low-Reynolds-number circular-cylinder wakes.
- Make the onset of periodic vortex shedding visible and understandable.
- Connect familiar physical quantities to Reynolds similarity.
- Provide a responsive, visually inviting scientific instrument in current desktop browsers.

### 3.2 Secondary goals

- Let learners inspect the model, assumptions, reference evidence, and active quality tier.
- Let learners keep a small browser-local library of scenario recipes.
- Establish a validated CPU and GPU architecture that can support later experiments.

## 4. Non-goals

The first release does not include:

- Engineering-grade predictions, forces, dimensional pressure, or calibrated physical elapsed time.
- Three-dimensional flow or claims about real high-Reynolds-number turbulence.
- Arbitrary geometry, movable cylinders, alternate obstacle shapes, or obstacle drawing.
- Channel-flow teaching, offset inlet/outlet geometry, or adjustable confinement.
- Pressure, velocity-magnitude, arrow, streamline, probe, or dye visualisation modes.
- Numerical grid, timestep, relaxation-rate, Mach-number, or solver controls.
- Numerical field export, still-image export, video export, or shareable scenario URLs.
- Accounts, cloud storage, server-side simulation, analytics, crash reporting, cookies, or third-party runtime assets.
- Mobile-first layout or mobile performance commitments.
- Installable PWA behaviour or guaranteed offline use.

## 5. Scientific scope

### 5.1 Physical model

The model is two-dimensional, incompressible in intent, and qualitatively represents a uniform open stream passing a stationary circular cylinder.

The learner-facing physical scenario is defined by:

- Free-stream speed `U`.
- Cylinder diameter `D`.
- Kinematic viscosity `nu`.

The derived Reynolds number is:

```text
Re = U D / nu
```

The initial validated envelope targets `Re = 5-150`. The interface exposes only combinations inside this envelope.

Scenarios with the same Reynolds number and idealised geometry are treated as equivalent dimensionless scenarios. Physical inputs give Reynolds number concrete meaning; they do not make the simulation a dimensional prediction of force, pressure, or elapsed seconds.

### 5.2 Physical input bounds

Free exploration covers a tabletop-to-small-laboratory scale:

| Input | Absolute range | Presentation |
|---|---:|---|
| Cylinder diameter | `1 mm-0.5 m` | Logarithmic slider and editable value |
| Flow speed | `0.001-2 m/s` | Logarithmic slider and editable value |
| Kinematic viscosity | approximately `0.5e-6-2e-3 m2/s` | Logarithmic slider and editable value |

Each control is further restricted dynamically by the other two values so that the resulting Reynolds number remains inside the validated envelope. The current valid interval and the cause of a changing bound are visible.

Values use readable adaptive SI prefixes. The live Reynolds equation retains base SI units.

### 5.3 Reference-fluid guide

The viscosity scale includes temperature-specific reference markers for:

- Dry air at 15 degrees Celsius.
- Water at 20 degrees Celsius.
- Glycerol near 20 degrees Celsius, with a note that temperature and water content materially affect its viscosity.

A marker is hidden whenever selecting it would place the current speed and diameter outside the validated envelope. Selecting a reference changes viscosity only; it never silently changes speed or diameter.

### 5.4 Model disclosure

The instrument view persistently displays a compact scope line equivalent to:

```text
2D open-flow model | Re 5-150 | qualitative
```

A secondary **Method and validation** panel exposes:

- Model scope and Reynolds-similarity interpretation.
- Boundary assumptions.
- Active quality tier and backend.
- Reference cases, metrics, tolerances, and convergence evidence.
- Scientific source links.

## 6. Guided experiment

### 6.1 Entry

On first visit, a brief welcome panel presents the product promise and offers:

- **Start guided experiment**
- **Skip to sandbox**

Completion or dismissal is remembered locally. Returning learners enter the sandbox directly and retain a visible **Run guided experiment** action.

### 6.2 Default scenario

The guide uses:

- Water at 20 degrees Celsius.
- A `1 cm` cylinder.
- Initial speed approximately `0.002 m/s`.
- Initial Reynolds number approximately `20`.

Every run begins from uniform incoming flow. No developed checkpoint or hidden warm-up is used.

### 6.3 Learning sequence

1. The learner watches the symmetric wake form at approximately `Re = 20`.
2. The guide waits until the measured regime is steady; it does not use a fixed timer.
3. A baseline normalized-vorticity still and its learning readouts are captured.
4. The learner commits an unscored prediction about what faster flow will do.
5. Speed rises to approximately `0.010 m/s`, producing approximately `Re = 100`.
6. Reynolds number ramps over a short validated flow-through interval while the flow is labelled **Adapting**.
7. The learner watches periodic shedding emerge.
8. Once periodicity is measured, the guide explains the transition using the substituted Reynolds equation and compares the live result with the baseline card.
9. The guide ends and leaves the learner in the same scenario with unrestricted sandbox controls.

There is no required equivalence challenge or extended lesson sequence.

### 6.4 Timing requirement

The complete default guide must finish within 90 seconds at default playback rate on every shipped quality tier.

No tier may meet this target by skipping visible flow development, weakening validation, or changing solver resolution during the experiment.

## 7. Sandbox behaviour

### 7.1 Parameter changes

- Speed and viscosity changes preserve the existing flow.
- The target Reynolds number ramps over a short, validated flow-through interval.
- The flow is labelled **Adapting** until developed-state evidence is available.
- The adaptation path is a numerical bridge and is not described as a quantitatively faithful real-world acceleration or viscosity-change transient.
- Cylinder-diameter changes restart from uniform incoming flow because they create and remove solid cells.
- The learner may explicitly use **Restart experiment** at any time.

### 7.2 Playback

Playback state and flow regime are independent.

Playback controls are:

- Play.
- Pause.
- Step.
- Playback-rate selection.

`1x` targets one flow-through-time unit per real second. A flow-through-time unit is the time in which free-stream flow would travel one cylinder diameter. It is not a claim about physical elapsed seconds.

Step advances a small fixed increment of flow-through time consistently across quality tiers. The exact increment is selected through interaction testing rather than exposed as a numerical solver step.

When hardware cannot reach the selected playback rate, achieved rate is visibly lower. The application reduces tracer count and visual render frequency before sacrificing interaction responsiveness. Solver resolution never changes during a run.

The simulation continues on a best-effort basis while its browser tab is hidden. Browser throttling may reduce achieved playback rate. The application never synthesises catch-up steps from wall-clock time.

### 7.3 Flow regimes

Learner-facing regimes are:

- **Developing**
- **Adapting**
- **Steady**
- **Periodically shedding**
- **Unclassified**
- **Unavailable**

There is no automatic convergence stop. Periodic shedding is a successful developed result.

Regime classification uses multiple signals:

- Normalized field residual and centreline symmetry.
- Lift periodicity, stable frequency, and amplitude.
- Bounded density and inlet/outlet flux balance.

Reynolds number provides an expectation, not the measured label. Ambiguous flow remains unclassified rather than receiving a guessed regime.

### 7.4 Numerical and device failure

If numerical-health checks fail or a rendering/compute device is lost:

1. Pause on the last valid frame.
2. Label the result unavailable.
3. Explain that no physical conclusion should be drawn from the failed result.
4. Offer explicit restart on the same tier or a lower validated tier.

Cross-backend recovery restarts from uniform incoming flow. Corrupted numerical output is never rendered as valid physics.

## 8. Visual design

### 8.1 Instrument view

The desktop layout is canvas-dominant:

- Full-domain canvas as the primary surface.
- Compact physical-control panel beside it.
- Learning readouts adjacent to controls.
- Playback controls below the canvas.
- Method and validation as a secondary panel. The specified scenario library is
  not implemented yet.
- Guidance placed contextually without obscuring the wake.

The tone is a scientific instrument made inviting: restrained interface, precise typography, dark neutral field, vivid but accessible flow colour, and delight supplied primarily by motion.

### 8.2 Full-domain view

The canvas always shows the entire simulated domain, including upstream, downstream, and lateral clearance. It does not crop to the near wake.

Axes use dimensionless cylinder coordinates `x/D` and `y/D`. The selected physical diameter remains visible in the control panel.

### 8.3 Wake view

The only scalar field in MVP is signed normalized vorticity:

```text
omega* = omega D / U
```

Requirements:

- Fixed symmetric range across frames and physical scenarios.
- Blue-orange diverging palette on a charcoal field.
- Persistent signed legend.
- Clockwise/counterclockwise symbols so direction is not encoded by hue alone.
- No automatic per-frame colour stretching.

An inspection-only rescale is not included in MVP.

### 8.4 Tracers

Tracers are passive, massless markers that:

- Seed continuously across the upstream flow.
- Follow the computed velocity field.
- Have short fading tails and finite lifetimes.
- Never affect the fluid simulation.

They are not dye, streamlines, or decorative particles.

### 8.5 Learning readouts

Persistent readouts are:

- Reynolds number.
- Flow-through time.
- Measured flow regime.
- Strouhal number only after stable periodic shedding is measured.
- Playback state separately from flow regime.

The live Reynolds explanation displays the equation with current values substituted and explains inertia versus viscosity and equivalent scenarios in plain language.

Solver iterations, grid dimensions, frame rate, relaxation parameters, and diagnostic force histories are not learner-facing.

## 9. Accessibility

The MVP provides accessible control and interpretation without claiming a complete nonvisual representation of the evolving spatial field.

Requirements:

- Complete keyboard operation.
- Visible focus states.
- Semantic controls and text alternatives for control state and measured conclusions.
- Vorticity direction encoded by symbols as well as colour.
- Pause and Step available at all times while the result is valid.
- Automated accessibility checks supplemented by keyboard-only, contrast, and manual assistive-technology review.

When the operating system requests reduced motion:

- The experiment begins paused.
- Tracers begin disabled.
- The learner can explicitly enable playback and tracers.

## 10. Scenario library

### 10.1 Stored data

The browser-local library stores scenario recipes only:

- Stable scenario identifier.
- Learner-provided name.
- Physical inputs.
- Display choices.
- Recipe-schema version.

It does not store field arrays, evolved flow state, baseline images, videos, or accounts.

Opening a scenario restarts it from uniform incoming flow.

### 10.2 Save behaviour

- Saving is explicit.
- **Save** and **Save as** are distinct actions.
- Opening and editing a saved scenario creates a scenario draft.
- The saved record is not overwritten until the learner explicitly saves.
- Learners can name, reopen, rename, and delete saved scenarios.
- Deletion is immediate and permanent, with no confirmation, undo, or recycle bin; the control must be explicitly labelled **Delete permanently** and visually separated from ordinary actions.

### 10.3 Storage and compatibility

The library uses one versioned `localStorage` document.

- Reads are schema-validated.
- Recognised previously released schema versions have explicit migrations.
- Migration completes atomically before migrated data is used.
- Individual records that cannot be validated or migrated are discarded while valid records load.
- Storage remains local to the current browser profile and is not synchronised or backed up by the product.

Guide completion and the locally selected quality tier may be stored alongside, but must remain distinct from scenario recipes in the schema.

## 11. Numerical architecture

### 11.1 Solver

The production solver is:

- D2Q9 Lattice Boltzmann Method.
- Two-relaxation-time collision.
- A documented fixed TRT boundary parameter; both relaxation rates update when viscosity changes.
- Linear Bouzidi-Firdaouss-Lallemand interpolated bounce-back at the circular cylinder.
- Link-wise momentum exchange for internal drag and lift diagnostics.
- Fixed-step advancement in low-Mach lattice conditions.

Physical inputs reduce to Reynolds number. Each quality tier chooses hidden stable lattice velocity, cylinder resolution, viscosity, and timestep mapping that preserve the selected dimensionless scenario.

### 11.2 Open boundaries

The production boundary set is:

- Regularized uniform-velocity inlet.
- Free-slip lateral truncation.
- Fixed-density non-equilibrium-extrapolation outlet.
- Explicit, tested corner precedence.

Domain extents are not fixed by convention. They are selected through domain and boundary sensitivity studies.

### 11.3 Execution tiers

Both tiers are required for MVP:

1. A background CPU-worker tier that is the canonical fallback and semantic reference.
2. A WebGPU tier implementing the same numerical method for higher throughput and resolution where supported.

Exact shipped resolutions and domain extents are evidence-driven release outputs, not learner controls.

A short local capability benchmark selects the fastest validated tier likely to meet the guide target. The selected tier and backend are visible. Manual tier changes are explicit and restart the experiment.

WebGPU availability is capability-detected. API presence alone does not select a tier.

### 11.4 Worker and UI boundary

- A Preact hook owns the engine lifecycle and public facade.
- The hook creates the Worker, transfers the canvas, holds the Worker handle in a ref, sends typed commands, receives throttled summaries, and performs cleanup.
- The Worker owns numerical arrays, backend resources, regime detection, tracer state, and canvas rendering.
- CPU and WebGPU implementations expose the same typed protocol.
- Field arrays, GPU handles, and per-step state never enter Preact component state.
- GPU-resident fields remain on the GPU during normal rendering; routine full-field readback is prohibited.

## 12. Application architecture

### 12.1 Stack

- Preact.
- Vite.
- Strict TypeScript.
- CSS Modules plus plain global CSS tokens and reset styles.
- Worker-owned `OffscreenCanvas`.
- Vitest for unit and numerical tests.
- Testing Library for component interaction.
- Playwright for production-build browser workflows.
- Automated accessibility checks plus manual accessibility review (planned;
  axe is not currently installed).

Tailwind is not part of the stack.

### 12.2 Implemented module boundaries

The implementation follows this dependency direction:

```text
Preact UI
  -> engine facade hook
    -> typed worker protocol
      -> simulation orchestrator
        -> CPU TRT/BFL backend
        -> WebGPU TRT/BFL backend
        -> regime diagnostics
        -> tracer and field renderer

validation harness
  -> shared physical scenarios and metric definitions
  -> CPU reference
  -> CPU production backend
  -> WebGPU backend
  -> generated validation manifest
```

The domain model and physical-scenario validation do not depend on Preact
components. The planned persistence schema must preserve that direction when it
is implemented.

## 13. Validation

### 13.1 Reference suite

Every shipped quality tier and backend is evaluated at:

- `Re = 5`.
- `Re = 20`.
- `Re = 40`.
- At least one case below and one above shedding onset, initially around `Re = 45` and `Re = 50`.
- `Re = 100`.
- `Re = 150`.

The suite includes grid, cylinder-placement, domain, boundary-formulation, and backend sensitivity.

### 13.2 Observables

Depending on regime, validation uses:

- Centreline symmetry.
- Separation and recirculation length measured with a declared convention.
- Mean drag coefficient.
- Lift mean, amplitude, or RMS.
- Periodicity and Strouhal number when shedding exists.
- Mean and bounded density.
- Time-averaged inlet/outlet mass-flux mismatch.
- Upstream reflection probes after startup and Reynolds changes.
- Finite-value and numerical-health checks.

Total lattice mass is not required to remain constant in the open system. Poiseuille channel flow may be retained as a solver regression test but is not evidence for the product's open-cylinder claim.

### 13.3 Convergence gates

When grid or domain is enlarged, boundary alternatives are compared, or CPU and WebGPU tiers are compared:

- Regime classification must remain the same.
- Mean drag and any applicable Strouhal number may change by no more than approximately 1%.
- Recirculation length may change by no more than approximately 2%.
- Reference metrics must remain within defensible published spread.

Threshold calibration is recorded per tier. A tier that cannot satisfy the gates is not shipped; tolerances are not loosened after seeing poor results.

### 13.4 Validation manifest

Passing evidence is generated into a versioned validation manifest containing:

- Solver and build identity.
- Backend and quality-tier configuration.
- Domain and cylinder resolution.
- Boundary configuration.
- Reference case definitions.
- Measured metrics and tolerances.
- Convergence and sensitivity results.
- Scientific source links.

The Method and validation panel consumes this manifest directly.

## 14. Performance and browser support

### 14.1 Support matrix

The target support matrix is current stable desktop:

- Chrome and Edge.
- Firefox.
- Safari.

The CPU tier must work across the matrix. WebGPU remains capability-detected.
The required merge smoke suite currently runs bundled Chromium, Firefox,
WebKit, and installed Chrome. An Edge Playwright project exists, while the
release guide gate currently measures CPU in Chromium, Firefox, and WebKit and
WebGPU in installed Firefox.

### 14.2 Performance requirements

- The default guide completes within 90 seconds on every shipped tier.
- Control input, playback commands, and guidance remain responsive while
  solving. The same requirement applies to library operations once that feature
  is implemented.
- Rendering targets smooth interaction, nominally 60 frames per second where hardware permits.
- Tracer count and render frequency degrade before solver fidelity.
- Solver resolution never changes mid-run.
- Achieved playback rate is reported honestly when below target.

The capability benchmark, tier resolutions, and pace limits are established through measured browser performance rather than the provisional PRD's fixed grid presets or steps-per-frame assumptions.

## 15. Privacy, distribution, and networking

- The build output is a provider-neutral static artifact.
- Hosting is selected separately from product implementation.
- There is no application backend.
- The running application makes no network requests beyond its static host.
- Fonts and runtime assets are bundled locally.
- Scientific links are opened only through deliberate learner navigation.
- There is no telemetry, crash reporting, cookie use, or uploaded experiment data.
- There is no service worker or guaranteed offline operation in MVP.

## 16. Verification strategy

### 16.1 Current static and unit verification

- `tsc --noEmit` is required because the build tool does not provide type checking.
- Solver mathematics and invariants are tested in Vitest.
- Protocol messages and validation manifests/contracts are schema-validated.
- A persistence document does not exist yet because the scenario library is not
  implemented.
- CPU reference cases are deterministic under fixed command sequences.
- GPU comparisons use tolerances and physical observables, not hashes or bitwise field equality.

### 16.2 Current component verification

Testing Library covers:

- Coupled valid control intervals.
- Reynolds equation updates.
- Guide decisions and transitions.
- Playback availability, tier changes, unavailable-result recovery, reduced
  motion, semantic controls, and accessible names.

Save/Save as, permanent deletion, and migration coverage remain pending with the
scenario library.

### 16.3 Browser-boundary verification

Playwright runs against production previews and currently covers:

- The real CPU guide, including uniform-flow startup, baseline detection, and
  completion, in Chromium, Firefox, and WebKit release runs.
- CPU-worker rendering, canvas resize, stale-event rejection, cleanup,
  reduced-motion startup, basic keyboard activation, and exact-tier evidence
  across the merge smoke matrix.
- WebGPU fixed-step execution, boundary alternatives, passive tracers, exact-tier
  evidence, capability rejection, unavailable states, and device-loss recovery
  in installed Chrome.

Full scenario-library migration coverage, a dedicated keyboard-only critical
workflow, returning-learner and hidden-tab browser workflows, axe integration,
contrast review, and manual assistive-technology evidence remain release work.

## 17. Delivery sequence

### Phase 0: Reference and validation foundation

**Status: implemented.**

- Implement scenario definitions, observables, and reference harness.
- Implement the CPU TRT/BFL numerical reference.
- Establish open boundaries, domain-sensitivity workflow, and initial reference ranges.
- Prove the default water scenario and the `Re = 5-150` validation plan are feasible.

### Phase 1: CPU vertical slice

**Status: implemented.**

- Implement typed Worker protocol and CPU production tier.
- Render normalized vorticity and passive tracers on the Worker-owned canvas.
- Deliver the complete default guide with measured regimes and baseline comparison.
- Meet numerical gates and the 90-second guide target on the selected CPU tier.

### Phase 2: WebGPU tier

**Status: implemented.**

- Implement the same TRT/BFL method and diagnostics in WebGPU.
- Keep fields and rendering GPU-resident.
- Validate physical observables against the CPU reference.
- Implement capability benchmarking, tier selection, and device-loss recovery.

### Phase 3: Complete learner experience

**Status: partial.** The physical controls, readouts, Method and validation,
welcome/returning flow, reduced-motion behaviour, and instrument visual system
are present. Reference-fluid markers, the scenario library, and the remaining
accessibility evidence are pending.

- Complete physical controls, reference-fluid guide, readouts, and Method and validation.
- Complete welcome, returning-learner, accessibility, and reduced-motion behaviour.
- Complete versioned local scenario library and migration tests.
- Apply the final instrument visual system.

### Phase 4: Release verification

**Status: infrastructure implemented; final gate not yet satisfied.** Generated
CPU/WebGPU evidence, freshness checks, and guide performance reporting are in
place. The incomplete Phase 3 workflows and their release coverage remain.

- Generate the release validation manifest.
- Pass all reference, convergence, browser, critical-workflow, migration, and accessibility gates.
- Confirm both CPU and WebGPU tiers meet the guide-duration requirement.
- Produce the provider-neutral static artifact.

## 18. Release gates

The MVP is releasable only when:

1. Both CPU-worker and WebGPU tiers pass their validation manifests.
2. The advertised `Re = 5-150` envelope is supported at endpoints and around shedding onset.
3. The default guide completes within 90 seconds on both shipped tiers.
4. Current stable Chrome/Edge, Firefox, and Safari pass their applicable learner-facing workflows.
5. No critical workflow depends on untracked, ignored, generated-but-unpublished, or server-side state.
6. Previously released scenario schemas migrate successfully.
7. The Method and validation panel reports the exact evidence for the running build.

## 19. Risks and responses

| Risk | Response |
|---|---|
| Open-domain size makes the CPU tier too slow | Optimise, select another validated tier, or narrow the envelope through a new explicit product decision; do not weaken validation silently. |
| TRT/BFL is unstable at part of the envelope | Sweep the full parameter and boundary set; improve the wall closure or move to MRT only with evidence and an ADR update. |
| Outlet reflections distort shedding or adaptation | Compare outlet formulations and downstream extents; monitor upstream density probes and integral metrics. |
| Full-domain view makes the cylinder visually small | Preserve the full-domain decision; improve contrast, tracer density, axes, and layout rather than cropping away the scientific extent. |
| CPU and WebGPU results differ | Compare regimes and physical observables with documented tolerances; never require bitwise equality. |
| Hidden-tab throttling slows advancement | Report computed flow-through time only and never catch up from wall-clock time. |
| Local storage is cleared or contains invalid records | Explain that storage is browser-local; migrate recognised versions and discard only records that fail validation or migration. |
| Colour or motion excludes learners | Use redundant direction symbols, keyboard controls, textual conclusions, and reduced-motion startup. |

## 20. Evidence-driven implementation outputs

Phase 0 and browser benchmarking resolved these shipped values:

- Production domain: `6D` upstream, `14D` downstream, and `8D` to each lateral
  boundary.
- CPU and WebGPU tiers: `18` cells per cylinder diameter.
- TRT magic parameter: `3/16`; relaxation rates are derived from Reynolds
  number, lattice speed, and diameter.
- Guided Reynolds ramp: `4 D/U`.
- Step increment: `0.05 D/U`.
- Fixed normalized-vorticity limits: `-2` through `2`.
- CPU default playback target: `1.3 D/U/s`; WebGPU default: `2 D/U/s`.
- Minimum capability benchmark rate: `1.2 D/U/s`; maximum guide duration:
  `90 s`.

Regime windows and thresholds, reference metric ranges, boundary details, and
the complete sensitivity evidence are versioned in the generated validation
manifests rather than duplicated here. CPU tracer density and render frequency
adapt to load; both renderers target 270 tracers at full density.
