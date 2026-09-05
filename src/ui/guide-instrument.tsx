import { CPU_PRODUCTION_STEADY_CASE } from "../engine/cpu-production-contract.js";
import { LIFT_DISPLAY_WINDOW, MAX_LIFT_DISPLAY_SAMPLES } from "../engine/lift-display-history.js";
import type { EngineSummary } from "../engine/protocol.js";
import styles from "./guide-instrument.module.css";

export type GuideStage = "welcome" | "baseline" | "prediction" | "adapting" | "observing" | "complete" | "sandbox";

// Both interactive tiers use this physical domain. Locate callouts in cylinder
// diameters, then map to the full-domain canvas (including its one-diameter body).
const domain = CPU_PRODUCTION_STEADY_CASE.configuration.domain;
function wakePoint(x: number, y: number): readonly [number, number] {
  return [
    (domain.upstreamDiameters + 0.5 + x) / (domain.upstreamDiameters + 1 + domain.downstreamDiameters) * 420,
    (domain.lateralDiameters + 0.5 - y) / (2 * domain.lateralDiameters + 1) * 340,
  ];
}

const explanations = {
  welcome: { title: "Follow the incoming flow", detail: "1 · Incoming flow approaches the cylinder from the left.", annotations: [{ target: wakePoint(-4, 0), badge: [45, 95], number: 1 }] },
  baseline: { title: "Flow meets the cylinder", detail: "1 · Incoming flow. 2 · Look for separation near the upper and lower cylinder surfaces.", annotations: [{ target: wakePoint(-4, 0), badge: [45, 95], number: 1 }, { target: wakePoint(0.15, 0.48), badge: [140, 95], number: 2 }, { target: wakePoint(0.15, -0.48), badge: [260, 230], number: 2 }] },
  prediction: { title: "Follow the separated shear layers", detail: "1–2 · Trace the upper and lower layers downstream from the cylinder. Predict how faster flow will change this steady wake.", annotations: [{ target: wakePoint(1.25, 0.6), badge: [150, 95], number: 1 }, { target: wakePoint(1.25, -0.6), badge: [260, 230], number: 2 }] },
  adapting: { title: "From shear layers to roll-up", detail: "1–2 · Separated shear layers. 3 · Look downstream for the first vortex roll-up as the existing wake adapts.", annotations: [{ target: wakePoint(1.25, 0.6), badge: [90, 95], number: 1 }, { target: wakePoint(1.25, -0.6), badge: [260, 230], number: 2 }, { target: wakePoint(3.25, 0), badge: [235, 95], number: 3 }] },
  observing: { title: "Watch for alternating shedding", detail: "1 · Watch downstream for alternating clockwise and counter-clockwise vortices; compare their passage with the lift trace below.", annotations: [{ target: wakePoint(5.5, 0), badge: [240, 95], number: 1 }] },
  complete: { title: "Connect the wake to its signal", detail: "1 · Alternating shedding accompanies periodic lift. The measured stable cycles support the regime and Strouhal readouts above.", annotations: [{ target: wakePoint(5.5, 0), badge: [240, 95], number: 1 }] },
} as const;

export function GuideAnnotations({ stage }: { readonly stage: GuideStage }) {
  if (stage === "sandbox") return null;
  const explanation = explanations[stage];
  return <div class={styles.annotations} data-guide-stage={stage}>
    <div class={styles.heading}><span>Guide overlay · explanatory locations</span><strong>{explanation.title}</strong></div>
    <svg viewBox="0 0 420 340" aria-hidden="true">
      {explanation.annotations.map(({ target: [x, y], badge: [bx, by], number }, index) => {
        return <g key={index}>
          <path d={`M${bx},${by} L${x},${y}`} />
          <circle cx={x} cy={y} r="3" />
          <circle cx={bx} cy={by} r="10" />
          <text x={bx} y={by + 4} text-anchor="middle">{number}</text>
        </g>;
      })}
    </svg>
  </div>;
}

export function GuideSignal({ stage, summary, unavailable }: {
  readonly stage: GuideStage;
  readonly summary: EngineSummary;
  readonly unavailable: boolean;
}) {
  if (stage === "sandbox") return null;
  const explanation = explanations[stage];
  const showSignal = ["adapting", "observing", "complete"].includes(stage);
  const signal = summary.liftSignal;
  const samples = signal?.samples ?? [];
  const latest = samples.at(-1);
  const end = signal?.flowThroughTime ?? 0;
  const start = Math.max(0, end - LIFT_DISPLAY_WINDOW);
  const span = Math.max(end - start, 1);
  const amplitude = Math.max(0.05, ...samples.map((sample) => Math.abs(sample.liftCoefficient))) * 1.1;
  const x = (time: number) => 85 + (time - start) / span * 505;
  const y = (lift: number) => 85 - lift / amplitude * 45;
  const stable = !unavailable && summary.regime === "periodically-shedding";
  const detail = unavailable
    ? "The last valid wake and signal are frozen. No physical conclusion should be drawn from this unavailable result."
    : stage === "complete" && !stable
      ? "The wake has changed. Wait for a new measured periodic regime before interpreting the signal as stable shedding."
      : explanation.detail;
  const status = unavailable
    ? "Last valid frame · result unavailable"
    : stable ? "Stable periodic lift measured" : "Watching the measured lift";
  return <section class={styles.signal} aria-label="Canvas guide and shedding signal">
    <p class={styles.explanation} aria-live="polite">{detail}</p>
    {showSignal && <>
      <div class={styles.signalHeading}><h3>Shedding signal</h3><span>{status}</span></div>
      <p class={styles.sample}>
        Wake cursor · {end.toFixed(2)} D/U · {latest === undefined ? "Waiting for lift telemetry" : `Cₗ ${latest.liftCoefficient >= 0 ? "+" : ""}${latest.liftCoefficient.toFixed(3)}`}
      </p>
      <svg class={styles.chart} viewBox="0 0 620 195" role="img" aria-label={`Lift coefficient, dimensionless, against flow-through time in D/U. Current wake frame ${end.toFixed(2)} D/U.${latest === undefined ? " Waiting for samples." : ` Latest lift ${latest.liftCoefficient.toFixed(3)}.`}`}>
        <text x="85" y="24">Lift Cₗ · dimensionless</text>
        <path class={styles.axis} d="M85,35 V130 H590 M85,85 H590" />
        <text x="77" y="43" text-anchor="end">+{amplitude.toFixed(2)}</text>
        <text x="77" y="89" text-anchor="end">0</text>
        <text x="77" y="132" text-anchor="end">−{amplitude.toFixed(2)}</text>
        <text x="85" y="158">{start.toFixed(1)}</text>
        <text x="590" y="158" text-anchor="end">{Math.max(end, 1).toFixed(1)}</text>
        <text x="325" y="187" text-anchor="middle">Flow-through time · D/U</text>
        <polyline class={styles.trace} points={samples.map((sample) => `${x(sample.flowThroughTime)},${y(sample.liftCoefficient)}`).join(" ")} />
        {latest !== undefined && <g class={styles.cursor}>
          <path d={`M${x(end)},35 V130`} />
          <circle cx={x(latest.flowThroughTime)} cy={y(latest.liftCoefficient)} r="4" />
        </g>}
      </svg>
      <p class={styles.caption}>Positive / negative Cₗ indicates transverse force, not vortex rotation sign. Follow ↻ / ↺ in the wake alongside the cursor. Last {LIFT_DISPLAY_WINDOW} D/U, up to {MAX_LIFT_DISPLAY_SAMPLES} samples; vertical scale adapts.</p>
      {stable && summary.strouhalNumber !== undefined && <p class={styles.conclusion}>
        Periodic lift → periodically shedding · St = fD/U = <strong>{summary.strouhalNumber.toFixed(3)}</strong>. One measured cycle is approximately <strong>{(1 / summary.strouhalNumber).toFixed(2)} D/U</strong>. The existing regime detector supplies this result; this trace illustrates it.
      </p>}
    </>}
  </section>;
}
