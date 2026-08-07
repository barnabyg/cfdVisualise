---
status: accepted
---

# Use a Reynolds-similar TRT lattice Boltzmann solver

The production solver uses D2Q9 two-relaxation-time collision with linear interpolated bounce-back at the circular wall. Physical speed, cylinder diameter, and kinematic viscosity determine Reynolds number; validated hidden lattice quantities then represent the corresponding dimensionless wake at low Mach number. A background CPU implementation is the canonical fallback and test reference, while WebGPU accelerates the same numerical method where available.

## Considered options

BGK with staircase bounce-back was rejected because changing viscosity also changes relevant numerical and curved-wall errors. MRT was rejected as unnecessary initial complexity, and a projection Navier–Stokes solver was rejected because its global pressure solve is a poorer fit for the browser's real-time parallel workload. WebGPU-only and main-thread CPU execution were rejected because the former violates broad desktop-browser support and the latter competes with interaction and rendering.

## Consequences

Both CPU-worker and WebGPU quality tiers are required for the first release and are validated independently through physical observables rather than bitwise field equality. A Preact hook owns only the engine lifecycle and public façade: it transfers the canvas to the Worker, typed commands cross the boundary, and throttled summaries return to the UI. The Worker keeps numerical fields, GPU resources, rendering, and regime detection together; component state never owns them. Regime detection combines field residual and symmetry, lift periodicity and stability, and bounded-density and flux-balance checks, with thresholds calibrated per tier. In-place speed and viscosity changes ramp the target Reynolds number over a short validated flow-through interval while lattice velocity and the TRT boundary parameter remain fixed; the entire interval is labelled adapting until a developed regime is measured. Cylinder-diameter changes restart from uniform incoming flow. Shipped resolutions are chosen through grid convergence and browser benchmarks rather than fixed in advance; a tier that misses numerical tolerances or the 90-second guide target does not ship.
