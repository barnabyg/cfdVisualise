import webGpuManifestInput from "../validation/webgpu-backend-manifest.json";
import {
  completeValidationEvidenceProblem,
  createMethodAndValidationModel,
  type MethodAndValidationModel,
} from "../validation/manifest-consumers.js";
import { parseValidationManifest } from "../validation/manifest-schema.js";
import {
  WEBGPU_BACKEND_QUALITY_TIER_ID,
  WEBGPU_PRODUCTION_DEFAULT_PLAYBACK_RATE,
} from "../validation/webgpu-reference.js";
import type { ValidationManifest } from "../validation/types.js";
import { WEBGPU_BACKEND_IDENTITY } from "../validation/webgpu-backend.js";
import {
  CPU_PRODUCTION_MANIFEST,
  CPU_PRODUCTION_TIER,
} from "./cpu-tier.js";
import type { QualityTierIdentity } from "./protocol.js";

export interface BundledQualityTier {
  readonly identity: QualityTierIdentity;
  readonly manifest: ValidationManifest;
  readonly validation: Extract<MethodAndValidationModel, { readonly status: "validated" }>;
}

export type TierBenchmarkResult =
  | {
      readonly status: "supported";
      readonly flowThroughTimePerSecond: number;
    }
  | {
      readonly status: "unsupported";
      readonly reason: string;
    };

export interface SelectBenchmarkTierOptions {
  readonly benchmark: (
    identity: QualityTierIdentity,
  ) => Promise<TierBenchmarkResult>;
  readonly tiers?: readonly BundledQualityTier[];
}

const WEBGPU_PRODUCTION_MANIFEST = parseValidationManifest(webGpuManifestInput);
const WEBGPU_QUALITY_EVIDENCE = WEBGPU_PRODUCTION_MANIFEST.suite.qualityTier;
if (WEBGPU_QUALITY_EVIDENCE === undefined) {
  throw new Error("Bundled WebGPU evidence does not identify its quality-tier configuration.");
}

export const WEBGPU_PRODUCTION_TIER = Object.freeze({
  id: WEBGPU_BACKEND_QUALITY_TIER_ID,
  backendId: WEBGPU_BACKEND_IDENTITY.id,
  buildId: WEBGPU_BACKEND_IDENTITY.buildId,
  label: "WebGPU balanced",
  cellsPerDiameter: WEBGPU_QUALITY_EVIDENCE.cellsPerDiameter,
  defaultPlaybackRate: WEBGPU_QUALITY_EVIDENCE.defaultPlaybackRate,
} satisfies QualityTierIdentity);

if (WEBGPU_PRODUCTION_TIER.defaultPlaybackRate !== WEBGPU_PRODUCTION_DEFAULT_PLAYBACK_RATE) {
  throw new Error("Bundled WebGPU evidence has an unexpected advancement pace.");
}

export const BUNDLED_TIER_EVIDENCE = Object.freeze([
  Object.freeze({ identity: CPU_PRODUCTION_TIER, manifest: CPU_PRODUCTION_MANIFEST }),
  Object.freeze({ identity: WEBGPU_PRODUCTION_TIER, manifest: WEBGPU_PRODUCTION_MANIFEST }),
]);

export const BUNDLED_QUALITY_TIERS = Object.freeze(
  BUNDLED_TIER_EVIDENCE.map(({ identity, manifest }) =>
    validatedBundledTier(identity, manifest),
  ).filter((tier): tier is BundledQualityTier => tier !== undefined),
);

export function selectManualTier(
  tierId: string,
  tiers: readonly BundledQualityTier[] = BUNDLED_QUALITY_TIERS,
): BundledQualityTier {
  const tier = tiers.find(({ identity }) => identity.id === tierId);
  if (tier === undefined) {
    throw new RangeError(`${tierId} is not a bundled validated quality tier.`);
  }
  return tier;
}

export function changeManualTier(
  tierId: string,
  restartExperiment: (identity: QualityTierIdentity) => void,
  tiers: readonly BundledQualityTier[] = BUNDLED_QUALITY_TIERS,
): BundledQualityTier {
  const tier = selectManualTier(tierId, tiers);
  restartExperiment(tier.identity);
  return tier;
}

export async function selectBenchmarkTier({
  benchmark,
  tiers = BUNDLED_QUALITY_TIERS,
}: SelectBenchmarkTierOptions): Promise<BundledQualityTier> {
  const results: {
    readonly tier: BundledQualityTier;
    readonly result: TierBenchmarkResult;
  }[] = [];
  // Run one backend at a time so software-backed GPU work cannot distort the CPU result.
  for (const tier of tiers) {
    results.push({ tier, result: await benchmark(tier.identity) });
  }
  const supported = results
    .filter(
      (
        candidate,
      ): candidate is {
        readonly tier: BundledQualityTier;
        readonly result: Extract<TierBenchmarkResult, { readonly status: "supported" }>;
      } =>
        candidate.result.status === "supported" &&
        Number.isFinite(candidate.result.flowThroughTimePerSecond) &&
        candidate.result.flowThroughTimePerSecond >=
          candidate.tier.manifest.suite.qualityTier!.performance
            .minimumFlowThroughTimePerSecond,
    )
    .sort(
      (left, right) =>
        right.result.flowThroughTimePerSecond - left.result.flowThroughTimePerSecond,
    );
  const selected = supported[0]?.tier;
  if (selected === undefined) {
    const diagnostics = results.map(({ tier, result }) =>
      result.status === "unsupported"
        ? `${tier.identity.id}: ${result.reason}`
        : `${tier.identity.id}: measured ${result.flowThroughTimePerSecond.toFixed(3)} D/U/s, requires ${tier.manifest.suite.qualityTier!.performance.minimumFlowThroughTimePerSecond}`,
    );
    throw new Error(
      `No bundled validated quality tier is supported on this device. ${diagnostics.join("; ")}`,
    );
  }
  return selected;
}

function validatedBundledTier(
  identity: QualityTierIdentity,
  manifest: ValidationManifest,
): BundledQualityTier | undefined {
  const active = {
    backendId: identity.backendId,
    qualityTier: identity.id,
    buildId: identity.buildId,
  };
  const validation = createMethodAndValidationModel(manifest, active);
  if (validation.status === "unavailable") return undefined;
  const incompleteReason = completeValidationEvidenceProblem(manifest, active);
  const qualityTier = manifest.suite.qualityTier;
  if (
    incompleteReason !== undefined ||
    qualityTier === undefined ||
    qualityTier.id !== identity.id ||
    qualityTier.cellsPerDiameter !== identity.cellsPerDiameter ||
    qualityTier.defaultPlaybackRate !== identity.defaultPlaybackRate
  ) return undefined;
  return Object.freeze({ identity, manifest, validation });
}
