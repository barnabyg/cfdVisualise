import { parseValidationManifest } from "./manifest-schema.js";
import type {
  ReconciliationManifest,
  ValidationManifest,
} from "./types.js";

export interface BackendParityDefinition {
  readonly id: string;
  readonly caseIds: readonly string[];
  readonly maximumRelativeChange: Readonly<
    Partial<Record<"meanDragCoefficient" | "recirculationLength" | "strouhalNumber", number>>
  >;
}

export function reconcileBackendManifests(
  definition: BackendParityDefinition,
  baselineInput: unknown,
  comparisonInput: unknown,
): ReconciliationManifest {
  const baselineManifest = parseValidationManifest(baselineInput);
  const comparisonManifest = parseValidationManifest(comparisonInput);
  const failures: string[] = [];
  const comparisons: ReconciliationManifest["comparisons"][number][] = [];
  if (baselineManifest.backend.id === comparisonManifest.backend.id) {
    failures.push("Backend parity requires two distinct backend identities.");
  }
  if (
    new Set([baselineManifest.backend.kind, comparisonManifest.backend.kind]).size !== 2
  ) {
    failures.push("Backend parity requires one CPU-worker and one WebGPU manifest.");
  }
  if (baselineManifest.status !== "pass" || comparisonManifest.status !== "pass") {
    failures.push("Backend parity requires two passing input manifests.");
  }
  if (
    baselineManifest.suite.schemaVersion !== comparisonManifest.suite.schemaVersion ||
    canonicalKey(baselineManifest.suite.metricVersions) !==
      canonicalKey(comparisonManifest.suite.metricVersions)
  ) {
    failures.push("Backend parity requires identical suite and metric-definition versions.");
  }

  for (const caseId of definition.caseIds) {
    const baseline = findCase(baselineManifest, caseId);
    const comparison = findCase(comparisonManifest, caseId);
    const comparisonFailures: string[] = [];
    const metrics: Record<
      string,
      ReconciliationManifest["comparisons"][number]["metrics"][string]
    > = {};
    if (baseline === undefined || comparison === undefined) {
      comparisonFailures.push(`Backend parity case ${caseId} is missing from an input manifest.`);
    } else {
      if (baseline.regime !== comparison.regime) {
        comparisonFailures.push(
          `Backend parity case ${caseId} changed regime from ${baseline.regime} to ${comparison.regime}.`,
        );
      }
      if (configurationKey(baseline.configuration) !== configurationKey(comparison.configuration)) {
        comparisonFailures.push(
          `Backend parity case ${caseId} did not use a matched numerical configuration.`,
        );
      }
      if (
        canonicalKey(baseline.definition) !== canonicalKey(comparison.definition) ||
        metricDefinitionKey(baseline.metrics) !== metricDefinitionKey(comparison.metrics)
      ) {
        comparisonFailures.push(
          `Backend parity case ${caseId} did not use identical scenario, protocol, thresholds, and metric definitions.`,
        );
      }
      for (const [metric, maximumRelativeChange] of Object.entries(
        definition.maximumRelativeChange,
      )) {
        if (maximumRelativeChange === undefined) {
          continue;
        }
        const baselineValue = baseline.metrics[metric]?.measured;
        const comparisonValue = comparison.metrics[metric]?.measured;
        if (baselineValue === undefined || comparisonValue === undefined) {
          comparisonFailures.push(`Backend parity case ${caseId} is missing ${metric}.`);
          continue;
        }
        const relativeChange =
          Math.abs(comparisonValue - baselineValue) /
          Math.max(Math.abs(baselineValue), Number.EPSILON);
        const status = relativeChange <= maximumRelativeChange ? "pass" : "fail";
        metrics[metric] = {
          baseline: baselineValue,
          comparison: comparisonValue,
          relativeChange: Number(relativeChange.toPrecision(12)),
          maximumRelativeChange,
          status,
        };
        if (status === "fail") {
          comparisonFailures.push(
            `Backend parity case ${caseId} ${metric} changed by ${relativeChange}; maximum ${maximumRelativeChange}.`,
          );
        }
      }
    }
    failures.push(...comparisonFailures);
    comparisons.push({
      comparisonCaseId: caseId,
      baselineBackendId: baselineManifest.backend.id,
      comparisonBackendId: comparisonManifest.backend.id,
      baselineBackendKind: baselineManifest.backend.kind,
      comparisonBackendKind: comparisonManifest.backend.kind,
      ...(baseline === undefined ? {} : { baselineRegime: baseline.regime }),
      ...(comparison === undefined ? {} : { comparisonRegime: comparison.regime }),
      metrics,
      status: comparisonFailures.length === 0 ? "pass" : "fail",
    });
  }

  return {
    id: definition.id,
    kind: "backend",
    baselineCaseId: "matched-backend-cases",
    comparisons,
    status: failures.length === 0 ? "pass" : "fail",
    failures,
  };
}

function findCase(manifest: ValidationManifest, caseId: string) {
  return manifest.cases.find((result) => result.caseId === caseId);
}

function configurationKey(configuration: ValidationManifest["cases"][number]["configuration"]): string {
  const {
    backendId: _backendId,
    qualityTier: _qualityTier,
    ...matchedConfiguration
  } = configuration;
  return JSON.stringify(matchedConfiguration);
}

function metricDefinitionKey(
  metrics: ValidationManifest["cases"][number]["metrics"],
): string {
  return canonicalKey(
    Object.fromEntries(
      Object.entries(metrics).map(([metric, evidence]) => [
        metric,
        {
          applicability: evidence.applicability,
          expected: evidence.expected,
          tolerance: evidence.tolerance,
          sources: evidence.sources,
        },
      ]),
    ),
  );
}

function canonicalKey(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalKey).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalKey(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
