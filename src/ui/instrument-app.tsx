import { useEffect, useMemo, useState } from "preact/hooks";

import {
  coupledPhysicalIntervals,
  type PhysicalScenario,
} from "../engine/physical-scenario.js";
import type { EngineBaseline, EngineSummary } from "../engine/protocol.js";
import styles from "./instrument-app.module.css";
import { TierEvidencePanel } from "./tier-evidence-panel.js";
import { useWakeEngine, type WakeWorkerPort } from "./use-wake-engine.js";

type GuideStage =
  | "welcome"
  | "baseline"
  | "prediction"
  | "adapting"
  | "observing"
  | "complete"
  | "sandbox";

export interface InstrumentAppProps {
  readonly workerFactory?: () => WakeWorkerPort;
  readonly reducedMotion?: boolean;
}

export function InstrumentApp({ workerFactory, reducedMotion }: InstrumentAppProps) {
  const engine = useWakeEngine({
    ...(workerFactory === undefined ? {} : { workerFactory }),
    ...(reducedMotion === undefined ? {} : { reducedMotion }),
  });
  const [guideStage, setGuideStage] = useState<GuideStage>(() =>
    localStorage.getItem("cfd-visualise-guide-complete") === "1" ? "sandbox" : "welcome",
  );
  const [baseline, setBaseline] = useState<EngineBaseline>();
  const [baselineCapturePending, setBaselineCapturePending] = useState(false);
  const [prediction, setPrediction] = useState("");
  const intervals = useMemo(
    () => coupledPhysicalIntervals(engine.summary.scenario),
    [engine.summary.scenario],
  );

  useEffect(() => {
    if (
      guideStage === "baseline" &&
      engine.summary.regime === "steady" &&
      !baselineCapturePending
    ) {
      setBaselineCapturePending(true);
      engine.pause();
      engine.captureStill();
    }
    if (
      guideStage === "baseline" &&
      baselineCapturePending &&
      engine.capturedStill !== undefined
    ) {
      setBaseline(engine.capturedStill);
      setGuideStage("prediction");
    }
    if (
      (guideStage === "adapting" || guideStage === "observing") &&
      engine.summary.regime === "periodically-shedding"
    ) {
      setGuideStage("complete");
      localStorage.setItem("cfd-visualise-guide-complete", "1");
    } else if (
      guideStage === "adapting" &&
      engine.summary.regime !== "adapting" &&
      engine.summary.targetReynoldsNumber === 100 &&
      Math.abs(engine.summary.reynoldsNumber - 100) < 0.01
    ) {
      setGuideStage("observing");
    }
  }, [engine.summary, engine.capturedStill, guideStage, baselineCapturePending]);

  const startGuide = () => {
    setBaseline(undefined);
    setBaselineCapturePending(false);
    setPrediction("");
    setGuideStage("baseline");
    engine.resetGuide();
  };
  const commitPrediction = () => {
    if (prediction === "") return;
    setGuideStage("adapting");
    engine.play();
    engine.setScenario({
      ...engine.summary.scenario,
      flowSpeedMetersPerSecond: 0.01,
    });
  };
  const setScenarioValue = (field: keyof PhysicalScenario, value: number) => {
    engine.setScenario({ ...engine.summary.scenario, [field]: value });
  };

  return (
    <main class={styles.shell}>
      <header class={styles.header}>
        <div>
          <p class={styles.eyebrow}>Fluid-intuition sandbox</p>
          <h1>See a wake take shape</h1>
        </div>
        <p class={styles.scope}>2D open-flow model | Re 5–150 | qualitative</p>
      </header>

      {guideStage === "welcome" && (
        <section class={styles.guide} aria-labelledby="welcome-title">
          <h2 id="welcome-title">Follow one cause through the flow</h2>
          <p>Predict how a faster stream changes the measured wake, then watch the evidence develop.</p>
          <div class={styles.actions}>
            <button type="button" onClick={startGuide}>Start guided experiment</button>
            <button
              type="button"
              class={styles.secondary}
              onClick={() => {
                setGuideStage("sandbox");
                localStorage.setItem("cfd-visualise-guide-complete", "1");
              }}
            >
              Skip to sandbox
            </button>
          </div>
        </section>
      )}

      <div class={styles.instrument}>
        <section class={styles.wakePanel} aria-labelledby="wake-title">
          <div class={styles.panelHeading}>
            <div>
              <p class={styles.eyebrow}>Full-domain view</p>
              <h2 id="wake-title">Wake view</h2>
            </div>
            <div class={styles.legend} aria-label="Signed normalized vorticity legend">
              <span><i class={styles.clockwise} />↻ clockwise</span>
              <span>ωD/U</span>
              <span><i class={styles.counterclockwise} />↺ counterclockwise</span>
            </div>
          </div>
          <canvas
            ref={engine.canvasRef}
            class={styles.canvas}
            role="img"
            aria-label="Full-domain wake view with a cylinder, x over D and y over D axes, signed normalized vorticity, and passive tracers"
          />
          <PlaybackControls engine={engine} />
        </section>

        <aside class={styles.controls} aria-label="Physical controls and learning readouts">
          <PhysicalControl
            id="speed"
            label="Flow speed"
            value={engine.summary.scenario.flowSpeedMetersPerSecond}
            unit="m/s"
            interval={intervals.speed}
            onChange={(value) => setScenarioValue("flowSpeedMetersPerSecond", value)}
          />
          <PhysicalControl
            id="diameter"
            label="Cylinder diameter"
            value={engine.summary.scenario.cylinderDiameterMeters}
            unit="m"
            interval={intervals.diameter}
            onChange={(value) => setScenarioValue("cylinderDiameterMeters", value)}
          />
          <PhysicalControl
            id="viscosity"
            label="Kinematic viscosity"
            value={engine.summary.scenario.kinematicViscositySquareMetersPerSecond}
            unit="m²/s"
            interval={intervals.viscosity}
            onChange={(value) => setScenarioValue("kinematicViscositySquareMetersPerSecond", value)}
          />

          <section class={styles.readouts} aria-label="Learning readouts" aria-live="polite">
            <Readout label="Reynolds number" value={engine.summary.reynoldsNumber.toFixed(1)} />
            <Readout label="Flow-through time" value={`${engine.summary.flowThroughTime.toFixed(2)} D/U`} />
            <Readout label="Measured flow regime" value={regimeLabel(engine.summary.regime)} />
            <Readout label="Playback state" value={engine.summary.playback} />
            {engine.summary.regime === "periodically-shedding" &&
              engine.summary.strouhalNumber !== undefined && (
                <Readout label="Strouhal number" value={engine.summary.strouhalNumber.toFixed(3)} />
              )}
          </section>

          <p class={styles.equation}>
            Re = U D / ν = {engine.summary.scenario.flowSpeedMetersPerSecond} × {engine.summary.scenario.cylinderDiameterMeters} / {engine.summary.scenario.kinematicViscositySquareMetersPerSecond} = {engine.summary.targetReynoldsNumber.toFixed(1)}. Higher Re means inertia has more influence relative to viscosity; equivalent scenarios share this ratio.
          </p>
          <p class={styles.tier}>
            {engine.tier?.label ?? "Starting CPU tier"} · {engine.tier?.backendId ?? "cpu-reference"} · validated build {engine.tier?.buildId ?? "ticket-06"}
          </p>
          <label class={styles.tier}>
            Quality tier (changing tier restarts this experiment)
            <select
              aria-label="Quality tier"
              value={engine.tier?.id ?? ""}
              disabled={engine.tier === undefined}
              onChange={(event) => engine.changeTier(event.currentTarget.value)}
            >
              {engine.tier === undefined && <option value="">Selecting validated tier…</option>}
              {engine.availableTiers.map((identity) => (
                <option key={identity.id} value={identity.id}>{identity.label}</option>
              ))}
            </select>
          </label>
        </aside>
      </div>

      {engine.tier !== undefined && (
        <TierEvidencePanel active={engine.tier} />
      )}

      <GuideProgress
        stage={guideStage}
        {...(baseline === undefined ? {} : { baseline })}
        prediction={prediction}
        live={engine.summary}
        onPrediction={setPrediction}
        onCommit={commitPrediction}
        onRunAgain={startGuide}
      />

      {engine.unavailableReason !== undefined && (
        <section class={styles.failure} role="alert">
          <h2>Result unavailable</h2>
          <p>{engine.unavailableReason}</p>
          <p>The last valid frame is frozen. No physical conclusion should be drawn from this result.</p>
          <div class={styles.actions}>
            {engine.restartChoices?.includes("same-tier") && (
              <button type="button" onClick={engine.restartTier}>
                Restart {engine.tier?.label ?? "current tier"}
              </button>
            )}
            {engine.restartChoices?.includes("lower-tier") &&
              engine.tier?.id !== "cpu-balanced-d18" && (
                <button
                  type="button"
                  class={styles.secondary}
                  onClick={() => engine.changeTier("cpu-balanced-d18")}
                >
                  Restart on CPU balanced
                </button>
              )}
          </div>
        </section>
      )}
    </main>
  );
}

function PlaybackControls({ engine }: { readonly engine: ReturnType<typeof useWakeEngine> }) {
  const controlsUnavailable = engine.tier === undefined || engine.unavailableReason !== undefined;
  const playing = engine.summary.playback === "playing";
  return (
    <div class={styles.playback} aria-label="Playback controls">
      <button
        type="button"
        disabled={controlsUnavailable || playing}
        onClick={engine.play}
      >
        Play
      </button>
      <button
        type="button"
        disabled={controlsUnavailable || !playing}
        onClick={engine.pause}
      >
        Pause
      </button>
      <button
        type="button"
        disabled={controlsUnavailable || playing}
        onClick={engine.step}
      >
        Step 0.05 D/U
      </button>
      <button
        type="button"
        disabled={controlsUnavailable}
        onClick={engine.restart}
      >
        Restart experiment
      </button>
      <label>
        Playback rate
        <select
          value={engine.summary.targetPlaybackRate}
          onChange={(event) => engine.setPlaybackRate(Number(event.currentTarget.value))}
        >
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="1.3">1.3× (CPU default)</option>
          <option value="2">2×</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={engine.summary.tracersEnabled}
          onChange={(event) => engine.setTracersEnabled(event.currentTarget.checked)}
        />
        Passive tracers
      </label>
      <output>Achieved {engine.summary.achievedPlaybackRate.toFixed(2)}×</output>
    </div>
  );
}

function PhysicalControl(props: {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  readonly interval: readonly [number, number];
  readonly onChange: (value: number) => void;
}) {
  const logarithmicPosition = Math.log(props.value / props.interval[0]) / Math.log(props.interval[1] / props.interval[0]);
  return (
    <fieldset class={styles.control}>
      <legend>{props.label}</legend>
      <input
        id={`${props.id}-slider`}
        aria-label={`${props.label} logarithmic slider`}
        type="range"
        min="0"
        max="1"
        step="0.001"
        value={Number.isFinite(logarithmicPosition) ? logarithmicPosition : 0}
        onChange={(event) => {
          const fraction = Number(event.currentTarget.value);
          props.onChange(props.interval[0] * (props.interval[1] / props.interval[0]) ** fraction);
        }}
      />
      <label for={`${props.id}-value`}>Editable value</label>
      <div class={styles.valueRow}>
        <input
          id={`${props.id}-value`}
          type="number"
          min={props.interval[0]}
          max={props.interval[1]}
          step="any"
          value={props.value}
          onChange={(event) => props.onChange(Number(event.currentTarget.value))}
        />
        <span>{props.unit}</span>
      </div>
      <small>Valid interval {formatNumber(props.interval[0])}–{formatNumber(props.interval[1])} {props.unit}, constrained by the validated Re 5–150 envelope.</small>
    </fieldset>
  );
}

function GuideProgress(props: {
  readonly stage: GuideStage;
  readonly baseline?: EngineBaseline;
  readonly live: EngineSummary;
  readonly prediction: string;
  readonly onPrediction: (prediction: string) => void;
  readonly onCommit: () => void;
  readonly onRunAgain: () => void;
}) {
  if (["welcome", "sandbox"].includes(props.stage)) {
    return props.stage === "sandbox" ? <button type="button" onClick={props.onRunAgain}>Run guided experiment</button> : null;
  }
  return (
    <section class={styles.guide} aria-live="polite">
      {props.stage === "baseline" && <><h2>Watching the baseline wake develop</h2><p>The guide waits for a measured steady regime; it does not use a timer.</p></>}
      {props.stage === "prediction" && (
        <>
          <h2>Baseline measured</h2>
          <p>At Re {props.baseline?.summary.reynoldsNumber.toFixed(1)}, the wake is {regimeLabel(props.baseline?.summary.regime ?? "unclassified")} after {props.baseline?.summary.flowThroughTime.toFixed(2)} D/U.</p>
          <fieldset>
            <legend>What will faster flow do to the wake?</legend>
            {[
              ["unsteady", "Become unsteady and shed vortices"],
              ["steady", "Remain steady"],
              ["weaker", "Become weaker"],
            ].map(([value, label]) => (
              <label key={value}><input type="radio" name="prediction" value={value} checked={props.prediction === value} onChange={() => props.onPrediction(value!)} />{label}</label>
            ))}
          </fieldset>
          <button type="button" disabled={props.prediction === ""} onClick={props.onCommit}>Commit prediction</button>
        </>
      )}
      {props.stage === "adapting" && <><h2>Adapting the existing wake</h2><p>Reynolds number is ramping toward 100 without restarting the evolved field.</p></>}
      {props.stage === "observing" && <><h2>Watching for measured shedding</h2><p>The guide completes only after stable periodic lift is observed.</p></>}
      {props.stage === "complete" && <><h2>Prediction compared</h2><p>Faster flow raised inertia relative to viscosity: the measured wake changed from steady to periodically shedding.</p><button type="button" onClick={props.onRunAgain}>Run guide again</button></>}
      {props.baseline !== undefined && (
        <BaselineComparison baseline={props.baseline} live={props.live} />
      )}
    </section>
  );
}

function BaselineComparison({
  baseline,
  live,
}: {
  readonly baseline: EngineBaseline;
  readonly live: EngineSummary;
}) {
  const imageUrl = useBlobUrl(baseline.image);
  return (
    <section class={styles.comparison} aria-label="Live and baseline comparison">
      <h3>Live / baseline comparison</h3>
      <div class={styles.comparisonGrid}>
        <figure>
          <img src={imageUrl} alt="Baseline normalized-vorticity still" />
          <figcaption>Baseline at {baseline.summary.flowThroughTime.toFixed(2)} D/U</figcaption>
        </figure>
        <dl>
          <Readout
            label="Reynolds number (baseline / live)"
            value={`${baseline.summary.reynoldsNumber.toFixed(1)} / ${live.reynoldsNumber.toFixed(1)}`}
          />
          <Readout
            label="Measured regime (baseline / live)"
            value={`${regimeLabel(baseline.summary.regime)} / ${regimeLabel(live.regime)}`}
          />
          <Readout
            label="Flow-through time (baseline / live)"
            value={`${baseline.summary.flowThroughTime.toFixed(2)} / ${live.flowThroughTime.toFixed(2)} D/U`}
          />
        </dl>
      </div>
    </section>
  );
}

function useBlobUrl(blob: Blob): string {
  const [url, setUrl] = useState("about:blank");
  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return undefined;
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function Readout({ label, value }: { readonly label: string; readonly value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function regimeLabel(regime: EngineSummary["regime"]): string {
  const labels: Record<EngineSummary["regime"], string> = {
    developing: "Developing",
    adapting: "Adapting",
    steady: "Steady",
    "periodically-shedding": "Periodically shedding",
    "numerically-unstable": "Unavailable",
    unclassified: "Unclassified",
  };
  return labels[regime];
}

function formatNumber(value: number): string {
  return value < 0.001 ? value.toExponential(2) : value.toPrecision(3);
}
