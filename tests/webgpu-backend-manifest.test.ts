import { describe, expect, it } from "vitest";

import { parseValidationManifest } from "../src/validation/index.js";
import manifestInput from "../src/validation/webgpu-backend-manifest.json";

describe("bundled WebGPU quality-tier evidence", () => {
  it("records the complete passing reference and reconciliation cohorts", () => {
    const manifest = parseValidationManifest(manifestInput);
    expect(manifest.status).toBe("pass");
    expect(manifest.cases).toHaveLength(32);
    expect(
      manifest.cases.find(({ caseId }) => caseId === "open-cylinder-re020"),
    ).toMatchObject({ status: "pass", regime: "steady" });
    expect(
      manifest.cases.find(({ caseId }) => caseId === "open-cylinder-re100"),
    ).toMatchObject({ status: "pass", regime: "periodically-shedding" });
    expect(new Set(manifest.reconciliations.map(({ kind }) => kind))).toEqual(
      new Set(["grid", "cylinder-placement", "domain", "boundary", "backend"]),
    );
    expect(
      manifest.cases.find(({ caseId }) => caseId === "grid-steady-re020-candidate-d16"),
    ).toMatchObject({
      configuration: {
        qualityTier: "webgpu-production-candidate-d16",
        cylinder: { cellsPerDiameter: 16 },
      },
    });
    expect(
      manifest.cases
        .filter(({ configuration }) => configuration.qualityTier === "webgpu-balanced-d18")
        .every(({ configuration }) => configuration.cylinder.cellsPerDiameter === 18),
    ).toBe(true);
    const backend = manifest.reconciliations.find(({ kind }) => kind === "backend");
    expect(backend).toMatchObject({
      id: "cpu-webgpu-re20-re100-v1",
      status: "pass",
      failures: [],
    });
    for (const comparison of backend!.comparisons) {
      expect(comparison.metrics).toHaveProperty("meanDragCoefficient");
      expect(comparison.metrics).toHaveProperty("meanDensity");
      expect(comparison.metrics).toHaveProperty("fluxResidual");
    }
    expect(JSON.stringify(manifest)).not.toMatch(
      /fieldHash|rawField|populations|generatedAt|hostname|machineId/,
    );
  });
});
