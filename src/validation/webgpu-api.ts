export const WEBGPU_BUFFER_USAGE = Object.freeze({
  mapRead: 0x0001,
  copySrc: 0x0004,
  copyDst: 0x0008,
  uniform: 0x0040,
  storage: 0x0080,
});

export const WEBGPU_MAP_MODE_READ = 0x0001;

export interface WebGpuLimits {
  readonly maxBufferSize: number;
  readonly maxStorageBufferBindingSize: number;
}

export interface WebGpuBufferHandle {
  readonly size: number;
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

export interface WebGpuBindGroupLayoutHandle {}

export interface WebGpuComputePipelineHandle {
  getBindGroupLayout(index: number): WebGpuBindGroupLayoutHandle;
}

export interface WebGpuBindGroupHandle {}

export interface WebGpuShaderCompilationMessage {
  readonly message: string;
  readonly type: "error" | "warning" | "info";
  readonly lineNum: number;
  readonly linePos: number;
}

export interface WebGpuShaderModuleHandle {
  getCompilationInfo(): Promise<{
    readonly messages: readonly WebGpuShaderCompilationMessage[];
  }>;
}

export interface WebGpuComputePassHandle {
  setPipeline(pipeline: WebGpuComputePipelineHandle): void;
  setBindGroup(index: number, bindGroup: WebGpuBindGroupHandle): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

export interface WebGpuCommandBufferHandle {}

export interface WebGpuCommandEncoderHandle {
  beginComputePass(): WebGpuComputePassHandle;
  copyBufferToBuffer(
    source: WebGpuBufferHandle,
    sourceOffset: number,
    destination: WebGpuBufferHandle,
    destinationOffset: number,
    size: number,
  ): void;
  finish(): WebGpuCommandBufferHandle;
}

export interface WebGpuQueueHandle {
  writeBuffer(
    buffer: WebGpuBufferHandle,
    bufferOffset: number,
    data: ArrayBuffer | ArrayBufferView,
    dataOffset?: number,
    size?: number,
  ): void;
  submit(commandBuffers: readonly WebGpuCommandBufferHandle[]): void;
  onSubmittedWorkDone(): Promise<void>;
}

export interface WebGpuDeviceLostInfo {
  readonly reason?: string;
  readonly message?: string;
}

export interface WebGpuDeviceHandle {
  readonly queue: WebGpuQueueHandle;
  readonly lost: Promise<WebGpuDeviceLostInfo>;
  createBuffer(descriptor: {
    readonly label?: string;
    readonly size: number;
    readonly usage: number;
    readonly mappedAtCreation?: boolean;
  }): WebGpuBufferHandle;
  createShaderModule(descriptor: {
    readonly label?: string;
    readonly code: string;
  }): WebGpuShaderModuleHandle;
  createComputePipeline(descriptor: {
    readonly label?: string;
    readonly layout: "auto";
    readonly compute: {
      readonly module: WebGpuShaderModuleHandle;
      readonly entryPoint: string;
    };
  }): WebGpuComputePipelineHandle;
  createBindGroup(descriptor: {
    readonly label?: string;
    readonly layout: WebGpuBindGroupLayoutHandle;
    readonly entries: readonly {
      readonly binding: number;
      readonly resource: { readonly buffer: WebGpuBufferHandle };
    }[];
  }): WebGpuBindGroupHandle;
  createCommandEncoder(descriptor?: {
    readonly label?: string;
  }): WebGpuCommandEncoderHandle;
  pushErrorScope(filter: "validation" | "out-of-memory" | "internal"): void;
  popErrorScope(): Promise<{ readonly message: string } | null>;
  destroy(): void;
}

export interface WebGpuAdapterHandle {
  readonly limits: WebGpuLimits;
  requestDevice(descriptor?: {
    readonly label?: string;
    readonly requiredLimits?: Readonly<Record<string, number>>;
  }): Promise<WebGpuDeviceHandle>;
}

export interface WebGpuNavigatorHandle {
  requestAdapter(options?: {
    readonly powerPreference?: "low-power" | "high-performance";
  }): Promise<WebGpuAdapterHandle | null>;
}
