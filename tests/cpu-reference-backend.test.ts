import { describe, expect, it } from "vitest";

import {
  CPU_REFERENCE_BOUNDARY_PRECEDENCE,
  STEADY_RE20_VALIDATION_SUITE,
  createCpuReferenceBackend,
  type ValidationCaseDefinition,
  type ValidationSample,
} from "../src/validation/index.js";
import { createInlineCpuReferenceWorker } from "./fixtures/inline-cpu-reference-worker.js";

describe("CPU reference backend", () => {
  it("starts from uniform incoming flow and emits fixed-step finite diagnostics", async () => {
    const backend = createCpuReferenceBackend(createInlineCpuReferenceWorker);
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

  it("measures the final one-step field residual independently of diagnostic interval", async () => {
    const reference = STEADY_RE20_VALIDATION_SUITE.cases[0]!;
    const compact: ValidationCaseDefinition = {
      ...reference,
      configuration: {
        ...reference.configuration,
        domain: { upstreamDiameters: 2, downstreamDiameters: 3, lateralDiameters: 2 },
      },
      protocol: {
        warmUpFlowThroughTime: 0,
        sampleFlowThroughTime: 1,
        sampleInterval: 1,
      },
      expectations: [],
    };

    const once = await lastSample(compact);
    const twice = await lastSample({
      ...compact,
      protocol: { ...compact.protocol, sampleInterval: 0.5 },
    });

    expect(once.step).toBe(twice.step);
    expect(once.flowThroughTime).toBe(twice.flowThroughTime);
    expect(once.fieldResidual).toBeCloseTo(twice.fieldResidual, 14);
  });

  it("executes the declared inlet, lateral, and outlet alternatives", async () => {
    const reference = STEADY_RE20_VALIDATION_SUITE.cases[0]!;
    const alternatives = [
      { inlet: "equilibrium-velocity" as const },
      { lateral: "periodic" as const },
      { outlet: "convective" as const },
    ];

    for (const alternative of alternatives) {
      const definition: ValidationCaseDefinition = {
        ...reference,
        id: `boundary-alternative-${Object.values(alternative)[0]}`,
        configuration: {
          ...reference.configuration,
          boundaries: { ...reference.configuration.boundaries, ...alternative },
          domain: {
            upstreamDiameters: 2,
            downstreamDiameters: 3,
            lateralDiameters: 2,
          },
        },
        protocol: {
          warmUpFlowThroughTime: 0,
          sampleFlowThroughTime: 0.5,
          sampleInterval: 0.5,
        },
        expectations: [],
      };
      const samples: ValidationSample[] = [];

      for await (const sample of createCpuReferenceBackend(
        createInlineCpuReferenceWorker,
      ).runCase(definition)) {
        samples.push(sample);
      }

      expect(samples).toHaveLength(2);
      expect(
        [
          samples[1]!.density.minimum,
          samples[1]!.density.maximum,
          samples[1]!.density.mean,
          samples[1]!.upstreamReflection,
          samples[1]!.dragCoefficient,
        ].every(Number.isFinite),
      ).toBe(true);
    }
  });

  it("applies a declared Reynolds change without restarting the flow field", async () => {
    const reference = STEADY_RE20_VALIDATION_SUITE.cases[0]!;
    const base: ValidationCaseDefinition = {
      ...reference,
      id: "compact-reynolds-change",
      configuration: {
        ...reference.configuration,
        domain: {
          upstreamDiameters: 2,
          downstreamDiameters: 3,
          lateralDiameters: 2,
        },
      },
      protocol: {
        warmUpFlowThroughTime: 1,
        sampleFlowThroughTime: 0.5,
        sampleInterval: 0.5,
      },
      expectations: [],
    };

    const unchanged = await lastSample(base);
    const changed = await lastSample({
      ...base,
      protocol: {
        ...base.protocol,
        reynoldsChange: {
          initialReynoldsNumber: 5,
          atFlowThroughTime: 0.5,
          rampFlowThroughTime: 0.5,
          observationFlowThroughTime: 0.5,
        },
      },
    });

    expect(changed.step).toBe(unchanged.step);
    expect(changed.flowThroughTime).toBe(unchanged.flowThroughTime);
    expect(changed.dragCoefficient).not.toBeCloseTo(unchanged.dragCoefficient, 8);
    expect(changed.density.mean).not.toBeCloseTo(unchanged.density.mean, 12);
  });
});

async function lastSample(definition: ValidationCaseDefinition): Promise<ValidationSample> {
  let last: ValidationSample | undefined;
  const backend = createCpuReferenceBackend(createInlineCpuReferenceWorker);
  for await (const sample of backend.runCase(definition)) {
    last = sample;
  }
  if (last === undefined) {
    throw new Error("CPU reference backend emitted no samples.");
  }
  return last;
}
