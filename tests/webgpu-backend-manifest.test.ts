import { describe, expect, it } from "vitest";

import { parseValidationManifest } from "../src/validation/index.js";
import manifestInput from "../src/validation/webgpu-backend-manifest.json";

describe("bundled WebGPU backend reconciliation evidence", () => {
  it("records passing independent and backend-parity evidence without claiming a shipped tier", () => {
    const manifest = parseValidationManifest(manifestInput);
    expect(manifest).toMatchObject({
      status: "pass",
      cases: [
        { caseId: "open-cylinder-re020", status: "pass", regime: "steady" },
        {
          caseId: "open-cylinder-re100",
          status: "pass",
          regime: "periodically-shedding",
        },
      ],
      reconciliations: [
        {
          id: "cpu-webgpu-re20-re100-v1",
          kind: "backend",
          status: "pass",
          failures: [],
        },
      ],
    });
    for (const comparison of manifest.reconciliations[0]!
      .comparisons) {
      expect(comparison.metrics).toHaveProperty("meanDragCoefficient");
      expect(comparison.metrics).toHaveProperty("meanDensity");
      expect(comparison.metrics).toHaveProperty("fluxResidual");
    }
    expect(JSON.stringify(manifest)).not.toMatch(
      /fieldHash|rawField|populations|production|shipped/,
    );
  });
});
