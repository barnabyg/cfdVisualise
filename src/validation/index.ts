export { runValidation } from "./run-validation.js";
export {
  CPU_REFERENCE_BOUNDARY_PRECEDENCE,
  CPU_REFERENCE_BACKEND_IDENTITY,
  createCpuReferenceBackend,
} from "./cpu-reference-backend.js";
export type {
  CpuReferenceRunCaseCommand,
  CpuReferenceWorkerFactory,
  CpuReferenceWorkerPort,
  CpuReferenceWorkerResponse,
} from "./cpu-reference-backend.js";
export {
  parseSolverBackend,
  parseValidationSuite,
  ValidationContractSchemaError,
} from "./validation-contract-schema.js";
export { reconcileBackendManifests } from "./backend-parity.js";
export type * from "./backend-parity.js";
export {
  D2Q9_OPEN_CYLINDER_CONTRACT,
  buildOpenCylinderGeometry,
  equilibriumPopulation,
  trtRelaxationRates,
} from "./d2q9-open-cylinder-contract.js";
export type * from "./d2q9-open-cylinder-contract.js";
export {
  WEBGPU_BACKEND_IDENTITY,
  WEBGPU_MATCHED_CONFIGURATION_MIN_BUFFER_BYTES,
  WebGpuExecutionError,
  collectWebGpuValidationCase,
  createBrowserWebGpuPlatform,
  createWebGpuValidationBackend,
} from "./webgpu-backend.js";
export type * from "./webgpu-backend.js";
export {
  WEBGPU_BACKEND_PARITY_DEFINITION,
  WEBGPU_BACKEND_VALIDATION_SUITE,
  WEBGPU_BACKEND_QUALITY_TIER_ID,
} from "./webgpu-reference.js";
export {
  parseValidationManifest,
  serializeValidationManifest,
  ValidationManifestSchemaError,
} from "./manifest-schema.js";
export {
  analyseLiftSignal,
  measureCentrelineSymmetry,
  measureRecirculationLength,
  reconcileDomainMass,
} from "./metrics.js";
export {
  createMethodAndValidationModel,
  evaluateReleaseGate,
} from "./manifest-consumers.js";
export {
  MethodAndValidation,
  MethodAndValidationSurface,
} from "./method-and-validation-surface.js";
export type * from "./method-and-validation-surface.js";
export {
  createReferenceValidationSuite,
  REFERENCE_CASE_CATALOGUE,
} from "./reference-catalogue.js";
export { STEADY_RE20_VALIDATION_SUITE } from "./steady-re20-reference.js";
export { PERIODIC_RE100_VALIDATION_SUITE } from "./periodic-re100-reference.js";
export {
  FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE,
} from "./full-reynolds-envelope-reference.js";
export {
  GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE,
} from "./grid-convergence-reference.js";
export {
  DOMAIN_AND_BOUNDARY_VALIDATION_SUITE,
} from "./domain-boundary-reference.js";
export type * from "./reference-catalogue.js";
export type * from "./manifest-consumers.js";
export type * from "./metrics.js";
export type * from "./types.js";
