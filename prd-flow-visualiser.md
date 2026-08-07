# PRD: FlowVis — 2D CFD Flow Visualiser

## 1. Overview

FlowVis is an interactive web application for visualising 2D incompressible fluid dynamics using Computational Fluid Dynamics (CFD). It's a toy/exploratory tool — the goal is visual satisfaction and intuition-building, not engineering accuracy.

The user watches flow develop in real-time from rest as the solver iterates, seeing velocity vectors and pressure fields evolve until steady-state (or interesting transient behaviour) emerges. There will be a check for a converged solution and when this check passes the simulation ends with a "converged" message.

## 2. Goals

- **Primary:** Provide a visually engaging, real-time 2D CFD simulation that runs in the browser.
- **Secondary:** Let the user tweak physical, timestep and geometric parameters and immediately see the effect on flow behaviour.
- **Tertiary:** Serve as a foundation for future extensions (obstacles, compressible flow, turbulence models).

## 3. Non-Goals

- Physical accuracy suitable for engineering analysis.
- 3D simulation.
- Export of quantitative data (e.g. CSV of velocity fields). Could be added later but not MVP.
- Mobile-first design (desktop browser is the target; should not actively break on mobile but no layout optimisation).

## 4. Technical Approach

### 4.1 Solver: Lattice Boltzmann Method (LBM)

LBM is chosen over direct Navier-Stokes solvers for the following reasons:

- **Naturally transient** — each timestep advances the physical simulation, so the user sees flow develop from rest without needing to distinguish "outer iterations" from "inner iterations."
- **Simple to implement** — the core algorithm is ~100 lines: stream, collide, apply boundary conditions. No pressure-Poisson equation, no staggered grids.
- **Parallelisable** — each lattice site updates independently. If performance becomes an issue, the collision/streaming kernels map directly to WebGL fragment shaders.
- **Visually satisfying quickly** — flow features (vortices, recirculation zones, boundary layers) emerge within hundreds of iterations, not thousands.

**Lattice:** D2Q9 (2 dimensions, 9 velocity directions). This is the standard choice for 2D incompressible flow.

**Collision operator:** BGK (Bhatnagar-Gross-Krook) single-relaxation-time. The relaxation parameter τ (tau) maps to kinematic viscosity via:

```
ν = (τ - 0.5) / 3
```

The user-facing "viscosity" slider controls τ. Lower viscosity (τ closer to 0.5) produces more interesting flow patterns (vortex shedding, instabilities) but the simulation becomes less stable. The UI should warn or clamp if τ < 0.51.

### 4.2 Grid

- **Default resolution:** 200 × 100 (width × height). Aspect ratio 2:1 to give the flow room to develop.
- **Adjustable:** User can select from presets (e.g. 100×50, 200×100, 400×200) or enter custom values up to 400×200.
- **Changing grid resolution resets the simulation.**

### 4.3 Boundary Conditions

- **Walls (top, bottom):** No-slip (bounce-back). Standard LBM bounce-back is trivial to implement.
- **Inflow:** Fixed velocity (Zou-He boundary condition). Parabolic velocity profile across the inlet for physical plausibility, though a uniform profile is acceptable for MVP.
- **Outflow:** Zero-gradient (extrapolation). Convective outflow is more physical but extrapolation is simpler and sufficient for a toy.
- **Inflow/outflow positions:** On opposite walls (left/right), offset vertically. The offset and the size of each opening are user-configurable parameters.

### 4.4 Performance Target

- **60 FPS rendering** with solver running continuously in the background.
- At 200×100, pure JS LBM should comfortably achieve several hundred iterations per second. The rendering loop decouples from the solver — run N solver steps per animation frame, where N is configurable (a "simulation speed" control).
- If grids above 200×100 cause frame drops in JS, consider:
  - WebGL compute (fragment shader LBM)
  - Web Workers for the solver loop
  - Both are stretch goals, not MVP.

## 5. User Interface

### 5.1 Layout

```
┌─────────────────────────────────────────────────────┐
│  Toolbar / Controls                                 │
├───────────────────────────────────┬─────────────────┤
│                                   │                 │
│                                   │   Parameter     │
│       Simulation Canvas           │   Panel         │
│       (main visualisation)        │                 │
│                                   │                 │
│                                   │                 │
├───────────────────────────────────┴─────────────────┤
│  Status Bar (iteration count, Re, FPS, state)       │
└─────────────────────────────────────────────────────┘
```

### 5.2 Simulation Canvas

The main display area renders the flow field on an HTML5 Canvas element.

**Visualisation layers (toggleable):**

| Layer | Description | Default |
|---|---|---|
| **Velocity lines** | Vector lines at each grid point (or subsampled for readability). Line length and direction encode velocity magnitude and direction. | ON |
| **Pressure field** | Colour map (e.g. blue → white → red diverging palette) overlaid on the background. Pressure is derived from density in LBM: p = ρ/3. | ON |
| **Streamlines** | Computed from the velocity field. Useful for seeing overall flow structure. More expensive to compute — updated every M frames rather than every frame. | OFF |
| **Velocity magnitude** | Colour map encoding |u| instead of pressure. Alternative to pressure view. | OFF |

**Arrow subsampling:** At 200×100, drawing 20,000 arrows is cluttered. Subsample to every Nth grid point (e.g. N=4, giving ~1,250 arrows). N should auto-adjust based on grid resolution or be user-configurable.

**Colour palette:** Provide 2-3 palette options. MVP: a single perceptually uniform diverging palette (e.g. coolwarm or a blue-red via viridis-adjacent).

### 5.3 Parameter Panel

Grouped into Physical, Geometry, and Display sections.

**Physical Parameters:**

| Parameter | Range | Default | Notes |
|---|---|---|---|
| Viscosity (ν) | 0.001 – 0.2 (lattice units) | 0.02 | Maps to τ = 3ν + 0.5. UI shows both ν and the implied Reynolds number. |
| Inflow velocity | 0.01 – 0.15 (lattice units) | 0.05 | Max ~0.15 to maintain stability (Mach < 0.1 for incompressible assumption). |

**Geometry Parameters:**

| Parameter | Range | Default | Notes |
|---|---|---|---|
| Inflow wall | Left / Right | Left | Which wall has the inlet. Outflow is always opposite. |
| Inflow Y-position | 0% – 100% of wall height | 25% | Centre of the inflow opening, as percentage from bottom. |
| Outflow Y-position | 0% – 100% of wall height | 75% | Centre of the outflow opening. |
| Inflow size | 5% – 50% of wall height | 15% | Height of the inflow opening. |
| Outflow size | 5% – 50% of wall height | 15% | Height of the outflow opening. |

**Display Parameters:**

| Parameter | Range | Default | Notes |
|---|---|---|---|
| Arrow subsample | 2 – 10 | 4 | Show arrow every Nth grid point. |
| Arrow scale | 0.5 – 5.0 | 1.0 | Multiplier on arrow length for visibility. |
| Colour field | Pressure / Velocity magnitude / None | Pressure | Which scalar field to render as colour. |
| Colour range | Auto / Manual | Auto | Auto scales to current min/max each frame. Manual lets user lock range. |
| Steps per frame | 1 – 50 | 10 | Solver iterations per animation frame. Low = watch slow evolution. High = reach steady state fast. |

### 5.4 Toolbar

| Control | Action |
|---|---|
| **Play / Pause** | Start or pause the solver. Rendering freezes on current state when paused. |
| **Step** | Advance exactly 1 solver iteration (only active when paused). |
| **Reset** | Clear the flow field to rest (zero velocity, uniform density). Geometry and parameters preserved. |
| **Grid resolution** | Dropdown or input for grid size. Triggers reset on change. |

### 5.5 Status Bar

Displays in real-time:
- **Iteration count** — total solver steps since last reset.
- **Reynolds number** — computed from current inflow velocity, inlet size, and viscosity: Re = U × L / ν.
- **Rendering FPS** — frames per second of the display loop.
- **Solver state** — "Running", "Paused", "Converged" (if velocity change between frames drops below threshold).

## 6. Interaction

### 6.1 MVP Interactions

- **Hover tooltip:** Hovering over the canvas shows the local velocity (magnitude + direction) and pressure at that grid point.
- **Parameter changes while running:** Physical and geometry parameter changes take effect immediately without resetting. Geometry changes (inlet/outlet position/size) require rebuilding boundary masks but not clearing the flow field — the solver adapts from the current state, which is visually interesting.

### 6.2 Stretch Interactions

- **Click-drag to inject dye** — a passive tracer field advected by the velocity. Pure visual, no effect on flow.
- **Click to place/remove rectangular or circular obstacles.** Obstacles use bounce-back BCs same as walls.
- **Drag inlet/outlet position directly on the canvas** rather than using sliders.

## 7. Architecture

### 7.1 Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | React + Vite | Consistent with existing project tooling. |
| Rendering | HTML5 Canvas 2D API | Sufficient for MVP. WebGL is available for upgrade. |
| Solver | Pure TypeScript | Type safety, runs in main thread or Web Worker. |
| State management | React state + useRef for solver | Solver state is mutable (Float64Arrays), not suitable for React state. |
| Styling | Tailwind CSS | Quick layout, consistent with existing projects. |

### 7.2 Module Structure

```
src/
├── solver/
│   ├── lbm.ts            # Core LBM: stream, collide, macroscopic quantities
│   ├── boundaries.ts      # Boundary condition implementations
│   └── types.ts           # Grid, simulation config types
├── renderer/
│   ├── canvas.ts          # Canvas drawing: arrows, colour fields
│   ├── colormaps.ts       # Colour palette functions
│   └── streamlines.ts     # Streamline computation (stretch)
├── components/
│   ├── App.tsx            # Main layout
│   ├── SimCanvas.tsx      # Canvas wrapper with mouse interaction
│   ├── ParameterPanel.tsx # Sliders and controls
│   ├── Toolbar.tsx        # Play/pause/reset/grid controls
│   └── StatusBar.tsx      # Iteration, Re, FPS display
├── hooks/
│   ├── useSimulation.ts   # Orchestrates solver + render loop
│   └── useAnimationFrame.ts
└── utils/
    └── math.ts            # Vector operations, interpolation
```

### 7.3 Data Structures

The LBM solver operates on flat typed arrays for performance:

```typescript
interface LBMState {
  nx: number;                    // Grid width
  ny: number;                    // Grid height
  f: Float64Array;               // Distribution functions: 9 × nx × ny
  fTemp: Float64Array;           // Streaming buffer (double-buffered)
  rho: Float64Array;             // Density (nx × ny)
  ux: Float64Array;              // X-velocity (nx × ny)
  uy: Float64Array;              // Y-velocity (nx × ny)
  boundary: Uint8Array;          // Boundary type per cell (wall/fluid/inlet/outlet)
}
```

### 7.4 Render Loop

```
requestAnimationFrame →
  for i in 0..stepsPerFrame:
    solver.collide()
    solver.stream()
    solver.applyBoundaryConditions()
    solver.computeMacroscopic()
  renderer.drawColourField(rho or |u|)
  renderer.drawArrows(ux, uy, subsample)
  updateStatusBar(iteration, Re, fps)
```

### 7.5 Testing Strategy
After every change consider running some or all of the following tests:
Mass conservation — sum all ρ across the grid at each step. It should be constant to within floating-point tolerance (~1e-10). If mass is drifting, BCs are leaking.
No-slip check — after convergence, velocity at wall cells should be zero (or within 1e-6). If not, bounce-back is broken.
Poiseuille profile match — the parabolic comparison above. This is the real physics test. L2 error < 2%.
Symmetry test — set up a symmetric geometry (inlet and outlet at the same Y-position, same size). The resulting flow field should be symmetric about the centreline. Compute the asymmetry as a scalar and assert it's < 1e-6. This catches off-by-one indexing errors in the grid, which are extremely common.
Stability/divergence check — run at the parameter extremes (low τ, high inflow velocity) for 1000 steps and assert no NaN or Inf appears anywhere in the arrays. This doesn't validate physics but catches the "simulation explodes" failure mode.

## 8. Milestones

### M1: Core Solver (Est. 1-2 sessions)
- LBM D2Q9 BGK solver with bounce-back walls.
- Fixed inlet/outlet, no UI.
- Console output of bulk velocity to verify correctness.
- Unit test: Poiseuille flow (parabolic profile in a straight channel with known analytical solution).

### M2: Basic Visualisation (Est. 1-2 sessions)
- Canvas rendering of velocity arrows and pressure colour map.
- Hardcoded parameters.
- Play/pause.
- Verify visually: flow develops from rest, recirculation forms due to offset.

### M3: Interactive Controls (Est. 1-2 sessions)
- Full parameter panel with sliders.
- Geometry controls for inlet/outlet position and size.
- Real-time parameter changes.
- Status bar.

### M4: Polish (Est. 1 session)
- Hover tooltips.
- Colour palette options.
- Arrow scaling and subsample controls.
- Grid resolution selector.
- Performance profiling and tuning.

### M5: Stretch Features (Ongoing)
- Obstacle placement (circles, rectangles).
- Dye/tracer injection.
- Streamline visualisation.
- WebGL solver for larger grids.
- Canvas drag for inlet/outlet repositioning.

## 9. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| LBM instability at low viscosity / high Re | Simulation "explodes" (NaN/Inf values) | Clamp τ > 0.505. Auto-detect divergence and pause with warning. Offer MRT (multi-relaxation-time) as upgrade path if BGK is too restrictive. |
| Canvas performance at high grid resolution | Frame drops below 30 FPS | Decouple solver from renderer. Reduce stepsPerFrame. Fall back to WebGL or Web Worker. |
| Arrow clutter at high resolution | Unreadable visualisation | Subsample aggressively. Consider replacing arrows with LIC (Line Integral Convolution) texture as a stretch goal. |
| Inlet/outlet BC implementation complexity | Zou-He BCs are fiddly to get right | Start with simpler equilibrium-based BCs. Validate against Poiseuille flow. Upgrade to Zou-He if needed. |

## 10. Open Questions

1. **Colour palette preference?** Coolwarm (diverging, good for pressure) vs. Viridis (sequential, better for velocity magnitude) vs. offer both?
2. **Should "viscosity" be the user-facing parameter, or Reynolds number?** Re is more physically intuitive but depends on inlet size and velocity, so it's a derived quantity. Could show both but let the user control viscosity directly.
3. **Streamlines: worth the complexity for MVP?** They're the most visually informative layer but non-trivial to compute efficiently. Recommendation: defer to M5.
4. **Presets?** Offer named configurations (e.g. "Laminar flow", "Vortex street", "High Re chaos") that set parameters to known-interesting combinations? Low effort, high fun value.
