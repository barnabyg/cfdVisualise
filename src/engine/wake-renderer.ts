import type { CpuFlowFieldView } from "../validation/cpu-reference-backend.js";
import type { CanvasViewport } from "./protocol.js";

export const FIXED_NORMALISED_VORTICITY_LIMIT = 2;

const NEGATIVE = [43, 108, 176] as const;
const NEUTRAL = [23, 26, 31] as const;
const POSITIVE = [221, 107, 32] as const;
const CYLINDER = [232, 235, 238] as const;
const TRACER_TARGET_COUNT = 270;

export function normalisedVorticityColour(value: number): string {
  const [red, green, blue] = normalisedVorticityRgb(value);
  return `#${hex(red)}${hex(green)}${hex(blue)}`;
}

export interface RenderLoadState {
  readonly cellsPerDiameter: number;
  readonly tracerDensity: number;
  readonly renderEveryNthAdvance: number;
}

export class RenderLoadPolicy {
  private tracerDensity = 1;
  private renderEveryNthAdvance = 1;

  public constructor(private readonly cellsPerDiameter: number) {}

  public degrade(): RenderLoadState {
    if (this.tracerDensity > 0.5) {
      this.tracerDensity = 0.5;
    } else {
      this.renderEveryNthAdvance = Math.min(4, this.renderEveryNthAdvance * 2);
    }
    return this.state();
  }

  public state(): RenderLoadState {
    return {
      cellsPerDiameter: this.cellsPerDiameter,
      tracerDensity: this.tracerDensity,
      renderEveryNthAdvance: this.renderEveryNthAdvance,
    };
  }
}

export interface RasterWakeFrame {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
}

export class WakeRasterRenderer {
  private readonly loadPolicy: RenderLoadPolicy;
  private readonly tracers: Tracer[] = [];
  private advanceCount = 0;

  public constructor(cellsPerDiameter: number) {
    this.loadPolicy = new RenderLoadPolicy(cellsPerDiameter);
  }

  public render(
    field: CpuFlowFieldView,
    flowThroughIncrement: number,
    tracersEnabled: boolean,
  ): RasterWakeFrame | undefined {
    this.advanceCount += 1;
    this.advanceTracers(field, flowThroughIncrement, tracersEnabled);
    if (this.advanceCount % this.loadPolicy.state().renderEveryNthAdvance !== 0) {
      return undefined;
    }
    const started = performance.now();
    const frame = this.composeFrame(field, tracersEnabled);
    if (performance.now() - started > 24) this.loadPolicy.degrade();
    return frame;
  }

  public captureStill(field: CpuFlowFieldView, tracersEnabled: boolean): Blob {
    return encodeBitmap(this.composeFrame(field, tracersEnabled));
  }

  public clearTracers(): void {
    this.tracers.length = 0;
  }

  private advanceTracers(
    field: CpuFlowFieldView,
    flowThroughIncrement: number,
    enabled: boolean,
  ): void {
    if (!enabled) return;
    seedTracers(
      this.tracers,
      field,
      Math.round(TRACER_TARGET_COUNT * this.loadPolicy.state().tracerDensity),
    );
    advanceTracerPositions(this.tracers, field, flowThroughIncrement);
  }

  private composeFrame(field: CpuFlowFieldView, tracersEnabled: boolean): RasterWakeFrame {
    const frame = rasteriseWakeField(field);
    drawRasterCylinder(frame, field);
    if (tracersEnabled) drawRasterTracerTails(frame, this.tracers);
    drawRasterDomainContext(frame);
    return frame;
  }
}

interface Tracer {
  x: number;
  y: number;
  age: number;
  readonly tail: { x: number; y: number }[];
}

export class WakeRenderer {
  private readonly context: OffscreenCanvasRenderingContext2D;
  private readonly fieldCanvas: OffscreenCanvas;
  private readonly fieldContext: OffscreenCanvasRenderingContext2D;
  private readonly loadPolicy: RenderLoadPolicy;
  private readonly tracers: Tracer[] = [];
  private advanceCount = 0;
  private viewport: CanvasViewport;

  public constructor(
    private readonly canvas: OffscreenCanvas,
    viewport: CanvasViewport,
    cellsPerDiameter: number,
  ) {
    const context = canvas.getContext("2d", { alpha: false });
    if (context === null) throw new Error("The wake canvas could not create a 2D context.");
    this.context = context;
    this.fieldCanvas = new OffscreenCanvas(1, 1);
    const fieldContext = this.fieldCanvas.getContext("2d", { alpha: false });
    if (fieldContext === null) throw new Error("The wake field buffer could not be created.");
    this.fieldContext = fieldContext;
    this.loadPolicy = new RenderLoadPolicy(cellsPerDiameter);
    this.viewport = viewport;
    this.resize(viewport);
  }

  public resize(viewport: CanvasViewport): void {
    this.viewport = viewport;
    this.canvas.width = Math.max(1, Math.round(viewport.cssWidth * viewport.pixelRatio));
    this.canvas.height = Math.max(1, Math.round(viewport.cssHeight * viewport.pixelRatio));
  }

  public render(
    field: CpuFlowFieldView,
    flowThroughIncrement: number,
    tracersEnabled: boolean,
  ): void {
    this.advanceCount += 1;
    const load = this.loadPolicy.state();
    this.advanceTracers(field, flowThroughIncrement, load.tracerDensity, tracersEnabled);
    if (this.advanceCount % load.renderEveryNthAdvance !== 0) return;

    const started = performance.now();
    this.drawField(field);
    if (tracersEnabled) this.drawTracers(field);
    this.drawDomainContext(field);
    if (performance.now() - started > 24) this.loadPolicy.degrade();
  }

  public clearTracers(): void {
    this.tracers.length = 0;
  }

  public degrade(): RenderLoadState {
    return this.loadPolicy.degrade();
  }

  public captureStill(): Promise<Blob> {
    return this.canvas.convertToBlob({ type: "image/png" });
  }

  private drawField(field: CpuFlowFieldView): void {
    if (this.fieldCanvas.width !== field.width || this.fieldCanvas.height !== field.height) {
      this.fieldCanvas.width = field.width;
      this.fieldCanvas.height = field.height;
    }
    const frame = rasteriseWakeField(field);
    const image = this.fieldContext.createImageData(field.width, field.height);
    image.data.set(frame.pixels);
    this.fieldContext.putImageData(image, 0, 0);
    this.context.imageSmoothingEnabled = true;
    this.context.drawImage(this.fieldCanvas, 0, 0, this.canvas.width, this.canvas.height);
  }

  private advanceTracers(
    field: CpuFlowFieldView,
    flowThroughIncrement: number,
    density: number,
    enabled: boolean,
  ): void {
    if (!enabled) return;
    seedTracers(this.tracers, field, Math.round(TRACER_TARGET_COUNT * density));
    advanceTracerPositions(this.tracers, field, flowThroughIncrement);
  }

  private drawTracers(field: CpuFlowFieldView): void {
    const scaleX = this.canvas.width / field.width;
    const scaleY = this.canvas.height / field.height;
    this.context.lineWidth = Math.max(1, this.viewport.pixelRatio);
    for (const tracer of this.tracers) {
      for (let index = 1; index < tracer.tail.length; index += 1) {
        const previous = tracer.tail[index - 1]!;
        const current = tracer.tail[index]!;
        this.context.strokeStyle = `rgba(245, 247, 250, ${index / tracer.tail.length / 2})`;
        this.context.beginPath();
        this.context.moveTo(previous.x * scaleX, previous.y * scaleY);
        this.context.lineTo(current.x * scaleX, current.y * scaleY);
        this.context.stroke();
      }
    }
  }

  private drawDomainContext(field: CpuFlowFieldView): void {
    const scaleX = this.canvas.width / field.width;
    const scaleY = this.canvas.height / field.height;
    this.context.fillStyle = "#f7fafc";
    this.context.font = `${12 * this.viewport.pixelRatio}px system-ui`;
    this.context.fillText("x/D →", this.canvas.width - 52 * this.viewport.pixelRatio, this.canvas.height - 10 * this.viewport.pixelRatio);
    this.context.fillText("y/D", 10 * this.viewport.pixelRatio, 18 * this.viewport.pixelRatio);
    this.context.strokeStyle = "rgba(247, 250, 252, 0.65)";
    this.context.fillStyle = "rgb(232, 235, 238)";
    this.context.lineWidth = Math.max(1, this.viewport.pixelRatio);
    this.context.beginPath();
    this.context.arc(
      field.cylinderCenterX * scaleX,
      field.cylinderCenterY * scaleY,
      (field.cylinderDiameter / 2) * Math.min(scaleX, scaleY),
      0,
      2 * Math.PI,
    );
    this.context.fill();
    this.context.stroke();
  }
}

function seedTracers(tracers: Tracer[], field: CpuFlowFieldView, targetCount: number): void {
  const seedCount = Math.min(4, targetCount - tracers.length);
  for (let index = 0; index < seedCount; index += 1) {
    const ordinal = tracers.length + index;
    tracers.push({
      x: 1,
      y: 1 + ((ordinal * 37) % Math.max(1, field.height - 2)),
      age: 0,
      tail: [],
    });
  }
}

function advanceTracerPositions(
  tracers: Tracer[],
  field: CpuFlowFieldView,
  flowThroughIncrement: number,
): void {
    const latticeSteps =
      (flowThroughIncrement * field.cylinderDiameter) / field.latticeSpeed;
    for (const tracer of tracers) {
      tracer.tail.push({ x: tracer.x, y: tracer.y });
      if (tracer.tail.length > 8) tracer.tail.shift();
      const x = Math.max(0, Math.min(field.width - 1, Math.round(tracer.x)));
      const y = Math.max(0, Math.min(field.height - 1, Math.round(tracer.y)));
      const cell = y * field.width + x;
      tracer.x += field.velocityX[cell]! * latticeSteps;
      tracer.y += field.velocityY[cell]! * latticeSteps;
      tracer.age += flowThroughIncrement;
    }
    for (let index = tracers.length - 1; index >= 0; index -= 1) {
      const tracer = tracers[index]!;
      if (
        tracer.age > 8 ||
        tracer.x < 0 ||
        tracer.x >= field.width ||
        tracer.y < 0 ||
        tracer.y >= field.height
      ) {
        tracers.splice(index, 1);
      }
    }
}

export function rasteriseWakeField(field: CpuFlowFieldView): RasterWakeFrame {
  const pixels = new Uint8ClampedArray(field.width * field.height * 4);
  for (let y = 0; y < field.height; y += 1) {
    for (let x = 0; x < field.width; x += 1) {
      const cell = y * field.width + x;
      const pixel = cell * 4;
      const colour =
        field.solid[cell] === 1
          ? NEUTRAL
          : normalisedVorticityRgb(normalisedVorticity(field, x, y));
      pixels[pixel] = colour[0];
      pixels[pixel + 1] = colour[1];
      pixels[pixel + 2] = colour[2];
      pixels[pixel + 3] = 255;
    }
  }
  return { width: field.width, height: field.height, pixels };
}

function drawRasterCylinder(frame: RasterWakeFrame, field: CpuFlowFieldView): void {
  const radius = field.cylinderDiameter / 2;
  const minimumX = Math.max(0, Math.floor(field.cylinderCenterX - radius - 1));
  const maximumX = Math.min(frame.width - 1, Math.ceil(field.cylinderCenterX + radius + 1));
  const minimumY = Math.max(0, Math.floor(field.cylinderCenterY - radius - 1));
  const maximumY = Math.min(frame.height - 1, Math.ceil(field.cylinderCenterY + radius + 1));
  const samplesPerAxis = 4;
  const sampleCount = samplesPerAxis * samplesPerAxis;
  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      let covered = 0;
      for (let sampleY = 0; sampleY < samplesPerAxis; sampleY += 1) {
        for (let sampleX = 0; sampleX < samplesPerAxis; sampleX += 1) {
          const offsetX = x + (sampleX + 0.5) / samplesPerAxis - field.cylinderCenterX;
          const offsetY = y + (sampleY + 0.5) / samplesPerAxis - field.cylinderCenterY;
          if (offsetX * offsetX + offsetY * offsetY <= radius * radius) covered += 1;
        }
      }
      if (covered > 0) {
        blendPixel(
          frame.pixels,
          frame.width,
          frame.height,
          x,
          y,
          CYLINDER,
          covered / sampleCount,
        );
      }
    }
  }
}

function paintPixel(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  colour: readonly [number, number, number],
): void {
  const px = Math.max(0, Math.min(width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(height - 1, Math.round(y)));
  const offset = (py * width + px) * 4;
  pixels[offset] = colour[0];
  pixels[offset + 1] = colour[1];
  pixels[offset + 2] = colour[2];
  pixels[offset + 3] = 255;
}

function drawRasterTracerTails(frame: RasterWakeFrame, tracers: readonly Tracer[]): void {
  for (const tracer of tracers) {
    for (let index = 1; index < tracer.tail.length; index += 1) {
      paintLine(
        frame,
        tracer.tail[index - 1]!,
        tracer.tail[index]!,
        index / tracer.tail.length / 2,
      );
    }
  }
}

function paintLine(
  frame: RasterWakeFrame,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  opacity: number,
): void {
  const distance = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
  for (let step = 0; step <= distance; step += 1) {
    const amount = step / distance;
    blendPixel(
      frame.pixels,
      frame.width,
      frame.height,
      from.x + (to.x - from.x) * amount,
      from.y + (to.y - from.y) * amount,
      [245, 247, 250],
      opacity,
    );
  }
}

function blendPixel(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  colour: readonly [number, number, number],
  opacity: number,
): void {
  const px = Math.max(0, Math.min(width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(height - 1, Math.round(y)));
  const offset = (py * width + px) * 4;
  for (let channel = 0; channel < 3; channel += 1) {
    pixels[offset + channel] = Math.round(
      pixels[offset + channel]! * (1 - opacity) + colour[channel]! * opacity,
    );
  }
}

const RASTER_GLYPHS = Object.freeze({
  x: ["101", "101", "010", "101", "101"],
  y: ["101", "101", "011", "001", "110"],
  D: ["110", "101", "101", "101", "110"],
  "/": ["001", "001", "010", "100", "100"],
} as const);

function drawRasterDomainContext(frame: RasterWakeFrame): void {
  const colour = [247, 250, 252] as const;
  drawRasterText(frame, Math.max(2, frame.width - 17), frame.height - 8, "x/D", colour);
  drawRasterText(frame, 3, 3, "y/D", colour);
  paintLine(
    frame,
    { x: frame.width - 18, y: frame.height - 3 },
    { x: frame.width - 3, y: frame.height - 3 },
    0.8,
  );
  paintLine(
    frame,
    { x: frame.width - 3, y: frame.height - 3 },
    { x: frame.width - 6, y: frame.height - 5 },
    0.8,
  );
  paintLine(
    frame,
    { x: frame.width - 3, y: frame.height - 3 },
    { x: frame.width - 6, y: frame.height - 1 },
    0.8,
  );
}

function drawRasterText(
  frame: RasterWakeFrame,
  startX: number,
  startY: number,
  text: string,
  colour: readonly [number, number, number],
): void {
  let cursor = startX;
  for (const character of text) {
    const glyph = RASTER_GLYPHS[character as keyof typeof RASTER_GLYPHS];
    if (glyph === undefined) continue;
    for (let y = 0; y < glyph.length; y += 1) {
      for (let x = 0; x < glyph[y]!.length; x += 1) {
        if (glyph[y]![x] === "1") {
          paintPixel(frame.pixels, frame.width, frame.height, cursor + x, startY + y, colour);
        }
      }
    }
    cursor += 4;
  }
}

function encodeBitmap(frame: RasterWakeFrame): Blob {
  const headerSize = 54;
  const rowSize = frame.width * 4;
  const bytes = new Uint8Array(headerSize + rowSize * frame.height);
  const header = new DataView(bytes.buffer);
  header.setUint16(0, 0x4d42, true);
  header.setUint32(2, bytes.length, true);
  header.setUint32(10, headerSize, true);
  header.setUint32(14, 40, true);
  header.setInt32(18, frame.width, true);
  header.setInt32(22, frame.height, true);
  header.setUint16(26, 1, true);
  header.setUint16(28, 32, true);
  header.setUint32(34, rowSize * frame.height, true);
  for (let y = 0; y < frame.height; y += 1) {
    const sourceY = frame.height - 1 - y;
    for (let x = 0; x < frame.width; x += 1) {
      const source = (sourceY * frame.width + x) * 4;
      const target = headerSize + y * rowSize + x * 4;
      bytes[target] = frame.pixels[source + 2]!;
      bytes[target + 1] = frame.pixels[source + 1]!;
      bytes[target + 2] = frame.pixels[source]!;
      bytes[target + 3] = 255;
    }
  }
  return new Blob([bytes], { type: "image/bmp" });
}

function normalisedVorticity(field: CpuFlowFieldView, x: number, y: number): number {
  if (x === 0 || y === 0 || x === field.width - 1 || y === field.height - 1) return 0;
  const left = y * field.width + x - 1;
  const right = y * field.width + x + 1;
  const below = (y - 1) * field.width + x;
  const above = (y + 1) * field.width + x;
  const vorticity =
    0.5 *
    (field.velocityY[right]! -
      field.velocityY[left]! -
      field.velocityX[above]! +
      field.velocityX[below]!);
  return (vorticity * field.cylinderDiameter) / field.latticeSpeed;
}

function normalisedVorticityRgb(value: number): readonly [number, number, number] {
  if (value === 0) return NEUTRAL;
  const limited = Math.max(
    -FIXED_NORMALISED_VORTICITY_LIMIT,
    Math.min(FIXED_NORMALISED_VORTICITY_LIMIT, value),
  );
  const amount = Math.abs(limited) / FIXED_NORMALISED_VORTICITY_LIMIT;
  return interpolate(NEUTRAL, limited < 0 ? NEGATIVE : POSITIVE, amount);
}

function interpolate(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  amount: number,
): readonly [number, number, number] {
  return [
    Math.round(from[0] + (to[0] - from[0]) * amount),
    Math.round(from[1] + (to[1] - from[1]) * amount),
    Math.round(from[2] + (to[2] - from[2]) * amount),
  ];
}

function hex(value: number): string {
  return value.toString(16).padStart(2, "0");
}
