---
status: accepted
---

# Model an open cylinder wake

The sandbox models a circular cylinder in a uniform open flow rather than inside a no-slip channel, because its learning landmarks and reference cases concern the canonical unconfined wake. The learner sees the full computational domain. The production boundary set is a regularized uniform-velocity inlet, free-slip lateral truncation, and fixed-density non-equilibrium-extrapolation outlet; upstream, downstream, and lateral extents are selected through sensitivity tests rather than convention alone.

## Consequences

The domain is substantially larger than the visually interesting wake, raising computational cost and making the cylinder relatively small in the full-domain view. Confined benchmarks may test solver regressions but cannot validate the product's physical claim, and no-slip top and bottom boundaries must not be substituted for remote open-flow boundaries. Reference cases at Reynolds numbers 5, 20, 40, on both sides of shedding onset, 100, and 150 determine whether each quality tier belongs in the validated envelope. Enlarging the grid or domain and changing backend must preserve regime classification, change drag and any applicable shedding Strouhal number by no more than about one percent, and change recirculation length by no more than about two percent; results must also remain within defensible published ranges. Passing evidence is generated as a versioned validation manifest consumed by the product rather than copied into prose.
