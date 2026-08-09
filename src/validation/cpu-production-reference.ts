import { DOMAIN_AND_BOUNDARY_VALIDATION_SUITE } from "./domain-boundary-reference.js";
import {
  CPU_PRODUCTION_CELLS_PER_DIAMETER,
  CPU_PRODUCTION_QUALITY_TIER_ID,
} from "./cpu-production-config.js";
import { FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE } from "./full-reynolds-envelope-reference.js";
import { GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE } from "./grid-convergence-reference.js";
import {
  VALIDATION_SCHEMA_VERSION,
  type NumericalConfiguration,
  type ValidationCaseDefinition,
  type ValidationSuite,
} from "./types.js";

const productionDomain =
  DOMAIN_AND_BOUNDARY_VALIDATION_SUITE.evidenceScope.selectedProductionDomain;
const productionBoundaries =
  DOMAIN_AND_BOUNDARY_VALIDATION_SUITE.evidenceScope.selectedProductionBoundaries;

const canonicalCases = FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE.cases.map(
  (definition) => productionCase(definition),
);
const evidenceCases = uniqueCases([
  ...canonicalCases,
  ...GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE.cases,
  ...DOMAIN_AND_BOUNDARY_VALIDATION_SUITE.cases,
]);

export const CPU_PRODUCTION_VALIDATION_SUITE = Object.freeze({
  schemaVersion: VALIDATION_SCHEMA_VERSION,
  id: "cpu-production-d18-open-cylinder-v1",
  metricVersions: Object.freeze({
    ...FULL_REYNOLDS_ENVELOPE_VALIDATION_SUITE.metricVersions,
    ...GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE.metricVersions,
    ...DOMAIN_AND_BOUNDARY_VALIDATION_SUITE.metricVersions,
  }),
  evidenceScope: DOMAIN_AND_BOUNDARY_VALIDATION_SUITE.evidenceScope,
  cases: Object.freeze(evidenceCases),
  reconciliations: Object.freeze([
    ...GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE.reconciliations,
    ...DOMAIN_AND_BOUNDARY_VALIDATION_SUITE.reconciliations,
  ]),
} satisfies ValidationSuite);

export const CPU_PRODUCTION_CANONICAL_VALIDATION_SUITE = Object.freeze({
  schemaVersion: VALIDATION_SCHEMA_VERSION,
  id: "cpu-production-d18-canonical-envelope-v1",
  metricVersions: CPU_PRODUCTION_VALIDATION_SUITE.metricVersions,
  evidenceScope: DOMAIN_AND_BOUNDARY_VALIDATION_SUITE.evidenceScope,
  cases: Object.freeze(canonicalCases),
  reconciliations: Object.freeze([]),
} satisfies ValidationSuite);

function productionCase(
  definition: ValidationCaseDefinition,
): ValidationCaseDefinition {
  const configuration: NumericalConfiguration = Object.freeze({
    ...definition.configuration,
    qualityTier: CPU_PRODUCTION_QUALITY_TIER_ID,
    domain: productionDomain,
    boundaries: productionBoundaries,
    cylinder: Object.freeze({
      cellsPerDiameter: CPU_PRODUCTION_CELLS_PER_DIAMETER,
      offsetX: 0,
      offsetY: 0,
    }),
  });
  return Object.freeze({
    ...definition,
    configuration,
    protocol: Object.freeze({
      ...definition.protocol,
      sampleInterval: productionSampleInterval(definition),
    }),
  });
}

function productionSampleInterval(definition: ValidationCaseDefinition): number {
  const referenceInterval = definition.protocol.sampleInterval;
  const latticeSpeed = definition.configuration.latticeSpeed ?? 0.08;
  const referenceStepCount =
    (referenceInterval * CPU_PRODUCTION_CELLS_PER_DIAMETER) / latticeSpeed;
  return Number.isInteger(referenceStepCount) ? referenceInterval : 0.4;
}

function uniqueCases(
  cases: readonly ValidationCaseDefinition[],
): ValidationCaseDefinition[] {
  const byId = new Map<string, ValidationCaseDefinition>();
  for (const definition of cases) {
    const existing = byId.get(definition.id);
    if (existing !== undefined && existing !== definition) {
      throw new Error(`CPU production evidence contains duplicate case ${definition.id}.`);
    }
    byId.set(definition.id, definition);
  }
  return [...byId.values()];
}
