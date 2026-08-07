import { parseValidationManifest } from "./manifest-schema.js";
import type {
  BoundaryConfiguration,
  FlowRegime,
  MetricEvidence,
  ScientificSource,
} from "./types.js";

export interface ActiveValidationIdentity {
  readonly backendId: string;
  readonly qualityTier: string;
  readonly buildId: string;
}

export type MethodAndValidationModel =
  | {
      readonly status: "validated";
      readonly evidenceState: "passing";
      readonly suiteId: string;
      readonly backendId: string;
      readonly qualityTier: string;
      readonly solver: string;
      readonly solverVersion: string;
      readonly buildId: string;
      readonly modelScope: "Qualitative two-dimensional open-cylinder flow";
      readonly boundaries: BoundaryConfiguration;
      readonly referenceCases: readonly {
        readonly caseId: string;
        readonly reynoldsNumber: number;
        readonly regime?: FlowRegime;
        readonly metrics: Readonly<Record<string, MetricEvidence>>;
      }[];
      readonly sources: readonly ScientificSource[];
    }
  | {
      readonly status: "unavailable";
      readonly evidenceState: "failing" | "missing" | "mismatched" | "incompatible";
      readonly reason: string;
    };

export interface ReleaseGateInput {
  readonly manifest: unknown;
  readonly active: ActiveValidationIdentity;
  readonly guideDurationSeconds: number;
  readonly maximumGuideDurationSeconds: number;
}

export interface ReleaseGateResult {
  readonly status: "pass" | "fail";
  readonly validation: {
    readonly status: "pass" | "fail";
    readonly reason?: string;
  };
  readonly performance: {
    readonly status: "pass" | "fail";
    readonly guideDurationSeconds: number;
    readonly maximumGuideDurationSeconds: number;
  };
}

export function createMethodAndValidationModel(
  input: unknown,
  active: ActiveValidationIdentity,
): MethodAndValidationModel {
  if (input === null || input === undefined) {
    return {
      status: "unavailable",
      evidenceState: "missing",
      reason: "Validation evidence is missing for the active quality tier.",
    };
  }
  let manifest;
  try {
    manifest = parseValidationManifest(input);
  } catch (error) {
    return {
      status: "unavailable",
      evidenceState: "incompatible",
      reason: `Validation evidence is incompatible: ${errorMessage(error)}`,
    };
  }
  if (manifest.status !== "pass") {
    return {
      status: "unavailable",
      evidenceState: "failing",
      reason:
        manifest.cases.flatMap((result) => result.failures).at(0) ??
        manifest.reconciliations.flatMap((result) => result.failures).at(0) ??
        "Validation evidence did not pass its declared scientific gates.",
    };
  }
  const activeCases = manifest.cases.filter(
    (result) =>
      result.configuration.backendId === active.backendId &&
      result.configuration.qualityTier === active.qualityTier,
  );
  if (
    manifest.backend.id !== active.backendId ||
    manifest.backend.buildId !== active.buildId ||
    activeCases.length === 0
  ) {
    return {
      status: "unavailable",
      evidenceState: "mismatched",
      reason: `Validation evidence does not match active backend ${active.backendId}, tier ${active.qualityTier}, and build ${active.buildId}.`,
    };
  }
  return {
    status: "validated",
    evidenceState: "passing",
    suiteId: manifest.suite.id,
    backendId: manifest.backend.id,
    qualityTier: active.qualityTier,
    solver: manifest.backend.solver,
    solverVersion: manifest.backend.solverVersion,
    buildId: manifest.backend.buildId,
    modelScope: "Qualitative two-dimensional open-cylinder flow",
    boundaries: activeCases[0]!.configuration.boundaries,
    referenceCases: activeCases.map((result) => ({
      caseId: result.caseId,
      reynoldsNumber: result.reynoldsNumber,
      ...(result.regime === undefined ? {} : { regime: result.regime }),
      metrics: result.metrics,
    })),
    sources: collectSources(activeCases.flatMap((result) => Object.values(result.metrics))),
  };
}

function releaseEvidenceProblem(
  activeCases: readonly ReturnType<typeof parseValidationManifest>["cases"][number][],
  reconciliations: ReturnType<typeof parseValidationManifest>["reconciliations"],
): string | undefined {
  const requiredReynoldsNumbers = [5, 20, 40, 45, 50, 100, 150];
  for (const reynoldsNumber of requiredReynoldsNumbers) {
    const result = activeCases.find(
      (candidate) =>
        candidate.reynoldsNumber === reynoldsNumber && hasProductionConfiguration(candidate),
    );
    if (result === undefined) {
      return `missing the canonical open-flow Re=${reynoldsNumber} reference case`;
    }
    const requiredMetrics =
      result.regime === "steady"
        ? ["meanDragCoefficient", "recirculationLength"]
        : result.regime === "periodically-shedding"
          ? ["meanDragCoefficient", "liftRms", "strouhalNumber"]
          : ["meanDragCoefficient"];
    for (const metric of requiredMetrics) {
      if (result.metrics[metric]?.status !== "pass") {
        return `Re=${reynoldsNumber} lacks passing ${metric} evidence`;
      }
    }
  }
  const requiredKinds = ["grid", "domain", "cylinder-placement", "boundary", "backend"];
  for (const kind of requiredKinds) {
    const evidenceForKind = reconciliations.filter(
      (reconciliation) => reconciliation.kind === kind && reconciliation.status === "pass",
    );
    if (evidenceForKind.length === 0) {
      return `missing passing ${kind} reconciliation`;
    }
    for (const evidence of evidenceForKind) {
      const metricProblem = reconciliationMetricProblem(evidence);
      if (metricProblem !== undefined) {
        return `${kind} reconciliation ${metricProblem}`;
      }
      if (kind !== "backend") {
        const baseline = findActiveCase(activeCases, evidence.baselineCaseId);
        const comparisonCases = findComparisonCases(activeCases, evidence);
        if (
          baseline === undefined ||
          comparisonCases.length !== evidence.comparisons.length ||
          comparisonCases.some((result) => result.reynoldsNumber !== baseline.reynoldsNumber) ||
          evidence.comparisons.some(
            (comparison, index) =>
              comparison.baselineRegime !== baseline.regime ||
              comparison.comparisonRegime !== comparisonCases[index]?.regime,
          )
        ) {
          return `${kind} reconciliation does not compare matched active reference cases`;
        }
      }
    }
    if (kind === "grid") {
      const evidence = evidenceForKind[0]!;
      const baseline = findActiveCase(activeCases, evidence.baselineCaseId);
      const comparisonCases = findComparisonCases(activeCases, evidence);
      const resolutions = new Set(
        comparisonCases.map((result) => result.configuration.cylinder.cellsPerDiameter),
      );
      if (
        baseline === undefined ||
        comparisonCases.length < 2 ||
        resolutions.size < 2 ||
        !comparisonCases.some(
          (result) =>
            result.configuration.cylinder.cellsPerDiameter >
            baseline.configuration.cylinder.cellsPerDiameter,
        )
      ) {
        return "grid reconciliation lacks two resolutions and a finer configuration";
      }
    }
    if (kind === "domain") {
      const variedExtents = new Set<string>();
      for (const evidence of evidenceForKind) {
        const baseline = findActiveCase(activeCases, evidence.baselineCaseId);
        for (const comparison of findComparisonCases(activeCases, evidence)) {
          if (baseline === undefined) continue;
          const changedExtents = ([
            "upstreamDiameters",
            "downstreamDiameters",
            "lateralDiameters",
          ] as const).filter(
            (extent) =>
              comparison.configuration.domain[extent] !== baseline.configuration.domain[extent],
          );
          if (changedExtents.length === 1) {
            variedExtents.add(changedExtents[0]!);
          }
        }
      }
      if (variedExtents.size !== 3) {
        return "domain reconciliation must vary upstream, downstream, and lateral extents independently";
      }
    }
    if (kind === "cylinder-placement") {
      const hasFractionalShift = evidenceForKind.some((evidence) =>
        findComparisonCases(activeCases, evidence).some((result) => {
          const { offsetX, offsetY } = result.configuration.cylinder;
          return !Number.isInteger(offsetX) || !Number.isInteger(offsetY);
        }),
      );
      if (!hasFractionalShift) {
        return "cylinder-placement reconciliation lacks a fractional lattice shift";
      }
    }
    if (kind === "boundary") {
      const covered = new Set<"low" | "onset" | "shedding">();
      const changedBoundaries = new Set<"inlet" | "lateral" | "outlet">();
      for (const evidence of evidenceForKind) {
        const baseline = findActiveCase(activeCases, evidence.baselineCaseId);
        if (baseline === undefined) continue;
        const comparisons = findComparisonCases(activeCases, evidence);
        const variesBoundary = comparisons.some((comparison) => {
          for (const boundary of ["inlet", "lateral", "outlet"] as const) {
            if (
              comparison.configuration.boundaries[boundary] !==
              baseline.configuration.boundaries[boundary]
            ) {
              changedBoundaries.add(boundary);
            }
          }
          return (
            JSON.stringify(comparison.configuration.boundaries) !==
            JSON.stringify(baseline.configuration.boundaries)
          );
        });
        if (!variesBoundary) continue;
        if (baseline.reynoldsNumber <= 20) covered.add("low");
        if (baseline.reynoldsNumber === 45 || baseline.reynoldsNumber === 50) {
          covered.add("onset");
        }
        if (baseline.reynoldsNumber >= 100) covered.add("shedding");
      }
      if (covered.size !== 3 || changedBoundaries.size !== 3) {
        return "boundary reconciliation must vary inlet, lateral, and outlet formulations across low Reynolds number, onset, and developed shedding cases";
      }
    }
    if (kind === "backend") {
      const comparesDistinctBackends = evidenceForKind.some((evidence) =>
        evidence.comparisons.some(
          (comparison) =>
            comparison.baselineBackendId !== undefined &&
            comparison.comparisonBackendId !== undefined &&
            comparison.baselineBackendId !== comparison.comparisonBackendId &&
            new Set([
              comparison.baselineBackendKind,
              comparison.comparisonBackendKind,
            ]).has("cpu-worker") &&
            new Set([
              comparison.baselineBackendKind,
              comparison.comparisonBackendKind,
            ]).has("webgpu"),
        ),
      );
      if (!comparesDistinctBackends) {
        return "backend reconciliation did not compare distinct backends";
      }
    }
  }
  return undefined;
}

type ParsedManifest = ReturnType<typeof parseValidationManifest>;
type ParsedCase = ParsedManifest["cases"][number];
type ParsedReconciliation = ParsedManifest["reconciliations"][number];

function hasProductionConfiguration(result: ParsedCase): boolean {
  return (
    result.configuration.collision === "D2Q9 TRT" &&
    result.configuration.boundaries.inlet === "regularized-velocity" &&
    result.configuration.boundaries.lateral === "free-slip" &&
    result.configuration.boundaries.outlet === "fixed-density-nee" &&
    result.configuration.boundaries.cylinder === "linear-bfl"
  );
}

function reconciliationMetricProblem(evidence: ParsedReconciliation): string | undefined {
  for (const comparison of evidence.comparisons) {
    const drag = comparison.metrics.meanDragCoefficient;
    if (drag?.status !== "pass" || drag.maximumRelativeChange > 0.01) {
      return "lacks a passing mean-drag comparison at the one-percent gate";
    }
    if (comparison.baselineRegime === "steady" && comparison.comparisonRegime === "steady") {
      const recirculation = comparison.metrics.recirculationLength;
      if (recirculation?.status !== "pass" || recirculation.maximumRelativeChange > 0.02) {
        return "lacks a passing recirculation-length comparison at the two-percent gate";
      }
    }
    if (
      comparison.baselineRegime === "periodically-shedding" &&
      comparison.comparisonRegime === "periodically-shedding"
    ) {
      const strouhal = comparison.metrics.strouhalNumber;
      if (strouhal?.status !== "pass" || strouhal.maximumRelativeChange > 0.01) {
        return "lacks a passing Strouhal comparison at the one-percent gate";
      }
    }
  }
  return undefined;
}

function findActiveCase(cases: readonly ParsedCase[], caseId: string): ParsedCase | undefined {
  return cases.find((result) => result.caseId === caseId);
}

function findComparisonCases(
  cases: readonly ParsedCase[],
  evidence: ParsedReconciliation,
): ParsedCase[] {
  return evidence.comparisons
    .map((comparison) => findActiveCase(cases, comparison.comparisonCaseId))
    .filter((result): result is ParsedCase => result !== undefined);
}

export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateResult {
  const validationModel = createMethodAndValidationModel(input.manifest, input.active);
  let validation: ReleaseGateResult["validation"];
  if (validationModel.status === "unavailable") {
    validation = { status: "fail", reason: validationModel.reason };
  } else {
    const manifest = parseValidationManifest(input.manifest);
    const activeCases = manifest.cases.filter(
      (result) =>
        result.configuration.backendId === input.active.backendId &&
        result.configuration.qualityTier === input.active.qualityTier,
    );
    const incompleteReason = releaseEvidenceProblem(activeCases, manifest.reconciliations);
    validation =
      incompleteReason === undefined
        ? { status: "pass" }
        : {
            status: "fail",
            reason: `Validation evidence is incomplete: ${incompleteReason}`,
          };
  }
  const performanceStatus =
    Number.isFinite(input.guideDurationSeconds) &&
    Number.isFinite(input.maximumGuideDurationSeconds) &&
    input.guideDurationSeconds >= 0 &&
    input.maximumGuideDurationSeconds >= 0 &&
    input.guideDurationSeconds <= input.maximumGuideDurationSeconds
      ? "pass"
      : "fail";
  return {
    status: validation.status === "pass" && performanceStatus === "pass" ? "pass" : "fail",
    validation,
    performance: {
      status: performanceStatus,
      guideDurationSeconds: input.guideDurationSeconds,
      maximumGuideDurationSeconds: input.maximumGuideDurationSeconds,
    },
  };
}

function collectSources(
  metrics: readonly { readonly sources?: readonly ScientificSource[] }[],
): readonly ScientificSource[] {
  const sources = new Map<string, ScientificSource>();
  for (const metric of metrics) {
    for (const source of metric.sources ?? []) {
      const key = `${source.id}\u0000${source.url}\u0000${source.convention}`;
      sources.set(key, source);
    }
  }
  return [...sources.values()].sort(
    (left, right) => left.id.localeCompare(right.id) || left.url.localeCompare(right.url),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
