import { describe, expect, it } from "vitest";

import {
  PERIODIC_RE100_VALIDATION_SUITE,
  createCpuReferenceBackend,
  parseValidationManifest,
  runValidation,
} from "../src/validation/index.js";
import { createInlineCpuReferenceWorker } from "./fixtures/inline-cpu-reference-worker.js";

describe("periodic Reynolds 100 CPU reference validation", () => {
  it(
    "emits a passing developed-periodic manifest from the real CPU backend",
    async () => {
      const manifest = await runValidation(
        PERIODIC_RE100_VALIDATION_SUITE,
        createCpuReferenceBackend(createInlineCpuReferenceWorker),
      );

      expect(parseValidationManifest(manifest)).toEqual(manifest);
      expect(manifest).toMatchObject({
        status: "pass",
        backend: { id: "cpu-reference", kind: "cpu-worker" },
        cases: [
          {
            caseId: "open-cylinder-re100",
            availability: "available",
            status: "pass",
            regime: "periodically-shedding",
            achieved: {
              flowThroughTime: 96,
              warmUpFlowThroughTime: 64,
              sampleFlowThroughTime: 32,
            },
            metrics: {
              meanDragCoefficient: { applicability: "applicable", status: "pass" },
              liftRms: { applicability: "applicable", status: "pass" },
              periodicCycleCount: { applicability: "applicable", status: "pass" },
              dominantFrequency: { applicability: "applicable", status: "pass" },
              frequencyVariation: { applicability: "applicable", status: "pass" },
              amplitudeVariation: { applicability: "applicable", status: "pass" },
              frequencyUncertainty: { applicability: "applicable", status: "pass" },
              strouhalNumber: { applicability: "applicable", status: "pass" },
              fluxResidual: { applicability: "applicable", status: "pass" },
            },
            failures: [],
          },
        ],
      });
      expect(manifest.cases[0]!.metrics.strouhalNumber!.measured).toBeGreaterThan(0);
      expect(manifest.cases[0]!.metrics.liftRms!.measured).toBeGreaterThan(0);
    },
    180_000,
  );

  it("emits an unavailable result when periodic numerical-health evidence is invalid", async () => {
    const reference = PERIODIC_RE100_VALIDATION_SUITE.cases[0]!;
    const manifest = await runValidation(
      {
        ...PERIODIC_RE100_VALIDATION_SUITE,
        id: "periodic-re100-unavailable-test",
        cases: [
          {
            ...reference,
            health: {
              ...reference.health,
              densityRange: { minimum: 1.01, maximum: 1.02 },
            },
          },
        ],
      },
      createCpuReferenceBackend(createInlineCpuReferenceWorker),
    );

    expect(manifest).toMatchObject({
      status: "fail",
      cases: [
        {
          status: "fail",
          availability: "unavailable",
          achieved: { steps: 0, flowThroughTime: 0 },
          failures: [expect.stringContaining("density")],
        },
      ],
    });
    expect(manifest.cases[0]).not.toHaveProperty("regime");
  });
});
