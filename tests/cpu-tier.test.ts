import { describe, expect, it } from "vitest";

import {
  CPU_PRODUCTION_MANIFEST,
  CPU_PRODUCTION_TIER,
  CPU_PRODUCTION_VALIDATION,
} from "../src/engine/cpu-tier.js";
import {
  CPU_PRODUCTION_CANONICAL_CASES,
  canonicalCaseForReynolds,
} from "../src/engine/cpu-production-contract.js";

describe("bundled CPU production tier", () => {
  it("consumes exact passing manifest evidence for the active D18 build", () => {
    expect(CPU_PRODUCTION_MANIFEST.status).toBe("pass");
    expect(CPU_PRODUCTION_VALIDATION).toMatchObject({
      status: "validated",
      evidenceState: "passing",
      backendId: CPU_PRODUCTION_TIER.backendId,
      qualityTier: CPU_PRODUCTION_TIER.id,
      buildId: CPU_PRODUCTION_TIER.buildId,
    });
    if (CPU_PRODUCTION_VALIDATION.status !== "validated") {
      throw new Error(CPU_PRODUCTION_VALIDATION.reason);
    }
    expect(
      CPU_PRODUCTION_VALIDATION.referenceCases.map(({ reynoldsNumber }) => reynoldsNumber),
    ).toEqual([5, 20, 40, 45, 50, 100, 150]);
    expect(
      CPU_PRODUCTION_VALIDATION.referenceCases.every(({ metrics }) =>
        Object.values(metrics).every(({ status }) => status !== "fail"),
      ),
    ).toBe(true);
    expect(
      new Set(
        CPU_PRODUCTION_MANIFEST.reconciliations
          .filter(({ status }) => status === "pass")
          .map(({ kind }) => kind),
      ),
    ).toEqual(
      new Set(["grid", "cylinder-placement", "domain", "boundary", "backend"]),
    );
    expect(CPU_PRODUCTION_CANONICAL_CASES.map(({ reynoldsNumber }) => reynoldsNumber)).toEqual([
      5, 20, 40, 45, 50, 100, 150,
    ]);
    expect(canonicalCaseForReynolds(5).definition.health.densityRange.minimum).toBe(0.9);
    expect(canonicalCaseForReynolds(20).definition.health.densityRange.minimum).toBe(0.95);
    expect(canonicalCaseForReynolds(150).definition.health.maximumUpstreamReflection).toBe(0.06);
  });
});
