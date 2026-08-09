import { CPU_PRODUCTION_CANONICAL_VALIDATION_SUITE } from "./cpu-production-reference.js";
import type { BackendParityDefinition } from "./backend-parity.js";
import {
  VALIDATION_SCHEMA_VERSION,
  type ValidationCaseDefinition,
  type ValidationSuite,
} from "./types.js";
import { WEBGPU_BACKEND_IDENTITY } from "./webgpu-backend.js";

export const WEBGPU_BACKEND_QUALITY_TIER_ID = "webgpu-reference-d18";

export const WEBGPU_BACKEND_VALIDATION_SUITE = Object.freeze({
  schemaVersion: VALIDATION_SCHEMA_VERSION,
  id: "webgpu-backend-re20-re100-d18-v1",
  metricVersions: CPU_PRODUCTION_CANONICAL_VALIDATION_SUITE.metricVersions,
  evidenceScope: CPU_PRODUCTION_CANONICAL_VALIDATION_SUITE.evidenceScope,
  cases: Object.freeze([matchedCase(20), matchedCase(100)]),
  reconciliations: Object.freeze([]),
} satisfies ValidationSuite);

export const WEBGPU_BACKEND_PARITY_DEFINITION = Object.freeze({
  id: "cpu-webgpu-re20-re100-v1",
  cases: Object.freeze([
    Object.freeze({
      caseId: "open-cylinder-re020",
      maximumRelativeChange: Object.freeze({
        meanDragCoefficient: 0.01,
        recirculationLength: 0.02,
        meanDensity: 0.001,
        fluxResidual: 0.25,
      }),
    }),
    Object.freeze({
      caseId: "open-cylinder-re100",
      maximumRelativeChange: Object.freeze({
        meanDragCoefficient: 0.01,
        strouhalNumber: 0.01,
        meanDensity: 0.001,
        fluxResidual: 0.25,
      }),
    }),
  ]),
} satisfies BackendParityDefinition);

function matchedCase(reynoldsNumber: 20 | 100): ValidationCaseDefinition {
  const cpuCase = CPU_PRODUCTION_CANONICAL_VALIDATION_SUITE.cases.find(
    (definition) => definition.reynoldsNumber === reynoldsNumber,
  );
  if (cpuCase === undefined) {
    throw new Error(`CPU production evidence lacks the matched Re=${reynoldsNumber} case.`);
  }
  return Object.freeze({
    ...cpuCase,
    configuration: Object.freeze({
      ...cpuCase.configuration,
      backendId: WEBGPU_BACKEND_IDENTITY.id,
      qualityTier: WEBGPU_BACKEND_QUALITY_TIER_ID,
      precision: "float32",
    }),
  });
}
