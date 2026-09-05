import type { LiftDisplaySample } from "./protocol.js";

export const MAX_LIFT_DISPLAY_SAMPLES = 256;
export const LIFT_DISPLAY_WINDOW = 32;

/** Display-only history; never used by the regime or frequency estimators. */
export class LiftDisplayHistory {
  private samples: LiftDisplaySample[] = [];

  public append(sample: LiftDisplaySample): void {
    if (!Number.isFinite(sample.flowThroughTime) || !Number.isFinite(sample.liftCoefficient)) return;
    const previous = this.samples.at(-1);
    if (previous !== undefined && sample.flowThroughTime <= previous.flowThroughTime) return;
    this.samples = [...this.samples, {
      flowThroughTime: sample.flowThroughTime,
      liftCoefficient: sample.liftCoefficient,
    }].filter((item) => item.flowThroughTime >= sample.flowThroughTime - LIFT_DISPLAY_WINDOW)
      .slice(-MAX_LIFT_DISPLAY_SAMPLES);
  }

  public snapshot(): readonly LiftDisplaySample[] {
    return this.samples.slice();
  }

  public clear(): void {
    this.samples = [];
  }
}
