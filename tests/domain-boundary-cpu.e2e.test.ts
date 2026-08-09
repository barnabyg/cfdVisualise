import { describe, expect, it } from "vitest";

import {
  DOMAIN_AND_BOUNDARY_VALIDATION_SUITE,
  createCpuReferenceBackend,
  parseValidationManifest,
  runValidation,
  serializeValidationManifest,
} from "../src/validation/index.js";
import { createInlineCpuReferenceWorker } from "./fixtures/inline-cpu-reference-worker.js";

describe("domain and open-boundary CPU evidence", () => {
  it(
    "selects the production open-flow domain and boundaries from real cohort evidence",
    async () => {
      const manifest = await runValidation(
        DOMAIN_AND_BOUNDARY_VALIDATION_SUITE,
        createCpuReferenceBackend(createInlineCpuReferenceWorker),
      );

      expect(parseValidationManifest(manifest)).toEqual(manifest);
      expect(JSON.parse(serializeValidationManifest(manifest))).toEqual(manifest);
      expect(manifest.suite.evidenceScope).toEqual(
        DOMAIN_AND_BOUNDARY_VALIDATION_SUITE.evidenceScope,
      );
      expect({
        cases: manifest.cases
          .filter(({ status }) => status === "fail")
          .map(({ caseId, regime, failures }) => ({ caseId, regime, failures })),
        reconciliations: manifest.reconciliations
          .filter(({ status }) => status === "fail")
          .map(({ id, failures }) => ({ id, failures })),
      }).toEqual({ cases: [], reconciliations: [] });
      expect(manifest.status).toBe("pass");
    },
    5_400_000,
  );
});
