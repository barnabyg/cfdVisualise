import {
  VALIDATION_SCHEMA_VERSION,
  type CaseManifest,
  type FlowRegime,
  type InclusiveRange,
  type MetricEvidence,
  type MetricExpectation,
  type ObservableMetric,
  type ReconciliationDefinition,
  type ReconciliationManifest,
  type SolverBackend,
  type ValidationCaseDefinition,
  type ValidationManifest,
  type ValidationSample,
  type ValidationSuite,
} from "./types.js";
import { analyseLiftSignal, reconcileDomainMass } from "./metrics.js";
import { parseSolverBackend, parseValidationSuite } from "./validation-contract-schema.js";

export async function runValidation(
  suiteInput: ValidationSuite,
  backendInput: SolverBackend,
): Promise<ValidationManifest> {
  const suite = parseValidationSuite(suiteInput);
  const backend = parseSolverBackend(backendInput);
  const cases: CaseManifest[] = [];

  for (const definition of suite.cases) {
    cases.push(await runCase(definition, backend));
  }
  const reconciliations = suite.reconciliations.map((definition) =>
    reconcile(definition, cases),
  );

  return {
    schemaVersion: VALIDATION_SCHEMA_VERSION,
    suite: {
      id: suite.id,
      schemaVersion: suite.schemaVersion,
      metricVersions: sortedRecord(suite.metricVersions),
    },
    backend: backend.identity,
    status:
      cases.every((result) => result.status === "pass") &&
      reconciliations.every((result) => result.status === "pass")
        ? "pass"
        : "fail",
    cases,
    reconciliations,
  };
}

function reconcile(
  definition: ReconciliationDefinition,
  cases: readonly CaseManifest[],
): ReconciliationManifest {
  const failures: string[] = [];
  const comparisons: ReconciliationManifest["comparisons"][number][] = [];
  const byId = new Map(cases.map((result) => [result.caseId, result]));
  const baseline = byId.get(definition.baselineCaseId);
  if (baseline === undefined) {
    failures.push(
      `Reconciliation ${definition.id} has no baseline case ${definition.baselineCaseId}.`,
    );
  }

  for (const comparisonId of definition.comparisonCaseIds) {
    const comparisonFailures: string[] = [];
    const metricComparisons: Record<
      string,
      ReconciliationManifest["comparisons"][number]["metrics"][string]
    > = {};
    const comparison = byId.get(comparisonId);
    if (comparison === undefined) {
      const failure = `Reconciliation ${definition.id} has no comparison case ${comparisonId}.`;
      failures.push(failure);
      comparisons.push({
        comparisonCaseId: comparisonId,
        metrics: metricComparisons,
        status: "fail",
      });
      continue;
    }
    if (baseline === undefined) {
      comparisons.push({
        comparisonCaseId: comparisonId,
        ...(comparison.regime === undefined ? {} : { comparisonRegime: comparison.regime }),
        metrics: metricComparisons,
        status: "fail",
      });
      continue;
    }
    if (baseline.status !== "pass" || comparison.status !== "pass") {
      comparisonFailures.push(
        `Reconciliation ${definition.id} cannot compare ${baseline.caseId} with ${comparison.caseId} because an input case failed.`,
      );
    } else {
      if (definition.requireSameRegime && baseline.regime !== comparison.regime) {
        comparisonFailures.push(
          `Reconciliation ${definition.id} changed regime from ${baseline.regime} in ${baseline.caseId} to ${comparison.regime} in ${comparison.caseId}.`,
        );
      }
      for (const [metric, maximumChange] of Object.entries(definition.maximumRelativeChange)) {
        if (maximumChange === undefined) {
          continue;
        }
        const baselineValue = baseline.metrics[metric]?.measured;
        const comparisonValue = comparison.metrics[metric]?.measured;
        if (baselineValue === undefined || comparisonValue === undefined) {
          comparisonFailures.push(
            `Reconciliation ${definition.id} requires ${metric} from ${baseline.caseId} and ${comparison.caseId}.`,
          );
          continue;
        }
        const relativeChange =
          Math.abs(comparisonValue - baselineValue) /
          Math.max(Math.abs(baselineValue), Number.EPSILON);
        const status = relativeChange <= maximumChange ? "pass" : "fail";
        metricComparisons[metric] = {
          baseline: baselineValue,
          comparison: comparisonValue,
          relativeChange: formatNumber(relativeChange),
          maximumRelativeChange: maximumChange,
          status,
        };
        if (status === "fail") {
          comparisonFailures.push(
            `Reconciliation ${definition.id}: ${metric} changed by ${formatNumber(relativeChange)} between ${baseline.caseId} (${baselineValue}) and ${comparison.caseId} (${comparisonValue}); maximum ${maximumChange}.`,
          );
        }
      }
    }
    failures.push(...comparisonFailures);
    comparisons.push({
      comparisonCaseId: comparison.caseId,
      ...(baseline.regime === undefined ? {} : { baselineRegime: baseline.regime }),
      ...(comparison.regime === undefined ? {} : { comparisonRegime: comparison.regime }),
      metrics: metricComparisons,
      status: comparisonFailures.length === 0 ? "pass" : "fail",
    });
  }

  return {
    schemaVersion: VALIDATION_SCHEMA_VERSION,
    id: definition.id,
    kind: definition.kind,
    baselineCaseId: definition.baselineCaseId,
    comparisons,
    status: failures.length === 0 ? "pass" : "fail",
    failures,
  };
}

async function runCase(
  definition: ValidationCaseDefinition,
  backend: SolverBackend,
): Promise<CaseManifest> {
  const samples: ValidationSample[] = [];
  const failures: string[] = [];
  const targetFlowThroughTime =
    definition.protocol.warmUpFlowThroughTime + definition.protocol.sampleFlowThroughTime;

  if (definition.configuration.backendId !== backend.identity.id) {
    failures.push(
      `Case ${definition.id} requires backend ${definition.configuration.backendId}; received ${backend.identity.id}.`,
    );
  } else {
    for await (const sample of backend.runCase(definition)) {
      const failure = numericalSampleFailure(sample, definition, samples.at(-1));
      if (failure !== undefined) {
        failures.push(failure);
        break;
      }
      if (
        sample.flowThroughTime >
        targetFlowThroughTime + samplingTolerance(definition.protocol.sampleInterval)
      ) {
        failures.push(
          `Case ${definition.id} overshot its declared ${targetFlowThroughTime} flow-through-time window at ${sample.flowThroughTime}.`,
        );
        break;
      }
      samples.push(sample);
      if (sample.flowThroughTime >= targetFlowThroughTime) {
        break;
      }
    }
  }

  const lastSample = samples.at(-1);
  const achievedFlowThroughTime = lastSample?.flowThroughTime ?? 0;
  if (failures.length === 0 && achievedFlowThroughTime < targetFlowThroughTime) {
    failures.push(
      `Case ${definition.id} ended at ${achievedFlowThroughTime} flow-through time; ${targetFlowThroughTime} was required.`,
    );
  }

  const sampleWindow = samples.filter(
    (sample) => sample.flowThroughTime > definition.protocol.warmUpFlowThroughTime,
  );
  const warmUpEnd = lastAtOrBefore(samples, definition.protocol.warmUpFlowThroughTime);
  const periodicWindow = warmUpEnd === undefined ? sampleWindow : [warmUpEnd, ...sampleWindow];
  const measuredRegime =
    failures.length === 0
      ? classify(definition, sampleWindow, periodicWindow)
      : undefined;
  const metrics = calculateMetrics(
    definition,
    warmUpEnd,
    sampleWindow,
    measuredRegime,
    failures,
  );
  const availability = failures.length === 0 ? "available" : "unavailable";
  const regime = availability === "available" ? measuredRegime : undefined;

  if (regime !== undefined && !definition.expectedRegimes.includes(regime)) {
    failures.push(
      `Case ${definition.id} measured regime ${regime}; expected ${definition.expectedRegimes.join(" or ")}.`,
    );
  }

  for (const [metric, evidence] of Object.entries(metrics)) {
    if (evidence.status === "fail") {
      failures.push(evidence.message ?? `${metric} failed its declared expectation.`);
    }
  }

  return {
    schemaVersion: VALIDATION_SCHEMA_VERSION,
    caseId: definition.id,
    reynoldsNumber: definition.reynoldsNumber,
    configuration: definition.configuration,
    definition: {
      schemaVersion: definition.schemaVersion,
      physicalScenario: definition.physicalScenario,
      expectedRegimes: definition.expectedRegimes,
      protocol: definition.protocol,
      health: definition.health,
      classification: definition.classification,
    },
    status: failures.length === 0 ? "pass" : "fail",
    availability,
    ...(regime === undefined ? {} : { regime }),
    achieved: {
      steps: lastSample?.step ?? 0,
      flowThroughTime: achievedFlowThroughTime,
      warmUpFlowThroughTime: Math.min(
        achievedFlowThroughTime,
        definition.protocol.warmUpFlowThroughTime,
      ),
      sampleFlowThroughTime: Math.max(
        0,
        achievedFlowThroughTime - definition.protocol.warmUpFlowThroughTime,
      ),
    },
    metrics,
    failures,
  };
}

function numericalSampleFailure(
  sample: ValidationSample,
  definition: ValidationCaseDefinition,
  previous: ValidationSample | undefined,
): string | undefined {
  const nonFiniteValueCount = sample.density.nonFiniteValueCount ?? 0;
  const nonPositiveValueCount = sample.density.nonPositiveValueCount ?? 0;
  const values = [
    sample.step,
    sample.flowThroughTime,
    sample.domainMass,
    sample.inletFlux,
    sample.outletFlux,
    sample.density.minimum,
    sample.density.maximum,
    sample.density.mean,
    nonFiniteValueCount,
    nonPositiveValueCount,
    sample.upstreamReflection,
    sample.fieldResidual,
    sample.symmetryError,
    sample.dragCoefficient,
    sample.liftCoefficient,
    ...(sample.recirculationLength === undefined ? [] : [sample.recirculationLength]),
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    return `Case ${definition.id} became unavailable at step ${sample.step}: a diagnostic was non-finite.`;
  }
  if (!Number.isInteger(nonFiniteValueCount) || nonFiniteValueCount < 0) {
    return `Case ${definition.id} became unavailable at step ${sample.step}: non-finite value count ${nonFiniteValueCount} was invalid.`;
  }
  if (!Number.isInteger(nonPositiveValueCount) || nonPositiveValueCount < 0) {
    return `Case ${definition.id} became unavailable at step ${sample.step}: non-positive density count ${nonPositiveValueCount} was invalid.`;
  }
  if (nonFiniteValueCount > 0) {
    return `Case ${definition.id} became unavailable at step ${sample.step}: ${nonFiniteValueCount} field values were non-finite.`;
  }
  if (nonPositiveValueCount > 0) {
    return `Case ${definition.id} became unavailable at step ${sample.step}: ${nonPositiveValueCount} density values were non-positive.`;
  }
  if (sample.density.minimum <= 0) {
    return `Case ${definition.id} became unavailable at step ${sample.step}: minimum density ${sample.density.minimum} was not positive.`;
  }
  if (
    sample.density.minimum < definition.health.densityRange.minimum ||
    sample.density.maximum > definition.health.densityRange.maximum
  ) {
    return `Case ${definition.id} became unavailable at step ${sample.step}: density [${sample.density.minimum}, ${sample.density.maximum}] was outside [${definition.health.densityRange.minimum}, ${definition.health.densityRange.maximum}].`;
  }
  if (
    previous !== undefined &&
    (sample.step <= previous.step || sample.flowThroughTime <= previous.flowThroughTime)
  ) {
    return `Case ${definition.id} became unavailable: steps and flow-through time must increase monotonically.`;
  }
  if (previous === undefined && Math.abs(sample.flowThroughTime) > samplingTolerance(1)) {
    return `Case ${definition.id} must begin at zero flow-through time from uniform incoming flow.`;
  }
  if (previous !== undefined) {
    const interval = sample.flowThroughTime - previous.flowThroughTime;
    if (
      Math.abs(interval - definition.protocol.sampleInterval) >
      samplingTolerance(definition.protocol.sampleInterval)
    ) {
      return `Case ${definition.id} sampled at interval ${interval}; declared interval ${definition.protocol.sampleInterval}.`;
    }
  }
  return undefined;
}

function calculateMetrics(
  definition: ValidationCaseDefinition,
  warmUpEnd: ValidationSample | undefined,
  samples: readonly ValidationSample[],
  regime: FlowRegime | undefined,
  caseFailures: string[],
): Readonly<Record<string, MetricEvidence>> {
  if (warmUpEnd === undefined || samples.length === 0) {
    return {};
  }

  const meanDensity = mean(samples.map((sample) => sample.density.mean));
  const densityDrift = formatNumber(
    Math.abs(meanDensity - definition.health.targetDensity),
  );
  if (densityDrift > definition.health.maximumMeanDensityDrift) {
    caseFailures.push(
      `Case ${definition.id} mean density drift ${densityDrift} exceeded ${definition.health.maximumMeanDensityDrift}.`,
    );
  }

  const end = samples.at(-1);
  if (end === undefined) {
    return {};
  }
  const fluxResidual = reconcileDomainMass({
    initialMass: warmUpEnd.domainMass,
    finalMass: end.domainMass,
    samples: [warmUpEnd, ...samples],
  }).normalizedResidual;
  if (Math.abs(fluxResidual) > definition.health.maximumFluxResidual) {
    caseFailures.push(
      `Case ${definition.id} normalized flux residual ${fluxResidual} exceeded ${definition.health.maximumFluxResidual}.`,
    );
  }

  const upstreamReflection = Math.max(...samples.map((sample) => Math.abs(sample.upstreamReflection)));
  if (upstreamReflection > definition.health.maximumUpstreamReflection) {
    caseFailures.push(
      `Case ${definition.id} upstream reflection ${upstreamReflection} exceeded ${definition.health.maximumUpstreamReflection}.`,
    );
  }

  const measured: Partial<Record<ObservableMetric, number>> = {
    densityMinimum: Math.min(...samples.map((sample) => sample.density.minimum)),
    densityMaximum: Math.max(...samples.map((sample) => sample.density.maximum)),
    meanDensity,
    meanDensityDrift: densityDrift,
    nonFiniteValueCount: samples.reduce(
      (total, sample) => total + (sample.density.nonFiniteValueCount ?? 0),
      0,
    ),
    nonPositiveDensityCount: samples.reduce(
      (total, sample) => total + (sample.density.nonPositiveValueCount ?? 0),
      0,
    ),
    fluxResidual,
    upstreamReflection,
    fieldResidual: Math.max(...samples.map((sample) => Math.abs(sample.fieldResidual))),
    symmetryError: Math.max(...samples.map((sample) => Math.abs(sample.symmetryError))),
    meanDragCoefficient: mean(samples.map((sample) => sample.dragCoefficient)),
    dragRelativeVariation: relativeVariation(
      samples.map((sample) => sample.dragCoefficient),
    ),
    liftRms: rootMeanSquare(samples.map((sample) => sample.liftCoefficient)),
  };
  const periodic = analyseLiftSignal([warmUpEnd, ...samples], liftThresholds(definition));
  assignFiniteMetric(measured, "periodicCycleCount", periodic.cycles);
  assignFiniteMetric(measured, "dominantFrequency", periodic.dominantFrequency);
  assignFiniteMetric(measured, "frequencyVariation", periodic.frequencyVariation);
  assignFiniteMetric(measured, "amplitudeVariation", periodic.amplitudeVariation);
  assignFiniteMetric(measured, "frequencyUncertainty", periodic.frequencyUncertainty);
  if (periodic.stable) {
    measured.strouhalNumber = periodic.strouhalNumber;
  }
  const recirculation = samples
    .map((sample) => sample.recirculationLength)
    .filter((value): value is number => value !== undefined);
  if (recirculation.length === samples.length) {
    measured.recirculationLength = mean(recirculation);
  }

  const evidence: Record<string, MetricEvidence> = {};
  for (const expectation of definition.expectations) {
    evidence[expectation.metric] = expectationEvidence(
      definition.id,
      expectation,
      regime,
      measured[expectation.metric],
    );
  }
  if (evidence.strouhalNumber === undefined && measured.strouhalNumber === undefined) {
    evidence.strouhalNumber = {
      schemaVersion: VALIDATION_SCHEMA_VERSION,
      applicability: "inapplicable",
      status: "not-assessed",
      message: "Strouhal number is inapplicable without a stable periodic lift signal.",
    };
  }
  return evidence;
}

function expectationEvidence(
  caseId: string,
  expectation: MetricExpectation,
  regime: FlowRegime | undefined,
  measured: number | undefined,
): MetricEvidence {
  if (
    regime !== undefined &&
    expectation.applicableRegimes !== undefined &&
    !expectation.applicableRegimes.includes(regime)
  ) {
    return {
      schemaVersion: VALIDATION_SCHEMA_VERSION,
      applicability: "inapplicable",
      ...(measured === undefined ? {} : { measured }),
      status: "not-assessed",
      message: `${metricLabel(expectation.metric)} is inapplicable when the measured regime is ${regime}.`,
    };
  }
  if (measured === undefined) {
    return {
      schemaVersion: VALIDATION_SCHEMA_VERSION,
      applicability: "applicable",
      status: "fail",
      expected: expectation.range,
      tolerance: expectation.tolerance,
      sources: expectation.sources,
      message: `Case ${caseId}: ${expectation.metric} was required but could not be measured.`,
    };
  }
  const accepted = expand(expectation.range, expectation.tolerance);
  const status = inRange(measured, accepted) ? "pass" : "fail";
  return {
    schemaVersion: VALIDATION_SCHEMA_VERSION,
    applicability: "applicable",
    measured,
    expected: expectation.range,
    tolerance: expectation.tolerance,
    sources: expectation.sources,
    status,
    ...(status === "fail"
      ? {
          message: `Case ${caseId}: ${expectation.metric} measured ${measured}; expected [${expectation.range.minimum}, ${expectation.range.maximum}] with tolerance ${expectation.tolerance}.`,
        }
      : {}),
  };
}

function classify(
  definition: ValidationCaseDefinition,
  steadySamples: readonly ValidationSample[],
  periodicSamples: readonly ValidationSample[],
): FlowRegime {
  if (steadySamples.length === 0) {
    return "developing";
  }
  const maximumFieldResidual = Math.max(
    ...steadySamples.map((sample) => sample.fieldResidual),
  );
  const maximumSymmetryError = Math.max(
    ...steadySamples.map((sample) => sample.symmetryError),
  );
  const liftRms = rootMeanSquare(
    steadySamples.map((sample) => sample.liftCoefficient),
  );
  const dragValues = steadySamples.map((sample) => sample.dragCoefficient);
  const meanDrag = mean(dragValues);
  const dragRelativeVariation =
    (Math.max(...dragValues) - Math.min(...dragValues)) /
    Math.max(Math.abs(meanDrag), Number.EPSILON);
  if (
    maximumFieldResidual <= definition.classification.maximumSteadyFieldResidual &&
    maximumSymmetryError <= definition.classification.maximumSteadySymmetryError &&
    liftRms <= definition.classification.maximumSteadyLiftRms &&
    dragRelativeVariation <= definition.classification.maximumSteadyDragRelativeVariation
  ) {
    return "steady";
  }
  if (analyseLiftSignal(periodicSamples, liftThresholds(definition)).stable) {
    // Regime is measured flow behaviour; published quantitative ranges determine
    // case pass/fail through metric evidence without relabelling periodic shedding.
    return "periodically-shedding";
  }
  return "unclassified";
}

function liftThresholds(definition: ValidationCaseDefinition) {
  return {
    minimumCycles: Math.max(
      definition.classification.minimumPeriodicCycles,
      definition.protocol.minimumStableCycles ?? 0,
    ),
    minimumAmplitude: definition.classification.minimumPeriodicAmplitude ?? Number.EPSILON,
    maximumFrequencyVariation: definition.classification.maximumPeriodicFrequencyVariation,
    maximumAmplitudeVariation: definition.classification.maximumPeriodicAmplitudeVariation,
  };
}

function lastAtOrBefore(
  samples: readonly ValidationSample[],
  flowThroughTime: number,
): ValidationSample | undefined {
  let match: ValidationSample | undefined;
  for (const sample of samples) {
    if (sample.flowThroughTime <= flowThroughTime) {
      match = sample;
    }
  }
  return match;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function rootMeanSquare(values: readonly number[]): number {
  return Math.sqrt(mean(values.map((value) => value * value)));
}

function metricLabel(metric: ObservableMetric): string {
  if (metric === "strouhalNumber") {
    return "Strouhal number";
  }
  return metric.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
}

function relativeVariation(values: readonly number[]): number {
  const average = mean(values);
  return (
    (Math.max(...values) - Math.min(...values)) /
    Math.max(Math.abs(average), Number.EPSILON)
  );
}

function expand(range: InclusiveRange, tolerance: number): InclusiveRange {
  return { minimum: range.minimum - tolerance, maximum: range.maximum + tolerance };
}

function inRange(value: number, range: InclusiveRange): boolean {
  return value >= range.minimum && value <= range.maximum;
}

function sortedRecord(record: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function assignFiniteMetric(
  measured: Partial<Record<ObservableMetric, number>>,
  metric: ObservableMetric,
  value: number,
): void {
  if (Number.isFinite(value)) {
    measured[metric] = value;
  }
}

function formatNumber(value: number): number {
  return Number(value.toPrecision(12));
}

function samplingTolerance(interval: number): number {
  return Math.max(1e-12, Math.abs(interval) * 1e-9);
}
