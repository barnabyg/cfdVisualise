import { createCpuFixedStepCase } from "../validation/cpu-reference-backend.js";
import type { ValidationCaseDefinition } from "../validation/types.js";

interface CapabilityWorkerScope {
  onmessage: ((event: MessageEvent<{ readonly definition: ValidationCaseDefinition }>) => void) | null;
  postMessage(result: { readonly flowThroughTimePerSecond: number } | { readonly error: string }): void;
  close(): void;
}

const scope = self as unknown as CapabilityWorkerScope;

scope.onmessage = ({ data }) => {
  void benchmark(data.definition);
};

async function benchmark(definition: ValidationCaseDefinition): Promise<void> {
  try {
    const execution = createCpuFixedStepCase(definition);
    const stepCount = 128;
    const started = performance.now();
    await execution.execute({
      type: "advance-fixed-steps",
      stepCount,
      reynoldsNumber: definition.reynoldsNumber,
    });
    const elapsedSeconds = Math.max((performance.now() - started) / 1000, Number.EPSILON);
    await execution.execute({ type: "dispose" });
    scope.postMessage({
      flowThroughTimePerSecond:
        ((stepCount * execution.latticeSpeed) / execution.cylinderDiameter) /
        elapsedSeconds,
    });
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    scope.close();
  }
}
