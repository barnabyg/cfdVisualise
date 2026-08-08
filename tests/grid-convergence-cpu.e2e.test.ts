import { describe, expect, it } from "vitest";

import {
  GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE,
  createCpuReferenceBackend,
  parseValidationManifest,
  runValidation,
  serializeValidationManifest,
} from "../src/validation/index.js";
import { createInlineCpuReferenceWorker } from "./fixtures/inline-cpu-reference-worker.js";

describe("grid and cylinder-placement CPU convergence", () => {
  it(
    "selects production resolution candidates from real steady and periodic evidence",
    async () => {
      const manifest = await runValidation(
        GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE,
        createCpuReferenceBackend(createInlineCpuReferenceWorker),
      );

      expect(parseValidationManifest(manifest)).toEqual(manifest);
      expect(JSON.parse(serializeValidationManifest(manifest))).toEqual(manifest);
      expect(
        {
          cases: manifest.cases
            .filter(({ status }) => status === "fail")
            .map(({ caseId, regime, failures }) => ({ caseId, regime, failures })),
          reconciliations: manifest.reconciliations
            .filter(({ status }) => status === "fail")
            .map(({ id, failures }) => ({ id, failures })),
        },
      ).toEqual({ cases: [], reconciliations: [] });
      expect(manifest.status).toBe("pass");
      expect(
        manifest.reconciliations.flatMap(({ comparisons }) =>
          comparisons.map(({ comparisonCaseId, status }) => ({
            comparisonCaseId,
            status,
          })),
        ),
      ).toEqual([
        {
          comparisonCaseId: "grid-steady-re020-candidate-d18",
          status: "pass",
        },
        {
          comparisonCaseId: "grid-steady-re020-reference-d20",
          status: "pass",
        },
        {
          comparisonCaseId: "grid-periodic-re100-candidate-d19",
          status: "pass",
        },
        {
          comparisonCaseId: "grid-periodic-re100-reference-d20",
          status: "pass",
        },
        {
          comparisonCaseId: "placement-steady-re020-shifted-d18",
          status: "pass",
        },
        {
          comparisonCaseId: "placement-periodic-re100-shifted-d18",
          status: "pass",
        },
      ]);
    },
    2_700_000,
  );
});
