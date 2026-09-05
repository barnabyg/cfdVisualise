import {
  D2Q9_OPEN_CYLINDER_CONTRACT,
  buildOpenCylinderGeometry,
  equilibriumPopulation,
  trtRelaxationRates,
  type OpenCylinderGeometry,
} from "./d2q9-open-cylinder-contract.js";
import { runFixedStepValidationCase } from "./fixed-step-runner.js";
import type {
  FixedStepCaseCommand,
  FixedStepCaseExecution,
  ValidationCaseDefinition,
  ValidationSample,
} from "./types.js";
import {
  WEBGPU_BUFFER_USAGE,
  WEBGPU_MAP_MODE_READ,
  type WebGpuBindGroupHandle,
  type WebGpuBufferHandle,
  type WebGpuCommandEncoderHandle,
  type WebGpuComputePassHandle,
  type WebGpuComputePipelineHandle,
  type WebGpuDeviceHandle,
} from "./webgpu-api.js";
import type { WakeEncodingFocus } from "../engine/protocol.js";

const DIAGNOSTIC_VALUE_COUNT = 14;
const WORKGROUP_SIZE = 64;
const WEBGPU_TRACER_TAIL_EMPHASIS = 0.45;
const TRACER_COUNT = 270;
const WEBGPU_PARAMETER_INDEX = Object.freeze({
  width: 0,
  height: 1,
  cellCount: 2,
  bounceCount: 3,
  cylinderDiameter: 4,
  cylinderCenterX: 5,
  cylinderCenterY: 6,
  cylinderRearX: 7,
  latticeSpeed: 8,
  omegaEven: 9,
  omegaOdd: 10,
  forceNormalizer: 11,
  hasAdvanced: 12,
  upstreamReflectionMode: 13,
  stepsSinceSample: 14,
  inletMode: 15,
  lateralMode: 16,
  outletMode: 17,
  renderFlowIncrement: 18,
  tracersEnabled: 19,
  encodingFocus: 20,
});
const WEBGPU_PARAMETER_COUNT = Object.keys(WEBGPU_PARAMETER_INDEX).length;
const WGSL_CX = D2Q9_OPEN_CYLINDER_CONTRACT.directions
  .map(([x]) => x)
  .join(", ");
const WGSL_CY = D2Q9_OPEN_CYLINDER_CONTRACT.directions
  .map(([, y]) => y)
  .join(", ");
const WGSL_OPPOSITE = D2Q9_OPEN_CYLINDER_CONTRACT.opposite
  .map((direction) => `${direction}u`)
  .join(", ");
const WGSL_WEIGHTS = D2Q9_OPEN_CYLINDER_CONTRACT.weights
  .map((weight) => {
    if (weight === 4 / 9) return "4.0 / 9.0";
    if (weight === 1 / 9) return "1.0 / 9.0";
    if (weight === 1 / 36) return "1.0 / 36.0";
    throw new Error(`Unsupported D2Q9 weight ${weight}.`);
  })
  .join(", ");

export function webGpuTracerDirectionEmphasis(progress: number): number {
  const boundedProgress = Math.max(0, Math.min(1, progress));
  return WEBGPU_TRACER_TAIL_EMPHASIS
    + (1 - WEBGPU_TRACER_TAIL_EMPHASIS) * boundedProgress;
}

export type WebGpuExecutionFailureReason = "diagnostic-failure" | "device-lost";

export class WebGpuExecutionError extends Error {
  public constructor(
    public readonly reason: WebGpuExecutionFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "WebGpuExecutionError";
  }
}

export interface WebGpuCaseRuntime {
  runCase(definition: ValidationCaseDefinition): AsyncIterable<ValidationSample>;
  createCase(definition: ValidationCaseDefinition): Promise<FixedStepCaseExecution>;
}

export interface WebGpuInteractiveCaseExecution extends FixedStepCaseExecution {
  advanceAndSample(options: {
    readonly stepCount: number;
    readonly reynoldsNumber: number;
    readonly step: number;
    readonly flowThroughTime: number;
    readonly stepsSinceSample: number;
  }): Promise<ValidationSample>;
  renderFrame(
    flowThroughIncrement: number,
    tracersEnabled: boolean,
    encodingFocus?: WakeEncodingFocus,
  ): Promise<{
    readonly width: number;
    readonly height: number;
    readonly pixels: Uint8ClampedArray;
  }>;
  perturbWake(amplitude: number): Promise<void>;
  resetTracers(): void;
}

export function createWebGpuCaseRuntime(
  device: WebGpuDeviceHandle,
): WebGpuCaseRuntime {
  return {
    runCase(definition) {
      return runFixedStepValidationCase(
        definition,
        () => createWebGpuFixedStepCase(device, definition),
        "WebGPU",
      );
    },
    createCase(definition) {
      return createWebGpuFixedStepCase(device, definition);
    },
  };
}

export async function createWebGpuFixedStepCase(
  device: WebGpuDeviceHandle,
  definition: ValidationCaseDefinition,
): Promise<FixedStepCaseExecution> {
  return classifyNativeWebGpuFailure(device, `WebGPU case ${definition.id} initialisation`, async () => {
    validateWebGpuConfiguration(definition);
    const execution = new WebGpuCaseExecution(device, definition);
    await execution.validateShader();
    return {
      cylinderDiameter: execution.cylinderDiameter,
      latticeSpeed: execution.latticeSpeed,
      execute(command: FixedStepCaseCommand) {
        return classifyNativeWebGpuFailure(
          device,
          `WebGPU case ${definition.id} ${command.type}`,
          async () => {
            if (command.type === "advance-fixed-steps") {
              await execution.advance(command.stepCount, command.reynoldsNumber);
              return undefined;
            }
            if (command.type === "sample-diagnostics") {
              return execution.diagnostic(
                command.step,
                command.flowThroughTime,
                command.stepsSinceSample,
              );
            }
            execution.dispose();
            return undefined;
          },
        );
      },
    };
  });
}

export async function createWebGpuInteractiveCase(
  device: WebGpuDeviceHandle,
  definition: ValidationCaseDefinition,
): Promise<WebGpuInteractiveCaseExecution> {
  return classifyNativeWebGpuFailure(
    device,
    `WebGPU interactive case ${definition.id} initialisation`,
    async () => {
      validateWebGpuConfiguration(definition);
      const execution = new WebGpuCaseExecution(device, definition);
      await execution.validateShader();
      return {
        cylinderDiameter: execution.cylinderDiameter,
        latticeSpeed: execution.latticeSpeed,
        execute(command) {
          return classifyNativeWebGpuFailure(
            device,
            `WebGPU interactive case ${definition.id} ${command.type}`,
            async () => {
              if (command.type === "advance-fixed-steps") {
                await execution.advance(command.stepCount, command.reynoldsNumber);
                return undefined;
              }
              if (command.type === "sample-diagnostics") {
                return execution.diagnostic(
                  command.step,
                  command.flowThroughTime,
                  command.stepsSinceSample,
                );
              }
              execution.dispose();
              return undefined;
            },
          );
        },
        perturbWake(amplitude) {
          return classifyNativeWebGpuFailure(
            device,
            `WebGPU interactive case ${definition.id} wake perturbation`,
            () => execution.perturbWake(amplitude),
          );
        },
        advanceAndSample(options) {
          return classifyNativeWebGpuFailure(
            device,
            `WebGPU interactive case ${definition.id} advance and sample`,
            () => execution.advanceAndSample(options),
          );
        },
        renderFrame(flowThroughIncrement, tracersEnabled, encodingFocus) {
          return classifyNativeWebGpuFailure(
            device,
            `WebGPU interactive case ${definition.id} render`,
            () => execution.renderFrame(flowThroughIncrement, tracersEnabled, encodingFocus),
          );
        },
        resetTracers() {
          execution.resetTracers();
        },
      };
    },
  );
}

async function classifyNativeWebGpuFailure<T>(
  device: WebGpuDeviceHandle,
  context: string,
  operation: () => Promise<T>,
): Promise<T> {
  let lostInformation: Awaited<typeof device.lost> | undefined;
  const deviceLoss = device.lost.then((information) => {
    lostInformation = information;
    throw new WebGpuExecutionError(
      "device-lost",
      `${context}: ${information.message ?? "the WebGPU device was lost"}.`,
    );
  });
  try {
    return await Promise.race([operation(), deviceLoss]);
  } catch (error) {
    if (error instanceof WebGpuExecutionError) throw error;
    await Promise.resolve();
    if (lostInformation !== undefined) {
      throw new WebGpuExecutionError(
        "device-lost",
        `${context}: ${lostInformation.message ?? "the WebGPU device was lost"}.`,
      );
    }
    throw new WebGpuExecutionError(
      "diagnostic-failure",
      `${context}: ${error instanceof Error ? error.message : String(error)}.`,
    );
  }
}

class WebGpuCaseExecution {
  public readonly cylinderDiameter: number;
  public readonly latticeSpeed: number;
  private readonly geometry: OpenCylinderGeometry;
  private readonly resources: WebGpuResources;
  private readonly pipelines: WebGpuPipelines;
  private readonly bindGroups: WebGpuBindGroups;
  private readonly initialPerturbedPopulations: Float32Array | undefined;
  private readonly parameterValues = new Float32Array(WEBGPU_PARAMETER_COUNT);
  private readonly zeroForce = new Float32Array(2);
  private populationsAIsCurrent = true;
  private hasAdvanced = false;
  private currentReynoldsNumber: number;

  public constructor(
    private readonly device: WebGpuDeviceHandle,
    private readonly definition: ValidationCaseDefinition,
  ) {
    this.geometry = buildOpenCylinderGeometry(definition);
    this.currentReynoldsNumber = definition.reynoldsNumber;
    this.cylinderDiameter = this.geometry.cylinderDiameter;
    this.latticeSpeed =
      definition.configuration.latticeSpeed ??
      D2Q9_OPEN_CYLINDER_CONTRACT.defaultLatticeSpeed;
    this.resources = createResources(
      device,
      this.geometry,
      this.latticeSpeed,
    );
    const perturbation = definition.configuration.initialTransversePerturbation ?? 0;
    this.initialPerturbedPopulations =
      perturbation > 0
        ? createInitialPopulations(
            this.geometry,
            this.latticeSpeed,
            perturbation,
          )
        : undefined;
    this.pipelines = createPipelines(device);
    this.bindGroups = createBindGroups(
      device,
      this.pipelines,
      this.resources,
    );
    this.writeParameters(definition.reynoldsNumber, 0);
  }

  public async advance(stepCount: number, reynoldsNumber: number): Promise<void> {
    this.prepareAdvance(stepCount, reynoldsNumber);
    this.writeParameters(this.currentReynoldsNumber, stepCount);
    this.device.pushErrorScope("validation");
    const encoder = this.device.createCommandEncoder({
      label: `WebGPU ${this.definition.id} fixed steps`,
    });
    const pass = encoder.beginComputePass();
    this.dispatchSteps(pass, stepCount);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    await this.submittedWork(`WebGPU case ${this.definition.id} fixed-step execution failed`);
  }

  public async advanceAndSample({
    stepCount,
    reynoldsNumber,
    step,
    flowThroughTime,
    stepsSinceSample,
  }: {
    readonly stepCount: number;
    readonly reynoldsNumber: number;
    readonly step: number;
    readonly flowThroughTime: number;
    readonly stepsSinceSample: number;
  }): Promise<ValidationSample> {
    this.prepareAdvance(stepCount, reynoldsNumber);
    this.writeParameters(this.currentReynoldsNumber, stepsSinceSample);
    this.device.pushErrorScope("validation");
    const encoder = this.device.createCommandEncoder({
      label: `WebGPU ${this.definition.id} interactive advance and diagnostic`,
    });
    const pass = encoder.beginComputePass();
    this.dispatchSteps(pass, stepCount);
    this.dispatchDiagnostic(pass);
    pass.end();
    this.copyDiagnostic(encoder);
    this.device.queue.submit([encoder.finish()]);
    await this.submittedWork(
      `WebGPU case ${this.definition.id} interactive advance and diagnostic failed`,
    );
    return this.readDiagnostic(step, flowThroughTime);
  }

  public async validateShader(): Promise<void> {
    const information = await this.pipelines.compilationInfo;
    const errors = information.messages.filter(({ type }) => type === "error");
    if (errors.length > 0) {
      throw new WebGpuExecutionError(
        "diagnostic-failure",
        `WebGPU shader compilation failed: ${errors
          .map(({ lineNum, linePos, message }) => `${lineNum}:${linePos} ${message}`)
          .join("; ")}`,
      );
    }
  }

  public async diagnostic(
    step: number,
    flowThroughTime: number,
    stepsSinceSample: number,
  ): Promise<ValidationSample> {
    this.writeParameters(this.currentReynoldsNumber, stepsSinceSample);
    const encoder = this.device.createCommandEncoder({
      label: `WebGPU ${this.definition.id} diagnostic reduction`,
    });
    const pass = encoder.beginComputePass();
    this.dispatchDiagnostic(pass);
    pass.end();
    this.copyDiagnostic(encoder);
    this.device.pushErrorScope("validation");
    this.device.queue.submit([encoder.finish()]);
    await this.submittedWork(`WebGPU case ${this.definition.id} diagnostic reduction failed`);
    return this.readDiagnostic(step, flowThroughTime);
  }

  private prepareAdvance(stepCount: number, reynoldsNumber: number): void {
    if (!Number.isInteger(stepCount) || stepCount <= 0) {
      throw new RangeError(
        "WebGPU fixed-step advancement requires a positive integer step count.",
      );
    }
    if (!this.hasAdvanced && this.initialPerturbedPopulations !== undefined) {
      this.device.queue.writeBuffer(
        this.resources.populationsA,
        0,
        this.initialPerturbedPopulations,
      );
    }
    this.hasAdvanced = true;
    this.currentReynoldsNumber = reynoldsNumber;
  }

  private dispatchSteps(pass: WebGpuComputePassHandle, stepCount: number): void {
    for (let step = 0; step < stepCount; step += 1) {
      const direction = this.populationsAIsCurrent ? "aToB" : "bToA";
      dispatchStep(
        pass,
        this.pipelines,
        this.bindGroups[direction],
        this.bindGroups.forceReduction,
        this.geometry,
      );
      this.populationsAIsCurrent = !this.populationsAIsCurrent;
    }
  }

  private dispatchDiagnostic(pass: WebGpuComputePassHandle): void {
    pass.setPipeline(this.pipelines.diagnostic);
    pass.setBindGroup(
      0,
      this.populationsAIsCurrent
        ? this.bindGroups.diagnosticA
        : this.bindGroups.diagnosticB,
    );
    pass.dispatchWorkgroups(1);
  }

  private copyDiagnostic(encoder: WebGpuCommandEncoderHandle): void {
    encoder.copyBufferToBuffer(
      this.resources.diagnostic,
      0,
      this.resources.readback,
      0,
      DIAGNOSTIC_VALUE_COUNT * Float32Array.BYTES_PER_ELEMENT,
    );
  }

  private async readDiagnostic(
    step: number,
    flowThroughTime: number,
  ): Promise<ValidationSample> {
    const byteLength = DIAGNOSTIC_VALUE_COUNT * Float32Array.BYTES_PER_ELEMENT;
    await this.resources.readback.mapAsync(WEBGPU_MAP_MODE_READ, 0, byteLength);
    const values = new Float32Array(
      this.resources.readback.getMappedRange(0, byteLength),
    ).slice();
    this.resources.readback.unmap();
    this.device.queue.writeBuffer(this.resources.forceAccumulation, 0, this.zeroForce);
    if ([...values].some((value) => !Number.isFinite(value))) {
      throw new WebGpuExecutionError(
        "diagnostic-failure",
        `WebGPU case ${this.definition.id} produced a non-finite diagnostic reduction.`,
      );
    }
    const recirculationLength = values[13]!;
    return {
      step,
      flowThroughTime,
      domainMass: values[0]!,
      inletFlux: values[1]!,
      outletFlux: values[2]!,
      density: {
        minimum: values[3]!,
        maximum: values[4]!,
        mean: values[5]!,
        nonFiniteValueCount: Math.round(values[6]!),
        nonPositiveValueCount: Math.round(values[7]!),
      },
      upstreamReflection: values[8]!,
      fieldResidual: this.hasAdvanced ? values[9]! : 0,
      symmetryError: values[10]!,
      dragCoefficient: values[11]!,
      liftCoefficient: values[12]!,
      ...(recirculationLength < 0 ? {} : { recirculationLength }),
    };
  }

  public async perturbWake(amplitude: number): Promise<void> {
    if (!Number.isFinite(amplitude) || amplitude <= 0) {
      throw new RangeError("Wake perturbation amplitude must be positive and finite.");
    }
    const populations = await this.readPopulations();
    const centreX = this.geometry.cylinderRearX + 0.75 * this.geometry.cylinderDiameter;
    const centreY = this.geometry.cylinderCenterY + 0.25 * this.geometry.cylinderDiameter;
    const radius = 0.5 * this.geometry.cylinderDiameter;
    const radiusSquared = radius * radius;
    for (let y = Math.floor(centreY - radius); y <= Math.ceil(centreY + radius); y += 1) {
      for (let x = Math.floor(centreX - radius); x <= Math.ceil(centreX + radius); x += 1) {
        const cell = y * this.geometry.width + x;
        if (this.geometry.solid[cell] === 1) continue;
        const distanceSquared = (x - centreX) ** 2 + (y - centreY) ** 2;
        if (distanceSquared > radiusSquared) continue;
        const state = macroscopic(populations, cell);
        const transverseVelocity =
          state.velocityY + amplitude * Math.exp(-4 * distanceSquared / radiusSquared);
        for (let direction = 0; direction < 9; direction += 1) {
          populations[cell * 9 + direction] = equilibriumPopulation(
            direction,
            state.density,
            state.velocityX,
            transverseVelocity,
          );
        }
      }
    }
    this.device.queue.writeBuffer(
      this.populationsAIsCurrent ? this.resources.populationsA : this.resources.populationsB,
      0,
      populations,
    );
  }

  public async renderFrame(
    flowThroughIncrement: number,
    tracersEnabled: boolean,
    encodingFocus: WakeEncodingFocus = "combined",
  ): Promise<{
    readonly width: number;
    readonly height: number;
    readonly pixels: Uint8ClampedArray;
  }> {
    if (!Number.isFinite(flowThroughIncrement) || flowThroughIncrement < 0) {
      throw new RangeError("WebGPU render flow-through increment must be finite and non-negative.");
    }
    this.parameterValues[WEBGPU_PARAMETER_INDEX.renderFlowIncrement] = flowThroughIncrement;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.tracersEnabled] = tracersEnabled ? 1 : 0;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.encodingFocus] =
      encodingFocus === "motion" ? 1 : encodingFocus === "rotation" ? 2 : 0;
    this.device.queue.writeBuffer(this.resources.parameters, 0, this.parameterValues);
    const byteLength = this.geometry.cellCount * Uint32Array.BYTES_PER_ELEMENT;
    const encoder = this.device.createCommandEncoder({
      label: `WebGPU ${this.definition.id} raster frame`,
    });
    const pass = encoder.beginComputePass();
    if (tracersEnabled && flowThroughIncrement > 0) {
      pass.setPipeline(this.pipelines.tracers);
      pass.setBindGroup(
        0,
        this.populationsAIsCurrent
          ? this.bindGroups.tracersA
          : this.bindGroups.tracersB,
      );
      pass.dispatchWorkgroups(Math.ceil(TRACER_COUNT / WORKGROUP_SIZE));
    }
    pass.setPipeline(this.pipelines.render);
    pass.setBindGroup(
      0,
      this.populationsAIsCurrent ? this.bindGroups.renderA : this.bindGroups.renderB,
    );
    pass.dispatchWorkgroups(Math.ceil(this.geometry.cellCount / WORKGROUP_SIZE));
    pass.end();
    encoder.copyBufferToBuffer(
      this.resources.renderPixels,
      0,
      this.resources.renderReadback,
      0,
      byteLength,
    );
    this.device.pushErrorScope("validation");
    this.device.queue.submit([encoder.finish()]);
    await this.submittedWork(`WebGPU case ${this.definition.id} raster render failed`);
    await this.resources.renderReadback.mapAsync(WEBGPU_MAP_MODE_READ, 0, byteLength);
    const pixels = new Uint8ClampedArray(
      this.resources.renderReadback.getMappedRange(0, byteLength),
    ).slice();
    this.resources.renderReadback.unmap();
    return { width: this.geometry.width, height: this.geometry.height, pixels };
  }

  public resetTracers(): void {
    this.device.queue.writeBuffer(
      this.resources.tracerStates,
      0,
      createInitialTracerStates(this.geometry),
    );
  }

  private async readPopulations(): Promise<Float32Array> {
    const byteLength = this.geometry.cellCount * 9 * Float32Array.BYTES_PER_ELEMENT;
    const encoder = this.device.createCommandEncoder({
      label: `WebGPU ${this.definition.id} field readback`,
    });
    encoder.copyBufferToBuffer(
      this.populationsAIsCurrent
        ? this.resources.populationsA
        : this.resources.populationsB,
      0,
      this.resources.fieldReadback,
      0,
      byteLength,
    );
    this.device.pushErrorScope("validation");
    this.device.queue.submit([encoder.finish()]);
    await this.submittedWork(`WebGPU case ${this.definition.id} field readback failed`);
    await this.resources.fieldReadback.mapAsync(WEBGPU_MAP_MODE_READ, 0, byteLength);
    const populations = new Float32Array(
      this.resources.fieldReadback.getMappedRange(0, byteLength),
    ).slice();
    this.resources.fieldReadback.unmap();
    return populations;
  }

  public dispose(): void {
    for (const buffer of Object.values(this.resources)) buffer.destroy();
  }

  private writeParameters(reynoldsNumber: number, stepsSinceSample: number): void {
    const relaxation = trtRelaxationRates(
      reynoldsNumber,
      this.cylinderDiameter,
      this.latticeSpeed,
    );
    const forceNormalizer =
      0.5 *
      D2Q9_OPEN_CYLINDER_CONTRACT.targetDensity *
      this.latticeSpeed *
      this.latticeSpeed *
      this.cylinderDiameter;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.width] = this.geometry.width;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.height] = this.geometry.height;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.cellCount] = this.geometry.cellCount;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.bounceCount] =
      this.geometry.bounceLinks.length;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.cylinderDiameter] =
      this.cylinderDiameter;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.cylinderCenterX] =
      this.geometry.cylinderCenterX;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.cylinderCenterY] =
      this.geometry.cylinderCenterY;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.cylinderRearX] =
      this.geometry.cylinderRearX;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.latticeSpeed] = this.latticeSpeed;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.omegaEven] = relaxation.omegaEven;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.omegaOdd] = relaxation.omegaOdd;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.forceNormalizer] = forceNormalizer;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.hasAdvanced] = this.hasAdvanced ? 1 : 0;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.upstreamReflectionMode] =
      this.definition.configuration.upstreamReflectionMode ===
      "streamwise-from-inlet"
        ? 1
        : 0;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.stepsSinceSample] = stepsSinceSample;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.inletMode] =
      this.definition.configuration.boundaries.inlet === "equilibrium-velocity" ? 1 : 0;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.lateralMode] =
      this.definition.configuration.boundaries.lateral === "periodic" ? 1 : 0;
    this.parameterValues[WEBGPU_PARAMETER_INDEX.outletMode] =
      this.definition.configuration.boundaries.outlet === "convective"
        ? 1
        : this.definition.configuration.boundaries.outlet === "extrapolated"
          ? 2
          : 0;
    this.device.queue.writeBuffer(this.resources.parameters, 0, this.parameterValues);
  }

  private async submittedWork(context: string): Promise<void> {
    const outcome = await Promise.race([
      this.device.queue.onSubmittedWorkDone().then(() => ({ kind: "complete" as const })),
      this.device.lost.then((information) => ({
        kind: "lost" as const,
        information,
      })),
    ]);
    const gpuError = await this.device.popErrorScope();
    if (outcome.kind === "lost") {
      throw new WebGpuExecutionError(
        "device-lost",
        `${context}: ${outcome.information.message ?? "the WebGPU device was lost"}.`,
      );
    }
    if (gpuError !== null) {
      throw new WebGpuExecutionError(
        "diagnostic-failure",
        `${context}: ${gpuError.message}.`,
      );
    }
  }
}

interface WebGpuResources {
  readonly parameters: WebGpuBufferHandle;
  readonly populationsA: WebGpuBufferHandle;
  readonly populationsB: WebGpuBufferHandle;
  readonly postCollision: WebGpuBufferHandle;
  readonly solid: WebGpuBufferHandle;
  readonly cutFraction: WebGpuBufferHandle;
  readonly bounceAway: WebGpuBufferHandle;
  readonly bounceLinks: WebGpuBufferHandle;
  readonly previousVelocityX: WebGpuBufferHandle;
  readonly previousVelocityY: WebGpuBufferHandle;
  readonly forcePartial: WebGpuBufferHandle;
  readonly forceAccumulation: WebGpuBufferHandle;
  readonly diagnostic: WebGpuBufferHandle;
  readonly readback: WebGpuBufferHandle;
  readonly fieldReadback: WebGpuBufferHandle;
  readonly renderPixels: WebGpuBufferHandle;
  readonly renderReadback: WebGpuBufferHandle;
  readonly tracerStates: WebGpuBufferHandle;
}

interface WebGpuPipelines {
  readonly compilationInfo: ReturnType<
    import("./webgpu-api.js").WebGpuShaderModuleHandle["getCompilationInfo"]
  >;
  readonly collision: WebGpuComputePipelineHandle;
  readonly stream: WebGpuComputePipelineHandle;
  readonly bounce: WebGpuComputePipelineHandle;
  readonly forceReduction: WebGpuComputePipelineHandle;
  readonly boundaries: WebGpuComputePipelineHandle;
  readonly diagnostic: WebGpuComputePipelineHandle;
  readonly render: WebGpuComputePipelineHandle;
  readonly tracers: WebGpuComputePipelineHandle;
}

interface StepBindGroups {
  readonly collision: WebGpuBindGroupHandle;
  readonly stream: WebGpuBindGroupHandle;
  readonly bounce: WebGpuBindGroupHandle;
  readonly boundaries: WebGpuBindGroupHandle;
}

interface WebGpuBindGroups {
  readonly aToB: StepBindGroups;
  readonly bToA: StepBindGroups;
  readonly forceReduction: WebGpuBindGroupHandle;
  readonly diagnosticA: WebGpuBindGroupHandle;
  readonly diagnosticB: WebGpuBindGroupHandle;
  readonly renderA: WebGpuBindGroupHandle;
  readonly renderB: WebGpuBindGroupHandle;
  readonly tracersA: WebGpuBindGroupHandle;
  readonly tracersB: WebGpuBindGroupHandle;
}

function createResources(
  device: WebGpuDeviceHandle,
  geometry: OpenCylinderGeometry,
  latticeSpeed: number,
): WebGpuResources {
  const populationCount = geometry.cellCount * 9;
  const populations = createInitialPopulations(geometry, latticeSpeed, 0);
  const solid = Uint32Array.from(geometry.solid);
  const cutFraction = Float32Array.from(geometry.cutFraction);
  const bounceAway = geometry.bounceAway;
  const bounceLinks = Uint32Array.from(geometry.bounceLinks);
  const bounceCount = Math.max(1, geometry.bounceLinks.length);
  return {
    parameters: createBuffer(
      device,
      "parameters",
      new Float32Array(WEBGPU_PARAMETER_COUNT),
    ),
    populationsA: createBuffer(
      device,
      "populations A",
      populations,
      WEBGPU_BUFFER_USAGE.copySrc,
    ),
    populationsB: createBuffer(
      device,
      "populations B",
      new Float32Array(populationCount),
      WEBGPU_BUFFER_USAGE.copySrc,
    ),
    postCollision: createBuffer(
      device,
      "post-collision populations",
      new Float32Array(populationCount),
    ),
    solid: createBuffer(device, "solid mask", solid),
    cutFraction: createBuffer(device, "BFL cut fractions", cutFraction),
    bounceAway: createBuffer(device, "BFL away links", bounceAway),
    bounceLinks: createBuffer(
      device,
      "BFL bounce links",
      bounceLinks.length === 0 ? new Uint32Array(1) : bounceLinks,
    ),
    previousVelocityX: createBuffer(
      device,
      "previous velocity x",
      new Float32Array(geometry.cellCount),
    ),
    previousVelocityY: createBuffer(
      device,
      "previous velocity y",
      new Float32Array(geometry.cellCount),
    ),
    forcePartial: createBuffer(
      device,
      "BFL force partials",
      new Float32Array(bounceCount * 2),
    ),
    forceAccumulation: createBuffer(
      device,
      "force accumulation",
      new Float32Array(2),
    ),
    diagnostic: createBuffer(
      device,
      "diagnostic reduction",
      new Float32Array(DIAGNOSTIC_VALUE_COUNT),
      WEBGPU_BUFFER_USAGE.copySrc,
    ),
    readback: device.createBuffer({
      label: "limited diagnostic readback",
      size: DIAGNOSTIC_VALUE_COUNT * Float32Array.BYTES_PER_ELEMENT,
      usage: WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.mapRead,
    }),
    fieldReadback: device.createBuffer({
      label: "interactive field readback",
      size: populationCount * Float32Array.BYTES_PER_ELEMENT,
      usage: WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.mapRead,
    }),
    renderPixels: createBuffer(
      device,
      "GPU-rendered RGBA pixels",
      new Uint32Array(geometry.cellCount),
      WEBGPU_BUFFER_USAGE.copySrc,
    ),
    renderReadback: device.createBuffer({
      label: "GPU-rendered frame readback",
      size: geometry.cellCount * Uint32Array.BYTES_PER_ELEMENT,
      usage: WEBGPU_BUFFER_USAGE.copyDst | WEBGPU_BUFFER_USAGE.mapRead,
    }),
    tracerStates: createBuffer(
      device,
      "GPU passive tracer states",
      createInitialTracerStates(geometry),
    ),
  };
}

function createInitialPopulations(
  geometry: OpenCylinderGeometry,
  latticeSpeed: number,
  perturbation: number,
): Float32Array {
  const populations = new Float32Array(geometry.cellCount * 9);
  const perturbationCentreX = geometry.cylinderRearX + 0.75 * geometry.cylinderDiameter;
  const perturbationCentreY = geometry.cylinderCenterY + 0.25 * geometry.cylinderDiameter;
  const perturbationRadius = 0.5 * geometry.cylinderDiameter;
  for (let cell = 0; cell < geometry.cellCount; cell += 1) {
    const x = cell % geometry.width;
    const y = Math.floor(cell / geometry.width);
    const distanceSquared =
      (x - perturbationCentreX) ** 2 + (y - perturbationCentreY) ** 2;
    const transverseVelocity =
      perturbation > 0 &&
      geometry.solid[cell] === 0 &&
      distanceSquared <= perturbationRadius * perturbationRadius
        ? perturbation *
          Math.exp(
            (-4 * distanceSquared) /
              (perturbationRadius * perturbationRadius),
          )
        : 0;
    for (let direction = 0; direction < 9; direction += 1) {
      populations[cell * 9 + direction] = equilibriumPopulation(
        direction,
        D2Q9_OPEN_CYLINDER_CONTRACT.targetDensity,
        latticeSpeed,
        transverseVelocity,
      );
    }
  }
  return populations;
}

function createInitialTracerStates(geometry: OpenCylinderGeometry): Float32Array {
  const states = new Float32Array(TRACER_COUNT * 4);
  for (let tracer = 0; tracer < TRACER_COUNT; tracer += 1) {
    const lane = tracer % Math.max(1, geometry.height - 2);
    const column = tracer % 12;
    const x = 1 + (column / 12) * Math.max(1, geometry.width - 3);
    const y = 1 + ((lane * 37) % Math.max(1, geometry.height - 2));
    states[tracer * 4] = x;
    states[tracer * 4 + 1] = y;
    states[tracer * 4 + 2] = x;
    states[tracer * 4 + 3] = y;
  }
  return states;
}

function macroscopic(
  populations: Float32Array,
  cell: number,
): { readonly density: number; readonly velocityX: number; readonly velocityY: number } {
  let density = 0;
  let momentumX = 0;
  let momentumY = 0;
  for (let direction = 0; direction < 9; direction += 1) {
    const population = populations[cell * 9 + direction]!;
    density += population;
    momentumX += population * D2Q9_OPEN_CYLINDER_CONTRACT.directions[direction]![0];
    momentumY += population * D2Q9_OPEN_CYLINDER_CONTRACT.directions[direction]![1];
  }
  return {
    density,
    velocityX: density > 0 ? momentumX / density : 0,
    velocityY: density > 0 ? momentumY / density : 0,
  };
}

function createBuffer(
  device: WebGpuDeviceHandle,
  label: string,
  data: ArrayBufferView,
  additionalUsage = 0,
): WebGpuBufferHandle {
  const buffer = device.createBuffer({
    label,
    size: Math.max(4, Math.ceil(data.byteLength / 4) * 4),
    usage:
      WEBGPU_BUFFER_USAGE.storage |
      WEBGPU_BUFFER_USAGE.copyDst |
      additionalUsage,
  });
  if (data.byteLength > 0) device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

function createPipelines(device: WebGpuDeviceHandle): WebGpuPipelines {
  const module = device.createShaderModule({
    label: "D2Q9 TRT/BFL WebGPU validation shader",
    code: WEBGPU_VALIDATION_SHADER,
  });
  const pipeline = (entryPoint: string) =>
    device.createComputePipeline({
      label: `WebGPU ${entryPoint}`,
      layout: "auto",
      compute: { module, entryPoint },
    });
  return {
    compilationInfo: module.getCompilationInfo(),
    collision: pipeline("collision"),
    stream: pipeline("stream"),
    bounce: pipeline("bounce"),
    forceReduction: pipeline("reduce_force"),
    boundaries: pipeline("apply_boundaries"),
    diagnostic: pipeline("reduce_diagnostics"),
    render: pipeline("render_vorticity"),
    tracers: pipeline("advance_tracers"),
  };
}

function createBindGroups(
  device: WebGpuDeviceHandle,
  pipelines: WebGpuPipelines,
  resources: WebGpuResources,
): WebGpuBindGroups {
  const group = (
    label: string,
    pipeline: WebGpuComputePipelineHandle,
    buffers: readonly (readonly [number, WebGpuBufferHandle])[],
  ) =>
    device.createBindGroup({
      label,
      layout: pipeline.getBindGroupLayout(0),
      entries: buffers.map(([binding, buffer]) => ({
        binding,
        resource: { buffer },
      })),
    });
  const stepGroups = (
    label: string,
    current: WebGpuBufferHandle,
    next: WebGpuBufferHandle,
  ): StepBindGroups => ({
    collision: group(`${label} collision`, pipelines.collision, [
      [0, resources.parameters],
      [1, current],
      [2, resources.postCollision],
      [3, resources.solid],
      [4, resources.previousVelocityX],
      [5, resources.previousVelocityY],
    ]),
    stream: group(`${label} stream`, pipelines.stream, [
      [0, resources.parameters],
      [6, resources.postCollision],
      [7, next],
      [8, resources.solid],
    ]),
    bounce: group(`${label} bounce`, pipelines.bounce, [
      [0, resources.parameters],
      [9, resources.postCollision],
      [10, next],
      [11, resources.cutFraction],
      [12, resources.bounceAway],
      [13, resources.bounceLinks],
      [14, resources.forcePartial],
    ]),
    boundaries: group(`${label} boundaries`, pipelines.boundaries, [
      [0, resources.parameters],
      [17, resources.postCollision],
      [18, next],
      [25, current],
    ]),
  });
  const diagnostic = (label: string, populations: WebGpuBufferHandle) =>
    group(label, pipelines.diagnostic, [
      [0, resources.parameters],
      [19, populations],
      [20, resources.solid],
      [21, resources.previousVelocityX],
      [22, resources.previousVelocityY],
      [23, resources.forceAccumulation],
      [24, resources.diagnostic],
    ]);
  const render = (label: string, populations: WebGpuBufferHandle) =>
    group(label, pipelines.render, [
      [0, resources.parameters],
      [26, populations],
      [27, resources.solid],
      [28, resources.renderPixels],
      [31, resources.tracerStates],
    ]);
  const tracers = (label: string, populations: WebGpuBufferHandle) =>
    group(label, pipelines.tracers, [
      [0, resources.parameters],
      [29, populations],
      [30, resources.solid],
      [31, resources.tracerStates],
    ]);
  return {
    aToB: stepGroups("A to B", resources.populationsA, resources.populationsB),
    bToA: stepGroups("B to A", resources.populationsB, resources.populationsA),
    forceReduction: group("force reduction", pipelines.forceReduction, [
      [0, resources.parameters],
      [15, resources.forcePartial],
      [16, resources.forceAccumulation],
    ]),
    diagnosticA: diagnostic("diagnostic A", resources.populationsA),
    diagnosticB: diagnostic("diagnostic B", resources.populationsB),
    renderA: render("render A", resources.populationsA),
    renderB: render("render B", resources.populationsB),
    tracersA: tracers("tracers A", resources.populationsA),
    tracersB: tracers("tracers B", resources.populationsB),
  };
}

function dispatchStep(
  pass: WebGpuComputePassHandle,
  pipelines: WebGpuPipelines,
  bindGroups: StepBindGroups,
  forceReduction: WebGpuBindGroupHandle,
  geometry: OpenCylinderGeometry,
): void {
  pass.setPipeline(pipelines.collision);
  pass.setBindGroup(0, bindGroups.collision);
  pass.dispatchWorkgroups(Math.ceil(geometry.cellCount / WORKGROUP_SIZE));
  pass.setPipeline(pipelines.stream);
  pass.setBindGroup(0, bindGroups.stream);
  pass.dispatchWorkgroups(Math.ceil((geometry.cellCount * 9) / WORKGROUP_SIZE));
  pass.setPipeline(pipelines.bounce);
  pass.setBindGroup(0, bindGroups.bounce);
  pass.dispatchWorkgroups(
    Math.max(1, Math.ceil(geometry.bounceLinks.length / WORKGROUP_SIZE)),
  );
  pass.setPipeline(pipelines.forceReduction);
  pass.setBindGroup(0, forceReduction);
  pass.dispatchWorkgroups(1);
  pass.setPipeline(pipelines.boundaries);
  pass.setBindGroup(0, bindGroups.boundaries);
  pass.dispatchWorkgroups(1);
}

function validateWebGpuConfiguration(definition: ValidationCaseDefinition): void {
  const boundaries = definition.configuration.boundaries;
  if (
    definition.configuration.backendId !== "webgpu-reference" ||
    definition.configuration.collision !== "D2Q9 TRT" ||
    definition.configuration.precision !== "float32" ||
    !["regularized-velocity", "equilibrium-velocity"].includes(boundaries.inlet) ||
    !["free-slip", "periodic"].includes(boundaries.lateral) ||
    !["fixed-density-nee", "convective", "extrapolated"].includes(boundaries.outlet) ||
    boundaries.cylinder !== "linear-bfl"
  ) {
    throw new Error(
      `Case ${definition.id} is incompatible with the WebGPU TRT/BFL open-boundary contract.`,
    );
  }
}

const WEBGPU_VALIDATION_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> parameters: array<f32>;

fn width() -> u32 { return u32(parameters[${WEBGPU_PARAMETER_INDEX.width}]); }
fn height() -> u32 { return u32(parameters[${WEBGPU_PARAMETER_INDEX.height}]); }
fn cell_count() -> u32 { return u32(parameters[${WEBGPU_PARAMETER_INDEX.cellCount}]); }
fn bounce_count() -> u32 { return u32(parameters[${WEBGPU_PARAMETER_INDEX.bounceCount}]); }
fn cylinder_diameter() -> f32 { return parameters[${WEBGPU_PARAMETER_INDEX.cylinderDiameter}]; }
fn cylinder_center_y() -> f32 { return parameters[${WEBGPU_PARAMETER_INDEX.cylinderCenterY}]; }
fn cylinder_rear_x() -> f32 { return parameters[${WEBGPU_PARAMETER_INDEX.cylinderRearX}]; }
fn lattice_speed() -> f32 { return parameters[${WEBGPU_PARAMETER_INDEX.latticeSpeed}]; }
fn omega_even() -> f32 { return parameters[${WEBGPU_PARAMETER_INDEX.omegaEven}]; }
fn omega_odd() -> f32 { return parameters[${WEBGPU_PARAMETER_INDEX.omegaOdd}]; }
fn force_normalizer() -> f32 { return parameters[${WEBGPU_PARAMETER_INDEX.forceNormalizer}]; }
fn has_advanced() -> bool { return parameters[${WEBGPU_PARAMETER_INDEX.hasAdvanced}] >= 0.5; }
fn streamwise_reflection_mode() -> bool { return parameters[${WEBGPU_PARAMETER_INDEX.upstreamReflectionMode}] >= 0.5; }
fn steps_since_sample() -> f32 { return max(parameters[${WEBGPU_PARAMETER_INDEX.stepsSinceSample}], 1.0); }
fn equilibrium_inlet() -> bool { return parameters[${WEBGPU_PARAMETER_INDEX.inletMode}] >= 0.5; }
fn periodic_lateral() -> bool { return parameters[${WEBGPU_PARAMETER_INDEX.lateralMode}] >= 0.5; }
fn outlet_mode() -> u32 { return u32(parameters[${WEBGPU_PARAMETER_INDEX.outletMode}]); }
fn render_flow_increment() -> f32 { return parameters[${WEBGPU_PARAMETER_INDEX.renderFlowIncrement}]; }
fn tracers_enabled() -> bool { return parameters[${WEBGPU_PARAMETER_INDEX.tracersEnabled}] >= 0.5; }
fn encoding_focus() -> u32 { return u32(parameters[${WEBGPU_PARAMETER_INDEX.encodingFocus}]); }

fn cx(direction: u32) -> i32 {
  let values = array<i32, 9>(${WGSL_CX});
  return values[direction];
}
fn cy(direction: u32) -> i32 {
  let values = array<i32, 9>(${WGSL_CY});
  return values[direction];
}
fn opposite(direction: u32) -> u32 {
  let values = array<u32, 9>(${WGSL_OPPOSITE});
  return values[direction];
}
fn weight(direction: u32) -> f32 {
  let values = array<f32, 9>(${WGSL_WEIGHTS});
  return values[direction];
}
fn equilibrium(direction: u32, rho: f32, ux: f32, uy: f32) -> f32 {
  let projection = f32(cx(direction)) * ux + f32(cy(direction)) * uy;
  let velocity_squared = ux * ux + uy * uy;
  return weight(direction) * rho * (1.0 + 3.0 * projection + 4.5 * projection * projection - 1.5 * velocity_squared);
}
fn finite(value: f32) -> bool {
  return value == value && abs(value) <= 3.402823466e+38;
}
fn macroscopic_values(
  f0: f32,
  f1: f32,
  f2: f32,
  f3: f32,
  f4: f32,
  f5: f32,
  f6: f32,
  f7: f32,
  f8: f32,
) -> vec3<f32> {
  let rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
  return vec3<f32>(rho, (f1 - f3 + f5 - f6 - f7 + f8) / rho, (f2 - f4 + f5 + f6 - f7 - f8) / rho);
}

@group(0) @binding(1) var<storage, read> collision_input: array<f32>;
@group(0) @binding(2) var<storage, read_write> post_collision: array<f32>;
@group(0) @binding(3) var<storage, read> collision_solid: array<u32>;
@group(0) @binding(4) var<storage, read_write> previous_ux: array<f32>;
@group(0) @binding(5) var<storage, read_write> previous_uy: array<f32>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn collision(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.x;
  if (cell >= cell_count() || collision_solid[cell] == 1u) { return; }
  let base = cell * 9u;
  let f0 = collision_input[base];
  let f1 = collision_input[base + 1u];
  let f2 = collision_input[base + 2u];
  let f3 = collision_input[base + 3u];
  let f4 = collision_input[base + 4u];
  let f5 = collision_input[base + 5u];
  let f6 = collision_input[base + 6u];
  let f7 = collision_input[base + 7u];
  let f8 = collision_input[base + 8u];
  let rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
  let ux = (f1 - f3 + f5 - f6 - f7 + f8) / rho;
  let uy = (f2 - f4 + f5 + f6 - f7 - f8) / rho;
  previous_ux[cell] = ux;
  previous_uy[cell] = uy;
  var f = array<f32, 9>(f0, f1, f2, f3, f4, f5, f6, f7, f8);
  var e: array<f32, 9>;
  for (var direction = 0u; direction < 9u; direction += 1u) {
    e[direction] = equilibrium(direction, rho, ux, uy);
  }
  post_collision[base] = f0 - omega_even() * (f0 - e[0]);
  let pairs = array<vec2<u32>, 4>(vec2<u32>(1u, 3u), vec2<u32>(2u, 4u), vec2<u32>(5u, 7u), vec2<u32>(6u, 8u));
  for (var pair_index = 0u; pair_index < 4u; pair_index += 1u) {
    let pair = pairs[pair_index];
    let even_relaxation = omega_even() * (0.5 * (f[pair.x] + f[pair.y]) - 0.5 * (e[pair.x] + e[pair.y]));
    let odd_relaxation = omega_odd() * (0.5 * (f[pair.x] - f[pair.y]) - 0.5 * (e[pair.x] - e[pair.y]));
    post_collision[base + pair.x] = f[pair.x] - even_relaxation - odd_relaxation;
    post_collision[base + pair.y] = f[pair.y] - even_relaxation + odd_relaxation;
  }
}

@group(0) @binding(6) var<storage, read> stream_post: array<f32>;
@group(0) @binding(7) var<storage, read_write> stream_next: array<f32>;
@group(0) @binding(8) var<storage, read> stream_solid: array<u32>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn stream(@builtin(global_invocation_id) id: vec3<u32>) {
  let link = id.x;
  if (link >= cell_count() * 9u) { return; }
  let cell = link / 9u;
  let direction = link % 9u;
  if (stream_solid[cell] == 1u) { stream_next[link] = 0.0; return; }
  if (direction == 0u) { stream_next[link] = stream_post[link]; return; }
  let x = i32(cell % width());
  let y = i32(cell / width());
  let source_x = x - cx(direction);
  var source_y = y - cy(direction);
  if (periodic_lateral()) {
    if (source_y < 0) { source_y += i32(height()); }
    if (source_y >= i32(height())) { source_y -= i32(height()); }
  }
  if (source_x < 0 || source_x >= i32(width()) || source_y < 0 || source_y >= i32(height())) {
    stream_next[link] = 0.0;
    return;
  }
  let source = u32(source_y) * width() + u32(source_x);
  stream_next[link] = select(0.0, stream_post[source * 9u + direction], stream_solid[source] == 0u);
}

@group(0) @binding(9) var<storage, read> bounce_post: array<f32>;
@group(0) @binding(10) var<storage, read_write> bounce_next: array<f32>;
@group(0) @binding(11) var<storage, read> cut_fraction: array<f32>;
@group(0) @binding(12) var<storage, read> bounce_away: array<i32>;
@group(0) @binding(13) var<storage, read> bounce_links: array<u32>;
@group(0) @binding(14) var<storage, read_write> force_partial: array<vec2<f32>>;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn bounce(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= bounce_count()) { return; }
  let link = bounce_links[index];
  let base = link - link % 9u;
  let direction = link % 9u;
  let outgoing = bounce_post[link];
  let fraction = cut_fraction[link];
  var reflected = 0.0;
  if (fraction < 0.5) {
    reflected = 2.0 * fraction * outgoing + (1.0 - 2.0 * fraction) * bounce_post[u32(bounce_away[link])];
  } else {
    reflected = outgoing / (2.0 * fraction) + ((2.0 * fraction - 1.0) / (2.0 * fraction)) * bounce_post[base + opposite(direction)];
  }
  bounce_next[base + opposite(direction)] = reflected;
  force_partial[index] = (outgoing + reflected) * vec2<f32>(f32(cx(direction)), f32(cy(direction)));
}

@group(0) @binding(15) var<storage, read> reduction_force_partial: array<vec2<f32>>;
@group(0) @binding(16) var<storage, read_write> force_accumulation: array<f32>;

@compute @workgroup_size(1)
fn reduce_force() {
  var force = vec2<f32>(0.0);
  for (var index = 0u; index < bounce_count(); index += 1u) {
    force += reduction_force_partial[index];
  }
  force_accumulation[0] += force.x;
  force_accumulation[1] += force.y;
}

@group(0) @binding(17) var<storage, read> boundary_post: array<f32>;
@group(0) @binding(18) var<storage, read_write> boundary_next: array<f32>;
@group(0) @binding(25) var<storage, read> boundary_current: array<f32>;

fn boundary_macro(base: u32) -> vec3<f32> {
  let f0 = boundary_next[base];
  let f1 = boundary_next[base + 1u];
  let f2 = boundary_next[base + 2u];
  let f3 = boundary_next[base + 3u];
  let f4 = boundary_next[base + 4u];
  let f5 = boundary_next[base + 5u];
  let f6 = boundary_next[base + 6u];
  let f7 = boundary_next[base + 7u];
  let f8 = boundary_next[base + 8u];
  let rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
  return vec3<f32>(rho, (f1 - f3 + f5 - f6 - f7 + f8) / rho, (f2 - f4 + f5 + f6 - f7 - f8) / rho);
}
fn inlet_density(base: u32) -> f32 {
  return (boundary_next[base] + boundary_next[base + 2u] + boundary_next[base + 4u] + 2.0 * (boundary_next[base + 3u] + boundary_next[base + 6u] + boundary_next[base + 7u])) / (1.0 - lattice_speed());
}

@compute @workgroup_size(1)
fn apply_boundaries() {
  if (!periodic_lateral()) {
    for (var x = 0u; x < width(); x += 1u) {
      let bottom = x * 9u;
      boundary_next[bottom + 2u] = boundary_post[bottom + 4u];
      boundary_next[bottom + 5u] = boundary_post[bottom + 8u];
      boundary_next[bottom + 6u] = boundary_post[bottom + 7u];
      let top = ((height() - 1u) * width() + x) * 9u;
      boundary_next[top + 4u] = boundary_post[top + 2u];
      boundary_next[top + 7u] = boundary_post[top + 6u];
      boundary_next[top + 8u] = boundary_post[top + 5u];
    }
  }
  for (var y = 0u; y < height(); y += 1u) {
    let base = (y * width()) * 9u;
    let neighbour_base = (y * width() + 1u) * 9u;
    let rho = inlet_density(base);
    if (equilibrium_inlet()) {
      for (var direction = 0u; direction < 9u; direction += 1u) {
        boundary_next[base + direction] = equilibrium(direction, rho, lattice_speed(), 0.0);
      }
      continue;
    }
    let neighbour = boundary_macro(neighbour_base);
    var stress_xx = 0.0;
    var stress_xy = 0.0;
    var stress_yy = 0.0;
    for (var direction = 0u; direction < 9u; direction += 1u) {
      let non_equilibrium = boundary_next[neighbour_base + direction] - equilibrium(direction, neighbour.x, neighbour.y, neighbour.z);
      stress_xx += non_equilibrium * f32(cx(direction) * cx(direction));
      stress_xy += non_equilibrium * f32(cx(direction) * cy(direction));
      stress_yy += non_equilibrium * f32(cy(direction) * cy(direction));
    }
    for (var direction = 0u; direction < 9u; direction += 1u) {
      let qxx = f32(cx(direction) * cx(direction)) - 1.0 / 3.0;
      let qxy = f32(cx(direction) * cy(direction));
      let qyy = f32(cy(direction) * cy(direction)) - 1.0 / 3.0;
      let regularized = 4.5 * weight(direction) * (qxx * stress_xx + 2.0 * qxy * stress_xy + qyy * stress_yy);
      boundary_next[base + direction] = equilibrium(direction, rho, lattice_speed(), 0.0) + regularized;
    }
  }
  for (var y = 0u; y < height(); y += 1u) {
    let base = (y * width() + width() - 1u) * 9u;
    let neighbour_base = base - 9u;
    if (outlet_mode() == 1u) {
      let denominator = 1.0 + lattice_speed();
      for (var direction = 0u; direction < 9u; direction += 1u) {
        boundary_next[base + direction] = (boundary_current[base + direction] + lattice_speed() * boundary_next[neighbour_base + direction]) / denominator;
      }
      continue;
    }
    if (outlet_mode() == 2u) {
      for (var direction = 0u; direction < 9u; direction += 1u) {
        boundary_next[base + direction] = boundary_next[neighbour_base + direction];
      }
      continue;
    }
    let neighbour = boundary_macro(neighbour_base);
    for (var direction = 0u; direction < 9u; direction += 1u) {
      let non_equilibrium = boundary_next[neighbour_base + direction] - equilibrium(direction, neighbour.x, neighbour.y, neighbour.z);
      boundary_next[base + direction] = equilibrium(direction, 1.0, neighbour.y, neighbour.z) + non_equilibrium;
    }
  }
}

@group(0) @binding(26) var<storage, read> render_populations: array<f32>;
@group(0) @binding(27) var<storage, read> render_solid: array<u32>;
@group(0) @binding(28) var<storage, read_write> render_pixels: array<u32>;
@group(0) @binding(29) var<storage, read> tracer_populations: array<f32>;
@group(0) @binding(30) var<storage, read> tracer_solid: array<u32>;
@group(0) @binding(31) var<storage, read_write> tracer_states: array<vec4<f32>>;

fn tracer_macro(base: u32) -> vec3<f32> {
  return macroscopic_values(
    tracer_populations[base],
    tracer_populations[base + 1u],
    tracer_populations[base + 2u],
    tracer_populations[base + 3u],
    tracer_populations[base + 4u],
    tracer_populations[base + 5u],
    tracer_populations[base + 6u],
    tracer_populations[base + 7u],
    tracer_populations[base + 8u],
  );
}

fn render_macro(base: u32) -> vec3<f32> {
  return macroscopic_values(
    render_populations[base],
    render_populations[base + 1u],
    render_populations[base + 2u],
    render_populations[base + 3u],
    render_populations[base + 4u],
    render_populations[base + 5u],
    render_populations[base + 6u],
    render_populations[base + 7u],
    render_populations[base + 8u],
  );
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn advance_tracers(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let tracer = invocation.x;
  if (tracer >= ${TRACER_COUNT}u) { return; }
  let state = tracer_states[tracer];
  let px = u32(clamp(round(state.x), 0.0, f32(width() - 1u)));
  let py = u32(clamp(round(state.y), 0.0, f32(height() - 1u)));
  let cell = py * width() + px;
  let velocity = tracer_macro(cell * 9u).yz;
  let lattice_steps = render_flow_increment() * cylinder_diameter() / lattice_speed();
  var next = state.xy + velocity * lattice_steps;
  var previous = state.xy;
  let next_x = u32(clamp(round(next.x), 0.0, f32(width() - 1u)));
  let next_y = u32(clamp(round(next.y), 0.0, f32(height() - 1u)));
  let next_cell = next_y * width() + next_x;
  if (
    next.x < 1.0 || next.x >= f32(width() - 1u) ||
    next.y < 1.0 || next.y >= f32(height() - 1u) ||
    tracer_solid[next_cell] == 1u
  ) {
    next = vec2<f32>(1.0, 1.0 + f32((tracer * 37u) % (height() - 2u)));
    previous = next;
  }
  tracer_states[tracer] = vec4<f32>(next, previous);
}

fn pack_rgba(red: f32, green: f32, blue: f32) -> u32 {
  let r = u32(clamp(round(red), 0.0, 255.0));
  let g = u32(clamp(round(green), 0.0, 255.0));
  let b = u32(clamp(round(blue), 0.0, 255.0));
  return r | (g << 8u) | (b << 16u) | (255u << 24u);
}

fn segment_distance(point: vec2<f32>, start: vec2<f32>, finish: vec2<f32>) -> f32 {
  let segment = finish - start;
  let length_squared = dot(segment, segment);
  let position = segment_progress(point, start, finish);
  return distance(point, start + position * segment);
}

fn segment_progress(point: vec2<f32>, start: vec2<f32>, finish: vec2<f32>) -> f32 {
  let segment = finish - start;
  let length_squared = dot(segment, segment);
  return select(0.0, clamp(dot(point - start, segment) / length_squared, 0.0, 1.0), length_squared > 0.0);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn render_vorticity(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let cell = invocation.x;
  if (cell >= cell_count()) { return; }
  if (render_solid[cell] == 1u) {
    render_pixels[cell] = pack_rgba(232.0, 235.0, 238.0);
    return;
  }
  let x = cell % width();
  let y = cell / width();
  var normalised = 0.0;
  if (x > 0u && y > 0u && x + 1u < width() && y + 1u < height()) {
    let left = render_macro((cell - 1u) * 9u);
    let right = render_macro((cell + 1u) * 9u);
    let below = render_macro((cell - width()) * 9u);
    let above = render_macro((cell + width()) * 9u);
    let vorticity = 0.5 * (right.z - left.z - above.y + below.y);
    normalised = clamp(vorticity * cylinder_diameter() / lattice_speed(), -2.0, 2.0);
  }
  var amount = pow(abs(normalised) / 2.0, 0.72);
  if (encoding_focus() == 1u) { amount *= 0.28; }
  let target_colour = select(vec3<f32>(223.0, 153.0, 92.0), vec3<f32>(99.0, 169.0, 223.0), normalised < 0.0);
  var colour = mix(vec3<f32>(23.0, 26.0, 31.0), target_colour, amount);
  if (tracers_enabled()) {
    let point = vec2<f32>(f32(x) + 0.5, f32(y) + 0.5);
    var nearest = 2.0;
    var nearest_direction_emphasis = 1.0;
    for (var tracer = 0u; tracer < ${TRACER_COUNT}u; tracer += 1u) {
      let state = tracer_states[tracer];
      let distance_to_tracer = segment_distance(point, state.zw, state.xy);
      if (distance_to_tracer < nearest) {
        nearest = distance_to_tracer;
        nearest_direction_emphasis = ${WEBGPU_TRACER_TAIL_EMPHASIS}
          + ${1 - WEBGPU_TRACER_TAIL_EMPHASIS} * segment_progress(point, state.zw, state.xy);
      }
    }
    let tracer_emphasis = select(1.0, 0.2, encoding_focus() == 2u);
    if (nearest < 1.35) {
      var halo_colour = select(
        vec3<f32>(246.0, 173.0, 85.0),
        vec3<f32>(99.0, 179.0, 237.0),
        normalised < 0.0,
      );
      if (abs(normalised) < 0.08) { halo_colour = vec3<f32>(203.0, 213.0, 224.0); }
      let halo_opacity = 0.68 * (1.0 - nearest / 1.35) * tracer_emphasis * nearest_direction_emphasis;
      colour = mix(colour, halo_colour, halo_opacity);
    }
    if (nearest < 0.52) {
      let core_opacity = 0.92 * (1.0 - nearest / 0.52) * tracer_emphasis * nearest_direction_emphasis;
      colour = mix(colour, vec3<f32>(245.0, 247.0, 250.0), core_opacity);
    }
  }
  render_pixels[cell] = pack_rgba(colour.x, colour.y, colour.z);
}

@group(0) @binding(19) var<storage, read> diagnostic_populations: array<f32>;
@group(0) @binding(20) var<storage, read> diagnostic_solid: array<u32>;
@group(0) @binding(21) var<storage, read> diagnostic_previous_ux: array<f32>;
@group(0) @binding(22) var<storage, read> diagnostic_previous_uy: array<f32>;
@group(0) @binding(23) var<storage, read> diagnostic_force: array<f32>;
@group(0) @binding(24) var<storage, read_write> diagnostic_output: array<f32>;

fn diagnostic_macro(base: u32) -> vec3<f32> {
  return macroscopic_values(
    diagnostic_populations[base],
    diagnostic_populations[base + 1u],
    diagnostic_populations[base + 2u],
    diagnostic_populations[base + 3u],
    diagnostic_populations[base + 4u],
    diagnostic_populations[base + 5u],
    diagnostic_populations[base + 6u],
    diagnostic_populations[base + 7u],
    diagnostic_populations[base + 8u],
  );
}

fn kahan(state: vec2<f32>, value: f32) -> vec2<f32> {
  let adjusted = value - state.y;
  let total = state.x + adjusted;
  return vec2<f32>(total, (total - state.x) - adjusted);
}

@compute @workgroup_size(1)
fn reduce_diagnostics() {
  var mass = vec2<f32>(0.0);
  var inlet_flux = vec2<f32>(0.0);
  var outlet_flux = vec2<f32>(0.0);
  var residual_difference = vec2<f32>(0.0);
  var residual_reference = vec2<f32>(0.0);
  var density_minimum = 3.402823466e+38;
  var density_maximum = -3.402823466e+38;
  var fluid_cells = 0u;
  var non_finite = 0u;
  var non_positive = 0u;
  for (var cell = 0u; cell < cell_count(); cell += 1u) {
    if (diagnostic_solid[cell] == 1u) { continue; }
    let values = diagnostic_macro(cell * 9u);
    if (!finite(values.x)) { non_finite += 1u; }
    if (!finite(values.y)) { non_finite += 1u; }
    if (!finite(values.z)) { non_finite += 1u; }
    if (values.x <= 0.0) { non_positive += 1u; }
    density_minimum = min(density_minimum, values.x);
    density_maximum = max(density_maximum, values.x);
    mass = kahan(mass, values.x);
    fluid_cells += 1u;
    let difference_x = values.y - diagnostic_previous_ux[cell];
    let difference_y = values.z - diagnostic_previous_uy[cell];
    residual_difference = kahan(residual_difference, difference_x * difference_x + difference_y * difference_y);
    residual_reference = kahan(residual_reference, values.y * values.y + values.z * values.z);
    let x = cell % width();
    if (x == 0u) { inlet_flux = kahan(inlet_flux, values.x * values.y); }
    if (x == width() - 1u) { outlet_flux = kahan(outlet_flux, values.x * values.y); }
  }

  var reflection = vec2<f32>(0.0);
  var upstream_mean = vec2<f32>(0.0);
  let probe_count = height() - 2u;
  if (!streamwise_reflection_mode()) {
    for (var y = 1u; y < height() - 1u; y += 1u) {
      let values = diagnostic_macro((y * width() + 1u) * 9u);
      upstream_mean = kahan(upstream_mean, values.y);
    }
    upstream_mean.x /= f32(probe_count);
  } else {
    upstream_mean.x = lattice_speed();
  }
  for (var y = 1u; y < height() - 1u; y += 1u) {
    let values = diagnostic_macro((y * width() + 1u) * 9u);
    let dx = values.y - upstream_mean.x;
    let disturbance = select(dx * dx + values.z * values.z, dx * dx, streamwise_reflection_mode());
    reflection = kahan(reflection, disturbance);
  }

  var symmetry_difference = vec2<f32>(0.0);
  var symmetry_reference = vec2<f32>(0.0);
  let centre_y = u32(round(cylinder_center_y()));
  let start_x = u32(ceil(cylinder_rear_x()));
  let end_x = min(width() - 2u, u32(floor(cylinder_rear_x() + 8.0 * cylinder_diameter())));
  var y_offset = 1u;
  loop {
    if (centre_y < y_offset || centre_y + y_offset >= height() - 1u) { break; }
    for (var x = start_x; x <= end_x; x += 1u) {
      let upper_cell = (centre_y + y_offset) * width() + x;
      let lower_cell = (centre_y - y_offset) * width() + x;
      if (diagnostic_solid[upper_cell] == 1u || diagnostic_solid[lower_cell] == 1u) { continue; }
      let upper = diagnostic_macro(upper_cell * 9u);
      let lower = diagnostic_macro(lower_cell * 9u);
      let du = upper.y - lower.y;
      let dv = upper.z + lower.z;
      symmetry_difference = kahan(symmetry_difference, du * du + dv * dv);
      symmetry_reference = kahan(symmetry_reference, 0.5 * (upper.y * upper.y + upper.z * upper.z + lower.y * lower.y + lower.z * lower.z));
    }
    y_offset += 1u;
  }

  var recirculation = -1.0;
  var saw_reverse = false;
  let centreline_y = u32(round(cylinder_center_y()));
  let rear_x = cylinder_rear_x();
  let rear_cell_x = u32(ceil(rear_x));
  if (rear_cell_x + 1u < width()) {
    var left_x = rear_cell_x;
    var left = diagnostic_macro((centreline_y * width() + left_x) * 9u).y;
    for (var right_x = rear_cell_x + 1u; right_x < width(); right_x += 1u) {
      let right = diagnostic_macro((centreline_y * width() + right_x) * 9u).y;
      saw_reverse = saw_reverse || left < 0.0;
      if (saw_reverse && left <= 0.0 && right >= 0.0) {
        let fraction = select(-left / (right - left), 0.0, left == right);
        recirculation = (f32(left_x) + fraction - rear_x) / cylinder_diameter();
        break;
      }
      left_x = right_x;
      left = right;
    }
  }

  let flux_scale = cylinder_diameter() / lattice_speed();
  diagnostic_output[0] = mass.x;
  diagnostic_output[1] = inlet_flux.x * flux_scale;
  diagnostic_output[2] = outlet_flux.x * flux_scale;
  diagnostic_output[3] = density_minimum;
  diagnostic_output[4] = density_maximum;
  diagnostic_output[5] = mass.x / f32(fluid_cells);
  diagnostic_output[6] = f32(non_finite);
  diagnostic_output[7] = f32(non_positive);
  diagnostic_output[8] = sqrt(reflection.x / f32(probe_count)) / lattice_speed();
  diagnostic_output[9] = select(sqrt(residual_difference.x / max(residual_reference.x, 1.175494351e-38)), 0.0, !has_advanced());
  diagnostic_output[10] = sqrt(symmetry_difference.x / max(symmetry_reference.x, 1.175494351e-38));
  diagnostic_output[11] = (diagnostic_force[0] / steps_since_sample()) / force_normalizer();
  diagnostic_output[12] = (diagnostic_force[1] / steps_since_sample()) / force_normalizer();
  diagnostic_output[13] = recirculation;
}
`;
