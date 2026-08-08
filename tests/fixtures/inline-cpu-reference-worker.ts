import {
  runCpuReferenceCase,
  type CpuReferenceRunCaseCommand,
  type CpuReferenceWorkerPort,
  type CpuReferenceWorkerResponse,
} from "../../src/validation/cpu-reference-backend.js";

export function createInlineCpuReferenceWorker(): CpuReferenceWorkerPort {
  let terminated = false;
  const port: CpuReferenceWorkerPort = {
    onmessage: null,
    onerror: null,
    postMessage(command: CpuReferenceRunCaseCommand) {
      queueMicrotask(async () => {
        try {
          for await (const sample of runCpuReferenceCase(command.definition)) {
            if (terminated) {
              return;
            }
            dispatch({ type: "sample", sample });
          }
          dispatch({ type: "complete" });
        } catch (error) {
          dispatch({
            type: "error",
            message: error instanceof Error ? error.message : "Inline CPU Worker failed.",
          });
        }
      });
    },
    terminate() {
      terminated = true;
    },
  };

  function dispatch(response: CpuReferenceWorkerResponse): void {
    if (!terminated) {
      port.onmessage?.({ data: response } as MessageEvent<CpuReferenceWorkerResponse>);
    }
  }

  return port;
}
