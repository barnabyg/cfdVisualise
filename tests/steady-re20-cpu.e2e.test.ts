import { describe, expect, it } from "vitest";

import {
  STEADY_RE20_VALIDATION_SUITE,
  createCpuReferenceBackend,
  parseValidationManifest,
  runValidation,
} from "../src/validation/index.js";
import { createInlineCpuReferenceWorker } from "./fixtures/inline-cpu-reference-worker.js";

describe("steady Reynolds 20 CPU reference validation", () => {
  it(
    "emits a passing, inspectable steady manifest from the real CPU backend",
    async () => {
      const manifest = await runValidation(
        STEADY_RE20_VALIDATION_SUITE,
        createCpuReferenceBackend(createInlineCpuReferenceWorker),
      );

      expect(parseValidationManifest(manifest)).toEqual(manifest);
      expect(manifest).toMatchObject({
        status: "pass",
        backend: { id: "cpu-reference", kind: "cpu-worker" },
        cases: [
          {
            caseId: "open-cylinder-re020",
            availability: "available",
            status: "pass",
            regime: "steady",
            achieved: {
              steps: 9600,
              flowThroughTime: 64,
              warmUpFlowThroughTime: 60,
              sampleFlowThroughTime: 4,
            },
            metrics: {
              meanDragCoefficient: { applicability: "applicable", status: "pass" },
              recirculationLength: { applicability: "applicable", status: "pass" },
              fluxResidual: { applicability: "applicable", status: "pass" },
              fieldResidual: { applicability: "applicable", status: "pass" },
              symmetryError: { applicability: "applicable", status: "pass" },
              strouhalNumber: {
                applicability: "inapplicable",
                status: "not-assessed",
              },
            },
            failures: [],
          },
        ],
      });
      expect(
        Object.values(manifest.cases[0]!.metrics)
          .filter(({ applicability }) => applicability === "applicable")
          .every(({ status }) => status === "pass"),
      ).toBe(true);
    },
    60_000,
  );

  it("emits an unavailable manifest when the CPU field violates numerical health", async () => {
    const reference = STEADY_RE20_VALIDATION_SUITE.cases[0]!;
    const manifest = await runValidation(
      {
        ...STEADY_RE20_VALIDATION_SUITE,
        id: "steady-re20-unavailable-test",
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
