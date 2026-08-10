import { describe, expect, it } from "vitest";

import {
  BUNDLED_QUALITY_TIERS,
  changeManualTier,
  selectBenchmarkTier,
  selectManualTier,
} from "../src/engine/quality-tiers.js";
import { serializeValidationManifest } from "../src/validation/manifest-schema.js";

describe("bundled validated quality tiers", () => {
  it("publishes exact CPU and WebGPU identities backed by complete passing evidence", () => {
    expect(
      BUNDLED_QUALITY_TIERS.map(({ identity }) => ({
        id: identity.id,
        backendId: identity.backendId,
        buildId: identity.buildId,
      })),
    ).toEqual([
      {
        id: "cpu-balanced-d18",
        backendId: "cpu-reference",
        buildId: "ticket-06",
      },
      {
        id: "webgpu-balanced-d18",
        backendId: "webgpu-reference",
        buildId: "ticket-08",
      },
    ]);

    for (const tier of BUNDLED_QUALITY_TIERS) {
      expect(serializeValidationManifest(tier.manifest)).toBe(
        `${JSON.stringify(tier.manifest, undefined, 2)}\n`,
      );
      expect(tier.manifest.suite.qualityTier).toMatchObject({
        id: tier.identity.id,
        cellsPerDiameter: tier.identity.cellsPerDiameter,
        defaultPlaybackRate: tier.identity.defaultPlaybackRate,
        performance: {
          benchmarkVersion: "local-fixed-step-throughput-v1",
          maximumGuideDurationSeconds: 90,
        },
      });
      expect(tier.validation).toMatchObject({
        status: "validated",
        evidenceState: "passing",
        backendId: tier.identity.backendId,
        qualityTier: tier.identity.id,
        buildId: tier.identity.buildId,
      });
      expect(
        new Set(tier.manifest.reconciliations.map(({ kind }) => kind)),
      ).toEqual(
        new Set(["grid", "cylinder-placement", "domain", "boundary", "backend"]),
      );
      expect(
        tier.manifest.cases
          .filter(({ caseId }) => caseId.startsWith("open-cylinder-re"))
          .map(({ reynoldsNumber }) => reynoldsNumber),
      ).toEqual([5, 20, 40, 45, 50, 100, 150]);
    }
  });

  it("selects only benchmarked bundled identities and rejects invented manual tiers", async () => {
    const selected = await selectBenchmarkTier({
      benchmark: async ({ id }) => ({
        status: "supported",
        flowThroughTimePerSecond: id === "webgpu-balanced-d18" ? 2.4 : 1.3,
      }),
    });

    expect(selected.identity.id).toBe("webgpu-balanced-d18");
    expect(selectManualTier("cpu-balanced-d18").identity.id).toBe("cpu-balanced-d18");
    expect(() => selectManualTier("webgpu-invented-d64")).toThrow(
      "is not a bundled validated quality tier",
    );
  });

  it("falls back to CPU when WebGPU is unsupported", async () => {
    const selected = await selectBenchmarkTier({
      benchmark: async ({ id }) =>
        id === "webgpu-balanced-d18"
          ? { status: "unsupported", reason: "missing-adapter" }
          : { status: "supported", flowThroughTimePerSecond: 1.3 },
    });

    expect(selected.identity.id).toBe("cpu-balanced-d18");
  });

  it("rejects a backend that is present but misses its validated pace", async () => {
    const selected = await selectBenchmarkTier({
      benchmark: async ({ id }) => ({
        status: "supported",
        flowThroughTimePerSecond: id === "webgpu-balanced-d18" ? 1.9 : 1.3,
      }),
    });

    expect(selected.identity.id).toBe("cpu-balanced-d18");
  });

  it("makes a manual tier change explicit and restarts with the bundled identity", () => {
    const restarted: string[] = [];

    const selected = changeManualTier("webgpu-balanced-d18", (identity) => {
      restarted.push(`${identity.backendId}/${identity.id}/${identity.buildId}`);
    });

    expect(selected.identity.id).toBe("webgpu-balanced-d18");
    expect(restarted).toEqual([
      "webgpu-reference/webgpu-balanced-d18/ticket-08",
    ]);
    expect(() => changeManualTier("custom", () => undefined)).toThrow();
  });
});
