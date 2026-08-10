import { describe, expect, it } from "vitest";

import {
  BUNDLED_TIER_EVIDENCE,
} from "../src/engine/quality-tiers.js";
import {
  createReleaseGateReport,
  parseGuidePerformanceMeasurement,
  type GuidePerformanceMeasurement,
  type ReleaseTierEvidence,
} from "../src/engine/release-gates.js";

describe("shipped quality-tier release gates", () => {
  it("reports scientific validation and guide performance separately for every tier", () => {
    const report = createReleaseGateReport(
      BUNDLED_TIER_EVIDENCE,
      passingGuideMeasurements(),
    );

    expect(report.status).toBe("pass");
    expect(report.tiers.map(({ backendId, qualityTier }) => ({ backendId, qualityTier })))
      .toEqual([
        { backendId: "cpu-reference", qualityTier: "cpu-balanced-d18" },
        { backendId: "webgpu-reference", qualityTier: "webgpu-balanced-d18" },
      ]);
    for (const tier of report.tiers) {
      expect(tier.validation).toMatchObject({ status: "pass", failures: [] });
      expect(tier.performance).toMatchObject({
        status: "pass",
        maximumGuideDurationSeconds: 90,
        failures: [],
      });
    }
    expect(report.tiers[0]?.performance.gateBrowsers).toEqual([
      "chromium",
      "firefox",
      "webkit",
    ]);
    expect(report.tiers[1]?.performance.gateBrowsers).toEqual(["firefox"]);
    expect(report.tiers[0]?.performance.measurements.map(({ browser }) => browser))
      .toEqual(["chromium", "firefox", "webkit"]);
    expect(report.tiers[1]?.performance.measurements.map(({ browser }) => browser))
      .toEqual(["firefox"]);
  });

  it("fails performance without hiding passing physical validation", () => {
    const measurements = passingGuideMeasurements().filter(
      ({ qualityTier, browser }) =>
        !(qualityTier === "cpu-balanced-d18" && browser === "webkit"),
    );

    const report = createReleaseGateReport(BUNDLED_TIER_EVIDENCE, measurements);
    const cpu = report.tiers[0]!;

    expect(report.status).toBe("fail");
    expect(cpu.validation.status).toBe("pass");
    expect(cpu.performance).toMatchObject({
      status: "fail",
      failures: ["Missing cpu-balanced-d18 guide measurement for webkit."],
    });
  });

  it("reports every manifest failure without weakening a passing performance result", () => {
    const cpuEvidence = BUNDLED_TIER_EVIDENCE[0]!;
    const caseFailures = [
      "Case open-cylinder-re005: density measured 0; expected (0, 1.1].",
      "Case open-cylinder-re005: flux residual measured 0.2; expected at most 0.01.",
    ];
    const failedManifest = {
      ...cpuEvidence.manifest,
      status: "fail" as const,
      cases: [
        {
          ...cpuEvidence.manifest.cases[0]!,
          status: "fail" as const,
          failures: caseFailures,
        },
        ...cpuEvidence.manifest.cases.slice(1),
      ],
    };
    const failedEvidence: readonly ReleaseTierEvidence[] = [
      { ...cpuEvidence, manifest: failedManifest },
      BUNDLED_TIER_EVIDENCE[1]!,
    ];

    const report = createReleaseGateReport(failedEvidence, passingGuideMeasurements());
    const cpu = report.tiers[0]!;

    expect(report.status).toBe("fail");
    expect(cpu.validation).toEqual({
      status: "fail",
      failures: [
        "Case open-cylinder-re005: density measured 0; expected (0, 1.1].",
        "Case open-cylinder-re005: flux residual measured 0.2; expected at most 0.01.",
      ],
    });
    expect(cpu.performance.status).toBe("pass");
  });

  it("rejects incompatible or non-finite guide evidence", () => {
    expect(() =>
      parseGuidePerformanceMeasurement({
        ...guideMeasurement("cpu-reference", "cpu-balanced-d18", "chromium", 70),
        schemaVersion: "2",
      }),
    ).toThrow("schemaVersion");
    expect(() =>
      parseGuidePerformanceMeasurement({
        ...guideMeasurement("cpu-reference", "cpu-balanced-d18", "chromium", 70),
        guideDurationSeconds: Number.NaN,
      }),
    ).toThrow("guideDurationSeconds");
  });
});

function passingGuideMeasurements(): readonly GuidePerformanceMeasurement[] {
  return [
    guideMeasurement("cpu-reference", "cpu-balanced-d18", "chromium", 70),
    guideMeasurement("cpu-reference", "cpu-balanced-d18", "firefox", 75),
    guideMeasurement("cpu-reference", "cpu-balanced-d18", "webkit", 80),
    guideMeasurement("webgpu-reference", "webgpu-balanced-d18", "firefox", 77),
  ];
}

function guideMeasurement(
  backendId: string,
  qualityTier: string,
  browser: string,
  guideDurationSeconds: number,
): GuidePerformanceMeasurement {
  return {
    schemaVersion: "1",
    backendId,
    qualityTier,
    browser,
    guideDurationSeconds,
  };
}
