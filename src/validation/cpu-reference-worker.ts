import {
  runCpuReferenceCase,
  type CpuReferenceRunCaseCommand,
  type CpuReferenceWorkerResponse,
} from "./cpu-reference-backend.js";

interface CpuReferenceWorkerScope {
  onmessage: ((event: MessageEvent<CpuReferenceRunCaseCommand>) => void) | null;
  postMessage(response: CpuReferenceWorkerResponse): void;
}

const workerScope = self as unknown as CpuReferenceWorkerScope;

workerScope.onmessage = async ({ data }) => {
  if (data.type !== "run-case") {
    return;
  }
  try {
    for await (const sample of runCpuReferenceCase(data.definition)) {
      workerScope.postMessage({ type: "sample", sample });
    }
    workerScope.postMessage({ type: "complete" });
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "CPU reference Worker failed.",
    });
  }
};
