import { describe, expect, it } from "vitest";

import { CPU_PRODUCTION_CANONICAL_VALIDATION_SUITE } from "../src/validation/cpu-production-reference.js";
import { CPU_PRODUCTION_MANIFEST } from "../src/engine/cpu-tier.js";
import { reconcileBackendManifests } from "../src/validation/backend-parity.js";
import { parseValidationManifest } from "../src/validation/manifest-schema.js";
import {
  WEBGPU_BACKEND_PARITY_DEFINITION,
  WEBGPU_BACKEND_VALIDATION_SUITE,
} from "../src/validation/webgpu-reference.js";
import webGpuManifestInput from "../src/validation/webgpu-backend-manifest.json";

const WEBGPU_BACKEND_MANIFEST = parseValidationManifest(webGpuManifestInput);

describe("matched CPU/WebGPU reference cohort", () => {
  it("pins identical Re=20 and Re=100 case definitions and inclusive parity gates", () => {
    expect(WEBGPU_BACKEND_VALIDATION_SUITE.cases.map(({ reynoldsNumber }) => reynoldsNumber)).toEqual([
      20,
      100,
    ]);
    for (const webGpuCase of WEBGPU_BACKEND_VALIDATION_SUITE.cases) {
      const cpuCase = CPU_PRODUCTION_CANONICAL_VALIDATION_SUITE.cases.find(
        ({ id }) => id === webGpuCase.id,
      );
      expect(cpuCase).toBeDefined();
      expect(webGpuCase).toEqual({
        ...cpuCase,
        configuration: {
          ...cpuCase!.configuration,
          backendId: "webgpu-reference",
          qualityTier: "webgpu-balanced-d18",
          precision: "float32",
        },
      });
    }
    expect(WEBGPU_BACKEND_PARITY_DEFINITION).toEqual({
      id: "cpu-webgpu-re20-re100-v1",
      cases: [
        {
          caseId: "open-cylinder-re020",
          maximumRelativeChange: {
            meanDragCoefficient: 0.01,
            recirculationLength: 0.02,
            meanDensity: 0.001,
            fluxResidual: 0.25,
          },
        },
        {
          caseId: "open-cylinder-re100",
          maximumRelativeChange: {
            meanDragCoefficient: 0.01,
            strouhalNumber: 0.01,
            meanDensity: 0.001,
            fluxResidual: 0.25,
          },
        },
      ],
    });
  });

  it("identifies the backend pair, metric, measured delta, and inclusive gate on failure", () => {
    const shiftedDensity = {
      ...WEBGPU_BACKEND_MANIFEST,
      cases: WEBGPU_BACKEND_MANIFEST.cases.map((result) =>
        result.caseId === "open-cylinder-re020"
          ? {
              ...result,
              metrics: {
                ...result.metrics,
                meanDensity: {
                  ...result.metrics.meanDensity!,
                  measured: result.metrics.meanDensity!.measured! * 1.002,
                },
              },
            }
          : result,
      ),
    };

    const reconciliation = reconcileBackendManifests(
      WEBGPU_BACKEND_PARITY_DEFINITION,
      CPU_PRODUCTION_MANIFEST,
      shiftedDensity,
    );

    expect(reconciliation.status).toBe("fail");
    expect(reconciliation.failures).toEqual([
      expect.stringMatching(
        /open-cylinder-re020 between cpu-reference and webgpu-reference: meanDensity measured delta .*; allowed inclusive delta 0\.001/,
      ),
    ]);
  });
});
