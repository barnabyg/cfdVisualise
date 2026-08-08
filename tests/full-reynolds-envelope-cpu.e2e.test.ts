import { describe, expect, it } from "vitest";

import {
  FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE,
  createCpuReferenceBackend,
  parseValidationManifest,
  runValidation,
  serializeValidationManifest,
} from "../src/validation/index.js";
import { createInlineCpuReferenceWorker } from "./fixtures/inline-cpu-reference-worker.js";

describe("full Reynolds envelope CPU reference validation", () => {
  it(
    "emits deterministic reviewable evidence for both endpoints and shedding onset",
    async () => {
      const manifest = await runValidation(
        FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE,
        createCpuReferenceBackend(createInlineCpuReferenceWorker),
      );

      expect(parseValidationManifest(manifest)).toEqual(manifest);
      expect(JSON.parse(serializeValidationManifest(manifest))).toEqual(manifest);
      expect(
        manifest.cases
          .filter(({ status }) => status === "fail")
          .map(({ caseId, regime, failures }) => ({ caseId, regime, failures })),
      ).toEqual([]);
      expect(manifest.status).toBe("pass");
      expect(
        manifest.cases.map(({ reynoldsNumber, regime }) => [reynoldsNumber, regime]),
      ).toEqual([
        [5, "steady"],
        [20, "steady"],
        [40, "steady"],
        [45, expect.stringMatching(/^(steady|unclassified)$/)],
        [50, expect.stringMatching(/^(periodically-shedding|unclassified)$/)],
        [100, "periodically-shedding"],
        [150, "periodically-shedding"],
      ]);

      for (const result of manifest.cases) {
        expect(result.availability).toBe("available");
        expect(
          Object.values(result.metrics)
            .filter(({ applicability }) => applicability === "applicable")
            .every(({ status }) => status === "pass"),
        ).toBe(true);
      }
      expect(manifest.cases[0]?.metrics.recirculationLength).toBeUndefined();
      expect(manifest.cases[1]?.metrics.recirculationLength).toMatchObject({
        applicability: "applicable",
        status: "pass",
      });
      expect(manifest.cases[2]?.metrics.recirculationLength).toMatchObject({
        applicability: "applicable",
        status: "pass",
      });
      expect(manifest.cases[5]?.metrics.strouhalNumber).toMatchObject({
        applicability: "applicable",
        status: "pass",
      });
      expect(manifest.cases[6]?.metrics.strouhalNumber).toMatchObject({
        applicability: "applicable",
        status: "pass",
      });
    },
    900_000,
  );
});
