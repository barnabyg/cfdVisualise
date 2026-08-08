import { describe, expect, it } from "vitest";

import {
  CPU_REFERENCE_BOUNDARY_PRECEDENCE,
  STEADY_RE20_VALIDATION_SUITE,
  createCpuReferenceBackend,
  type ValidationCaseDefinition,
  type ValidationSample,
} from "../src/validation/index.js";

describe("CPU reference backend", () => {
  it("starts from uniform incoming flow and emits fixed-step finite diagnostics", async () => {
    const backend = createCpuReferenceBackend();
    const reference = STEADY_RE20_VALIDATION_SUITE.cases[0]!;
    const definition: ValidationCaseDefinition = {
      ...reference,
      configuration: {
        ...reference.configuration,
        domain: { upstreamDiameters: 2, downstreamDiameters: 3, lateralDiameters: 2 },
      },
      protocol: {
        warmUpFlowThroughTime: 0,
        sampleFlowThroughTime: 0.5,
        sampleInterval: 0.5,
      },
      expectations: [],
    };
    const samples: ValidationSample[] = [];

    for await (const sample of backend.runCase(definition)) {
      samples.push(sample);
    }

    expect(backend.identity).toMatchObject({
      id: "cpu-reference",
      kind: "cpu-worker",
      solver: "D2Q9 TRT/BFL open-cylinder reference",
    });
    expect(CPU_REFERENCE_BOUNDARY_PRECEDENCE).toEqual([
      "free-slip-lateral",
      "regularized-velocity-inlet",
      "fixed-density-nee-outlet",
    ]);
    expect(samples).toHaveLength(2);
    expect(samples[0]).toMatchObject({
      step: 0,
      flowThroughTime: 0,
      density: {
        nonFiniteValueCount: 0,
        nonPositiveValueCount: 0,
      },
      fieldResidual: 0,
      symmetryError: 0,
      dragCoefficient: 0,
      liftCoefficient: 0,
    });
    expect(samples[0]!.density.minimum).toBeCloseTo(1, 14);
    expect(samples[0]!.density.maximum).toBeCloseTo(1, 14);
    expect(samples[0]!.density.mean).toBeCloseTo(1, 14);
    expect(samples[1]).toMatchObject({
      step: 75,
      flowThroughTime: 0.5,
      density: {
        nonFiniteValueCount: 0,
        nonPositiveValueCount: 0,
      },
    });
    expect(samples[1]!.density.minimum).toBeGreaterThan(0);
    expect(
      [
        samples[1]!.domainMass,
        samples[1]!.inletFlux,
        samples[1]!.outletFlux,
        samples[1]!.density.minimum,
        samples[1]!.density.maximum,
        samples[1]!.density.mean,
        samples[1]!.fieldResidual,
        samples[1]!.symmetryError,
        samples[1]!.dragCoefficient,
        samples[1]!.liftCoefficient,
      ].every(Number.isFinite),
    ).toBe(true);
  });
});
