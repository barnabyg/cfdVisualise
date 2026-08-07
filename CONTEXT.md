# Flow Visualisation

An interactive domain for helping curious learners build honest qualitative intuition about fluid flow through direct experimentation.

## Language

**Fluid-intuition sandbox**:
An interactive environment in which a learner changes a flow scenario and observes how the flow responds, prioritising qualitative understanding over engineering analysis.
_Avoid_: CFD teaching instrument, solver workbench, flow toy

**Learner**:
A STEM student who understands basic mechanics but is not expected to know computational fluid dynamics.
_Avoid_: CFD practitioner, general audience, user

**Qualitatively faithful**:
A result that may sacrifice engineering-grade precision while preserving the real causal relationships the learner is invited to infer.
_Avoid_: Visually plausible, numerically defensible

**Wake experiment**:
The sandbox's anchor scenario, in which flow passes an obstacle and the learner observes how changes to the flow or obstacle alter the downstream wake and vortex shedding.
_Avoid_: Offset-port experiment, general-purpose scene

**Guided experiment**:
A short, skippable introduction in which the learner predicts and observes one causal change before continuing in the same scenario with unrestricted controls.
_Avoid_: Tutorial, lesson mode, onboarding tour

**Flow controls**:
The physical quantities the learner directly changes: flow speed, kinematic viscosity, and obstacle diameter. Reynolds number is a derived explanation, not a direct numerical control.
_Avoid_: Solver controls, Reynolds-number control

**Wake view**:
The primary visual representation of the flow, combining signed vorticity colours with subtle animated tracers.
_Avoid_: Pressure view, arrow field, dye view

**Reference fluid**:
A familiar Newtonian fluid with kinematic viscosity stated at a particular temperature, used to give physical meaning to the viscosity control.
_Avoid_: Fluid analogy, lattice fluid

**Physical scenario**:
The combination of flow speed, cylinder diameter, and reference-fluid viscosity selected by the learner. These inputs establish a Reynolds number but do not promise engineering-grade forces or elapsed time.
_Avoid_: Solver configuration, lattice configuration

**Flow regime**:
The conservatively measured state of the evolving wake, classified as developing, steady, periodically shedding, or numerically unstable. Classification combines field residual and symmetry, lift periodicity and stability, and numerical-health signals; Reynolds number provides an expectation rather than determining the label, and ambiguous flow remains unclassified.
_Avoid_: Solver state, convergence state

**Cylinder**:
The single centred circular obstacle used by the initial wake experiment.
_Avoid_: Shape, geometry, generic obstacle

**Flow-through time**:
Nondimensional progress measured by how many cylinder diameters the incoming flow would travel, used instead of solver iterations or claimed real-world seconds.
_Avoid_: Simulation time, elapsed seconds, iteration count

**Restart experiment**:
An action that returns the selected physical scenario to its initial flow state. The learner can invoke it explicitly, and a cylinder-diameter change invokes it automatically; speed and viscosity changes preserve the existing flow.
_Avoid_: Reset solver, automatic reset

**Validated envelope**:
The set of physical scenarios for which the sandbox has evidence that its qualitative flow behaviour is trustworthy, initially targeting Reynolds numbers from 5 through 150. Scenarios outside it are unavailable rather than rendered with a warning after the fact.
_Avoid_: Stability limit, recommended range

**Reynolds number**:
The dimensionless ratio `U D / ν`, derived from flow speed, cylinder diameter, and kinematic viscosity to relate physical scenarios with similar idealised wake behaviour.
_Avoid_: Flow setting, direct control

**Reference-fluid guide**:
A logarithmic kinematic-viscosity scale with selectable, temperature-specific markers for dry air, water, and glycerol. A marker is hidden whenever the current speed and diameter would place it outside the validated envelope.
_Avoid_: Fluid dropdown, viscosity analogy

**Normalized vorticity**:
Signed rotation expressed as `ω D / U`, displayed on a fixed symmetric colour scale so intensity remains comparable across physical scenarios and flow-through times.
_Avoid_: Auto-scaled vorticity, raw vorticity

**Open flow**:
The cylinder scenario's physical environment: a uniform stream with lateral boundaries sufficiently remote that they are not interpreted as channel walls.
_Avoid_: Channel flow, wind tunnel, confined flow

**Prediction**:
The learner's unscored expectation about how the wake will respond to a proposed physical change, committed before that change is shown.
_Avoid_: Quiz answer, hypothesis score

**Learning readouts**:
Reynolds number, flow-through time, and measured flow regime, with Strouhal number added only when stable periodic shedding has been observed.
_Avoid_: Status bar, solver telemetry, performance statistics

**Baseline**:
A normalized-vorticity still and its learning readouts captured immediately before the guided speed change, used for the experiment's single before-and-after comparison.
_Avoid_: Saved simulation, comparison run, screenshot

**Full-domain view**:
The learner's view of the entire simulated open-flow extent, including the upstream, downstream, and lateral clearance around the cylinder.
_Avoid_: Cropped wake view, hidden computational domain

**Reference case**:
A published flow scenario used to decide whether behaviour belongs in the validated envelope. The initial suite covers Reynolds numbers 5, 20, 40, cases bracketing shedding onset, 100, and 150 together with grid-, domain-, boundary-, and backend-sensitivity checks.
_Avoid_: Visual check, smoke test, demo scenario

**Validation manifest**:
A versioned, generated record of the solver identity, shipped quality-tier configurations, reference metrics, convergence results, tolerances, and scientific sources displayed by Method and validation.
_Avoid_: Validation report, test output, accuracy badge

**Valid control interval**:
The range currently available for a flow control after accounting for the other physical inputs and the validated envelope. Its changing bounds and their cause are visible to the learner.
_Avoid_: Clamped value, hidden constraint, invalid scenario

**Saved scenario**:
A browser-local, versioned record of physical inputs and display choices that restarts from its initial flow state when opened; it does not contain the evolved flow field, and older records are migrated when the format changes.
_Avoid_: Saved simulation, shared scenario, account data

**Initial flow**:
The uniform incoming flow from which every experiment visibly develops, including the guided experiment and reopened saved scenarios.
_Avoid_: Rest state, developed checkpoint, hidden warm-up

**Quality tier**:
A validated combination of spatial resolution and advancement pace selected by a short local capability benchmark without changing the physical scenario or expected flow regime. Changing tier is explicit and restarts the experiment.
_Avoid_: Physics mode, compatibility mode, unvalidated fallback

**Playback rate**:
The target number of flow-through-time units advanced per real second, where `1×` means one such unit per second; achieved rate may fall below the target when hardware or background-tab throttling cannot keep up.
_Avoid_: Simulation speed, steps per frame, physical time

**Step**:
An action that advances the paused experiment by a small fixed increment of flow-through time consistently across quality tiers.
_Avoid_: Solver step, frame advance, lattice timestep

**Equivalent scenarios**:
Physical scenarios with the same Reynolds number and idealised geometry, which therefore share the same dimensionless wake within the sandbox's model.
_Avoid_: Identical experiments, identical fluids

**Adapting**:
The interval after an in-place speed or viscosity change while Reynolds number ramps over a short validated flow-through interval and the existing flow develops toward the selected dimensionless scenario. Its transient path is not presented as a quantitatively faithful real-world acceleration or viscosity-change event.
_Avoid_: Developing, transitioning, converging

**Model scope**:
The sandbox's persistent scientific boundary: a qualitative two-dimensional open-flow model within the validated Reynolds-number envelope.
_Avoid_: Disclaimer, accuracy warning, solver limit

**Reynolds explanation**:
The live equation `Re = U D / ν` with the current values substituted, accompanied by a plain-language account of inertia versus viscosity and equivalent scenarios.
_Avoid_: Formula tooltip, regime lookup, Reynolds lesson

**Vorticity legend**:
The persistent signed key for the blue–orange vorticity palette, using clockwise and counterclockwise symbols so direction is not encoded by hue alone.
_Avoid_: Colour key, heat-map legend

**Method and validation**:
The in-product account of model scope, boundary assumptions, active quality tier, reference-case evidence, and source links.
_Avoid_: About page, disclaimer, technical documentation

**Scenario library**:
The browser-local collection in which learners name, reopen, rename, and permanently delete saved scenarios without an undo or recycle bin. Records that cannot be validated or migrated are discarded while valid records load; every previously released, recognisable schema version still requires an explicit migration.
_Avoid_: Experiment history, account library, cloud storage

**Scenario draft**:
The learner's current physical inputs and display choices, which never overwrite a saved scenario until the learner explicitly uses Save or Save as.
_Avoid_: Autosave, working simulation, current file

**Baseline regime**:
The measured steady wake at Reynolds number 20 that must be observed before the guided experiment asks the learner to predict the effect of faster flow.
_Avoid_: Timed baseline, precomputed baseline

**Default scenario**:
Water at 20°C flowing past a one-centimetre cylinder, initially at approximately `0.002 m/s` and Reynolds number 20; the guided change raises speed to approximately `0.010 m/s` and Reynolds number 100.
_Avoid_: Demo configuration, solver default, air scenario

**Guide completion**:
The point after periodic shedding has been measured and the guide has explained the observed speed-driven transition; no additional exercise is required before entering the sandbox.
_Avoid_: Lesson completion, equivalence challenge, unlock

**Returning learner**:
A learner whose local browser records completion or dismissal of the guided experiment; they enter the sandbox directly and can explicitly run the guide again.
_Avoid_: Returning user, registered learner

**Physical-control panel**:
The compact group of aligned logarithmic sliders and editable values for the three flow controls, including each control's visible valid interval and its cause.
_Avoid_: Parameter panel, solver settings, control drawer

**Physical scale**:
The sandbox's tabletop-to-small-lab input bounds: cylinder diameter from `1 mm` through `0.5 m`, flow speed from `0.001 m/s` through `2 m/s`, and kinematic viscosity from about `0.5×10⁻⁶ m²/s` through `2×10⁻³ m²/s`, further constrained by the validated envelope.
_Avoid_: Lattice scale, unrestricted physical range

**Adaptive SI value**:
A physical quantity formatted with a readable SI prefix while retaining its base-unit value in the Reynolds explanation.
_Avoid_: Imperial value, fixed-unit value

**Playback state**:
Whether numerical advancement is running or paused, independent of the measured flow regime.
_Avoid_: Flow regime, solver state

**Domain coordinates**:
The full-domain axes expressed in cylinder diameters as `x/D` and `y/D`, used to compare spatial flow structure across equivalent scenarios.
_Avoid_: Grid coordinates, physical coordinates, lattice coordinates

**Instrument view**:
The canvas-dominant desktop composition that shows the full domain beside the physical-control panel and learning readouts, with playback controls below the flow.
_Avoid_: Dashboard, immersive canvas, engineering workstation

**Accessible interpretation**:
Keyboard-operable controls, non-colour-only visual encoding, textual learning readouts, and motion controls that make the experiment's decisions and conclusions accessible without claiming a complete nonvisual equivalent of the evolving field.
_Avoid_: Accessible simulation, screen-reader flow field

**Reduced-motion session**:
An experiment opened while the learner's system requests reduced motion; it begins paused with tracers disabled until the learner explicitly enables either.
_Avoid_: Static mode, accessibility mode

**Tracer**:
A passive, massless marker continuously seeded across the upstream flow, advected by the computed velocity with a short fading tail and finite lifetime, and never coupled back into the flow.
_Avoid_: Dye, particle, streamline

**Unavailable result**:
A scenario whose numerical diagnostics or execution device failed, shown as the last valid frame with an explanation and explicit restart choices rather than as continued physical behaviour.
_Avoid_: Unstable flow, degraded result, automatic recovery
