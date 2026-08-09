import type {
  FixedStepCaseExecution,
  ValidationCaseDefinition,
  ValidationSample,
} from "./types.js";

export async function* runFixedStepValidationCase(
  definition: ValidationCaseDefinition,
  createExecution: () => Promise<FixedStepCaseExecution>,
  backendLabel: string,
): AsyncIterable<ValidationSample> {
  const execution = await createExecution();
  try {
    const initial = await execution.execute({
      type: "sample-diagnostics",
      step: 0,
      flowThroughTime: 0,
      stepsSinceSample: 0,
    });
    if (initial === undefined) {
      throw new Error(`${backendLabel} initial diagnostic was not produced.`);
    }
    yield initial;

    const stepsPerSample = exactStepCount(
      (definition.protocol.sampleInterval * execution.cylinderDiameter) /
        execution.latticeSpeed,
      "sample interval",
      backendLabel,
    );
    const sampleCount = exactStepCount(
      (definition.protocol.warmUpFlowThroughTime +
        definition.protocol.sampleFlowThroughTime) /
        definition.protocol.sampleInterval,
      "case duration",
      backendLabel,
    );
    let step = 0;
    for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
      if (definition.protocol.reynoldsChange === undefined) {
        await execution.execute({
          type: "advance-fixed-steps",
          stepCount: stepsPerSample,
          reynoldsNumber: definition.reynoldsNumber,
        });
        step += stepsPerSample;
      } else {
        for (let localStep = 0; localStep < stepsPerSample; localStep += 1) {
          const flowThroughTime =
            (step * execution.latticeSpeed) / execution.cylinderDiameter;
          await execution.execute({
            type: "advance-fixed-steps",
            stepCount: 1,
            reynoldsNumber: reynoldsNumberAtFlowThroughTime(
              definition,
              flowThroughTime,
            ),
          });
          step += 1;
        }
      }
      const sample = await execution.execute({
        type: "sample-diagnostics",
        step,
        flowThroughTime: sampleIndex * definition.protocol.sampleInterval,
        stepsSinceSample: stepsPerSample,
      });
      if (sample === undefined) {
        throw new Error(`${backendLabel} diagnostic was not produced.`);
      }
      yield sample;
    }
  } finally {
    await execution.execute({ type: "dispose" });
  }
}

function exactStepCount(value: number, label: string, backendLabel: string): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(value) || rounded <= 0 || Math.abs(value - rounded) > 1e-9) {
    throw new Error(
      `${backendLabel} ${label} must resolve to a positive fixed step count; received ${value}.`,
    );
  }
  return rounded;
}

function reynoldsNumberAtFlowThroughTime(
  definition: ValidationCaseDefinition,
  flowThroughTime: number,
): number {
  const change = definition.protocol.reynoldsChange;
  if (change === undefined) return definition.reynoldsNumber;
  if (flowThroughTime <= change.atFlowThroughTime) {
    return change.initialReynoldsNumber;
  }
  const rampProgress =
    (flowThroughTime - change.atFlowThroughTime) / change.rampFlowThroughTime;
  if (rampProgress >= 1) return definition.reynoldsNumber;
  return (
    change.initialReynoldsNumber +
    rampProgress * (definition.reynoldsNumber - change.initialReynoldsNumber)
  );
}
