import { completeValidationEvidenceProblem } from "../validation/manifest-consumers.js";
import { parseValidationManifest } from "../validation/manifest-schema.js";
import type { ValidationManifest } from "../validation/types.js";
import type { QualityTierIdentity } from "./protocol.js";

export interface ReleaseTierEvidence {
  readonly identity: QualityTierIdentity;
  readonly manifest: ValidationManifest;
}

export interface GuidePerformanceMeasurement {
  readonly schemaVersion: "1";
  readonly backendId: string;
  readonly qualityTier: string;
  readonly browser: string;
  readonly guideDurationSeconds: number;
}

export interface ReleaseGateReport {
  readonly schemaVersion: "1";
  readonly status: "pass" | "fail";
  readonly tiers: readonly {
    readonly backendId: string;
    readonly qualityTier: string;
    readonly buildId: string;
    readonly validation: {
      readonly status: "pass" | "fail";
      readonly failures: readonly string[];
    };
    readonly performance: {
      readonly status: "pass" | "fail";
      readonly maximumGuideDurationSeconds: number;
      readonly gateBrowsers: readonly string[];
      readonly measurements: readonly GuidePerformanceMeasurement[];
      readonly failures: readonly string[];
    };
  }[];
}

export function parseGuidePerformanceMeasurement(
  input: unknown,
): GuidePerformanceMeasurement {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Guide performance evidence must be an object.");
  }
  const candidate = input as Record<string, unknown>;
  if (candidate.schemaVersion !== "1") {
    throw new TypeError("Guide performance evidence schemaVersion must be 1.");
  }
  for (const field of ["backendId", "qualityTier", "browser"] as const) {
    if (typeof candidate[field] !== "string" || candidate[field].length === 0) {
      throw new TypeError(`Guide performance evidence ${field} must be a non-empty string.`);
    }
  }
  if (
    typeof candidate.guideDurationSeconds !== "number" ||
    !Number.isFinite(candidate.guideDurationSeconds) ||
    candidate.guideDurationSeconds < 0
  ) {
    throw new TypeError(
      "Guide performance evidence guideDurationSeconds must be a finite non-negative number.",
    );
  }
  return {
    schemaVersion: "1",
    backendId: candidate.backendId as string,
    qualityTier: candidate.qualityTier as string,
    browser: candidate.browser as string,
    guideDurationSeconds: candidate.guideDurationSeconds,
  };
}

export function createReleaseGateReport(
  tiers: readonly ReleaseTierEvidence[],
  measurements: readonly GuidePerformanceMeasurement[],
): ReleaseGateReport {
  const tierResults = tiers.map(({ identity, manifest }) => {
    const validation = evaluateValidationEvidence(identity, manifest);
    const qualityTier = manifest.suite.qualityTier;
    const maximumGuideDurationSeconds =
      qualityTier?.performance.maximumGuideDurationSeconds ?? 90;
    const reportedBrowsers =
      manifest.backend.kind === "cpu-worker"
        ? ["chromium", "firefox", "webkit"]
        : ["firefox"];
    const requiredBrowsers = reportedBrowsers;
    const tierMeasurements = measurements.filter(
      (measurement) =>
        measurement.backendId === identity.backendId &&
        measurement.qualityTier === identity.id,
    );
    const performanceFailures: string[] = [];
    const reportedMeasurements: GuidePerformanceMeasurement[] = [];
    for (const browser of reportedBrowsers) {
      const browserMeasurements = tierMeasurements.filter(
        (measurement) => measurement.browser === browser,
      );
      if (browserMeasurements.length === 0) {
        if (requiredBrowsers.includes(browser)) {
          performanceFailures.push(
            `Missing ${identity.id} guide measurement for ${browser}.`,
          );
        }
        continue;
      }
      if (browserMeasurements.length > 1) {
        performanceFailures.push(
          `${identity.id} has ${browserMeasurements.length} guide measurements for ${browser}; expected exactly one.`,
        );
        continue;
      }
      const measurement = browserMeasurements[0]!;
      reportedMeasurements.push(measurement);
      const isRequired = requiredBrowsers.includes(browser);
      if (
        isRequired &&
        (!Number.isFinite(measurement.guideDurationSeconds) ||
          measurement.guideDurationSeconds < 0 ||
          measurement.guideDurationSeconds > maximumGuideDurationSeconds)
      ) {
        performanceFailures.push(
          `${identity.id} guide on ${browser} took ${formatDuration(measurement.guideDurationSeconds)}s; maximum is ${maximumGuideDurationSeconds}s.`,
        );
      }
    }
    const performance = {
      status: performanceFailures.length === 0 ? "pass" : "fail",
      maximumGuideDurationSeconds,
      gateBrowsers: requiredBrowsers,
      measurements: reportedMeasurements,
      failures: performanceFailures,
    } as const;
    return {
      backendId: identity.backendId,
      qualityTier: identity.id,
      buildId: identity.buildId,
      validation,
      performance,
    };
  });
  return {
    schemaVersion: "1",
    status: tierResults.every(
      ({ validation, performance }) =>
        validation.status === "pass" && performance.status === "pass",
    )
      ? "pass"
      : "fail",
    tiers: tierResults,
  };
}

function evaluateValidationEvidence(
  identity: QualityTierIdentity,
  input: ValidationManifest,
): ReleaseGateReport["tiers"][number]["validation"] {
  let manifest: ValidationManifest;
  try {
    manifest = parseValidationManifest(input);
  } catch (error) {
    return {
      status: "fail",
      failures: [
        `Validation evidence is incompatible: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  const declaredFailures = [
    ...manifest.cases.flatMap(({ failures }) => failures),
    ...manifest.reconciliations.flatMap(({ failures }) => failures),
  ];
  if (manifest.status === "fail") {
    return {
      status: "fail",
      failures:
        declaredFailures.length > 0
          ? declaredFailures
          : ["Validation manifest is failing without actionable case evidence."],
    };
  }
  const active = {
    backendId: identity.backendId,
    qualityTier: identity.id,
    buildId: identity.buildId,
  };
  const completenessProblem = completeValidationEvidenceProblem(manifest, active);
  const qualityTier = manifest.suite.qualityTier;
  const identityProblem =
    qualityTier === undefined ||
    qualityTier.id !== identity.id ||
    qualityTier.cellsPerDiameter !== identity.cellsPerDiameter ||
    qualityTier.defaultPlaybackRate !== identity.defaultPlaybackRate
      ? `Validation evidence does not match the shipped ${identity.id} configuration.`
      : undefined;
  const failures = [
    ...(completenessProblem === undefined
      ? []
      : [`Validation evidence is incomplete: ${completenessProblem}.`]),
    ...(identityProblem === undefined ? [] : [identityProblem]),
  ];
  return failures.length === 0
    ? { status: "pass", failures: [] }
    : { status: "fail", failures };
}

function formatDuration(durationSeconds: number): string {
  return Number.isFinite(durationSeconds) ? durationSeconds.toFixed(2) : String(durationSeconds);
}
