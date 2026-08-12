import { BUNDLED_TIER_EVIDENCE } from "../engine/quality-tiers.js";
import type { QualityTierIdentity } from "../engine/protocol.js";
import { createMethodAndValidationModel } from "../validation/manifest-consumers.js";
import { MethodAndValidationSurface } from "../validation/method-and-validation-surface.js";
import styles from "./instrument-app.module.css";

export function TierEvidencePanel({ active }: { readonly active: QualityTierIdentity }) {
  const bundled = BUNDLED_TIER_EVIDENCE.find(
    ({ identity }) =>
      identity.id === active.id &&
      identity.backendId === active.backendId &&
      identity.buildId === active.buildId,
  );
  const model = createMethodAndValidationModel(bundled?.manifest, {
    backendId: active.backendId,
    qualityTier: active.id,
    buildId: active.buildId,
  });

  return (
    <details class={styles.evidence} data-evidence-state={model.evidenceState}>
      <summary>
        <span>Method and validation</span>
        <span class={styles.evidenceStatus}>
          {model.status === "validated" ? "Evidence passed" : "Evidence unavailable"}
        </span>
      </summary>
      <MethodAndValidationSurface model={model} />
    </details>
  );
}
