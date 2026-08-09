import type { CaseManifest } from "../validation/types.js";
import {
  CPU_PRODUCTION_MANIFEST,
  CPU_PRODUCTION_TIER,
} from "./cpu-tier.js";

const CANONICAL_REYNOLDS_NUMBERS = Object.freeze([5, 20, 40, 45, 50, 100, 150] as const);

export const CPU_PRODUCTION_CANONICAL_CASES = Object.freeze(
  CANONICAL_REYNOLDS_NUMBERS.map(canonicalCase),
);
export const CPU_PRODUCTION_STEADY_CASE = canonicalCaseForReynolds(20);
export const CPU_PRODUCTION_PERIODIC_CASE = canonicalCaseForReynolds(100);

export function canonicalCaseForReynolds(reynoldsNumber: number): CaseManifest {
  return CPU_PRODUCTION_CANONICAL_CASES.reduce((nearest, candidate) =>
    Math.abs(candidate.reynoldsNumber - reynoldsNumber) <
    Math.abs(nearest.reynoldsNumber - reynoldsNumber)
      ? candidate
      : nearest,
  );
}

function canonicalCase(reynoldsNumber: number): CaseManifest {
  const result = CPU_PRODUCTION_MANIFEST.cases.find(
    (candidate) =>
      candidate.reynoldsNumber === reynoldsNumber &&
      candidate.caseId === `open-cylinder-re${String(reynoldsNumber).padStart(3, "0")}` &&
      candidate.configuration.qualityTier === CPU_PRODUCTION_TIER.id,
  );
  if (result === undefined || result.status !== "pass" || result.regime === undefined) {
    throw new Error(
      `Bundled CPU production evidence lacks a passing canonical Re=${reynoldsNumber} case.`,
    );
  }
  if (
    result.configuration.cylinder.cellsPerDiameter !==
      CPU_PRODUCTION_TIER.cellsPerDiameter ||
    result.configuration.backendId !== CPU_PRODUCTION_TIER.backendId
  ) {
    throw new Error(
      `Bundled CPU production Re=${reynoldsNumber} configuration does not match the active tier.`,
    );
  }
  return result;
}
