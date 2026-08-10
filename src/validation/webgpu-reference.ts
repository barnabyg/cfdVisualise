import {
  CPU_PRODUCTION_QUALITY_TIER_ID,
} from "./cpu-production-config.js";
import {
  CPU_PRODUCTION_CANONICAL_VALIDATION_SUITE,
  CPU_PRODUCTION_VALIDATION_SUITE,
} from "./cpu-production-reference.js";
import { DOMAIN_AND_BOUNDARY_VALIDATION_SUITE } from "./domain-boundary-reference.js";
import { GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE } from "./grid-convergence-reference.js";
import type { BackendParityDefinition } from "./backend-parity.js";
import {
  VALIDATION_SCHEMA_VERSION,
  type ValidationCaseDefinition,
  type ValidationSuite,
} from "./types.js";
import { WEBGPU_BACKEND_IDENTITY } from "./webgpu-backend.js";

export const WEBGPU_BACKEND_QUALITY_TIER_ID = "webgpu-balanced-d18";
export const WEBGPU_PRODUCTION_DEFAULT_PLAYBACK_RATE = 2 as const;
export const WEBGPU_PRODUCTION_MINIMUM_BENCHMARK_RATE = 1.2 as const;

export const WEBGPU_PRODUCTION_VALIDATION_SUITE = Object.freeze({
  ...CPU_PRODUCTION_VALIDATION_SUITE,
  id: "webgpu-production-d18-open-cylinder-v1",
  qualityTier: Object.freeze({
    id: WEBGPU_BACKEND_QUALITY_TIER_ID,
    cellsPerDiameter: 18,
    defaultPlaybackRate: WEBGPU_PRODUCTION_DEFAULT_PLAYBACK_RATE,
    performance: Object.freeze({
      benchmarkVersion: "interactive-guide-throughput-v2",
      minimumFlowThroughTimePerSecond: WEBGPU_PRODUCTION_MINIMUM_BENCHMARK_RATE,
      maximumGuideDurationSeconds: 90,
    }),
  }),
  cases: Object.freeze(
    CPU_PRODUCTION_VALIDATION_SUITE.cases.map((definition) => webGpuCase(definition)),
  ),
} satisfies ValidationSuite);

export const WEBGPU_PRODUCTION_COMPONENT_SUITES = Object.freeze({
  canonical: webGpuSuite(
    CPU_PRODUCTION_CANONICAL_VALIDATION_SUITE,
    "webgpu-production-d18-canonical-envelope-v1",
  ),
  "grid-placement": webGpuSuite(
    GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE,
    "webgpu-production-d18-grid-placement-v1",
  ),
  "domain-boundary": webGpuSuite(
    DOMAIN_AND_BOUNDARY_VALIDATION_SUITE,
    "webgpu-production-d18-domain-boundary-v1",
  ),
});

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
  return webGpuCase(cpuCase);
}

function webGpuCase(
  cpuCase: ValidationCaseDefinition,
): ValidationCaseDefinition {
  return Object.freeze({
    ...cpuCase,
    configuration: Object.freeze({
      ...cpuCase.configuration,
      backendId: WEBGPU_BACKEND_IDENTITY.id,
      qualityTier:
        cpuCase.configuration.qualityTier === CPU_PRODUCTION_QUALITY_TIER_ID
          ? WEBGPU_BACKEND_QUALITY_TIER_ID
          : `webgpu-${cpuCase.configuration.qualityTier}`,
      precision: "float32",
    }),
  });
}

function webGpuSuite(suite: ValidationSuite, id: string): ValidationSuite {
  return Object.freeze({
    ...suite,
    id,
    qualityTier: WEBGPU_PRODUCTION_VALIDATION_SUITE.qualityTier,
    cases: Object.freeze(suite.cases.map((definition) => webGpuCase(definition))),
  });
}
