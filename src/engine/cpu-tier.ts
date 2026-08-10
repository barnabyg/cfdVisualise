import { CPU_REFERENCE_BACKEND_IDENTITY } from "../validation/cpu-reference-backend.js";
import {
  CPU_PRODUCTION_CELLS_PER_DIAMETER,
  CPU_PRODUCTION_DEFAULT_PLAYBACK_RATE,
  CPU_PRODUCTION_QUALITY_TIER_ID,
} from "../validation/cpu-production-config.js";
import { createMethodAndValidationModel } from "../validation/manifest-consumers.js";
import { parseValidationManifest } from "../validation/manifest-schema.js";
import type { CpuQualityTierIdentity } from "./protocol.js";
import manifestInput from "./cpu-production-manifest.json";

export const CPU_PRODUCTION_MANIFEST = parseValidationManifest(manifestInput);

export const CPU_PRODUCTION_TIER = Object.freeze({
  id: CPU_PRODUCTION_QUALITY_TIER_ID,
  backendId: CPU_REFERENCE_BACKEND_IDENTITY.id,
  buildId: CPU_REFERENCE_BACKEND_IDENTITY.buildId,
  label: "CPU balanced",
  cellsPerDiameter: CPU_PRODUCTION_CELLS_PER_DIAMETER,
  defaultPlaybackRate: CPU_PRODUCTION_DEFAULT_PLAYBACK_RATE,
} satisfies CpuQualityTierIdentity);

export const CPU_PRODUCTION_VALIDATION = createMethodAndValidationModel(
  CPU_PRODUCTION_MANIFEST,
  {
    backendId: CPU_PRODUCTION_TIER.backendId,
    qualityTier: CPU_PRODUCTION_TIER.id,
    buildId: CPU_PRODUCTION_TIER.buildId,
  },
);
