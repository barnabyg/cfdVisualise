import { BUNDLED_TIER_EVIDENCE } from "../engine/quality-tiers.js";
import type { QualityTierIdentity } from "../engine/protocol.js";
import { MethodAndValidation } from "../validation/method-and-validation-surface.js";

export function TierEvidencePanel({ active }: { readonly active: QualityTierIdentity }) {
  const bundled = BUNDLED_TIER_EVIDENCE.find(
    ({ identity }) =>
      identity.id === active.id &&
      identity.backendId === active.backendId &&
      identity.buildId === active.buildId,
  );
  return (
    <MethodAndValidation
      manifest={bundled?.manifest}
      active={{
        backendId: active.backendId,
        qualityTier: active.id,
        buildId: active.buildId,
      }}
    />
  );
}
