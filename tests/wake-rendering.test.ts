import { describe, expect, it } from "vitest";

import {
  FIXED_NORMALISED_VORTICITY_LIMIT,
  RenderLoadPolicy,
  WakeRasterRenderer,
  normalisedVorticityColour,
} from "../src/engine/wake-renderer.js";

describe("wake rendering", () => {
  it("uses a fixed signed scale and degrades visuals before solver fidelity", () => {
    expect(normalisedVorticityColour(-FIXED_NORMALISED_VORTICITY_LIMIT)).toBe("#2b6cb0");
    expect(normalisedVorticityColour(0)).toBe("#171a1f");
    expect(normalisedVorticityColour(FIXED_NORMALISED_VORTICITY_LIMIT)).toBe("#dd6b20");

    const policy = new RenderLoadPolicy(18);
    expect(policy.degrade()).toEqual({
      cellsPerDiameter: 18,
      tracerDensity: 0.5,
      renderEveryNthAdvance: 1,
    });
    expect(policy.degrade()).toEqual({
      cellsPerDiameter: 18,
      tracerDensity: 0.5,
      renderEveryNthAdvance: 2,
    });
  });

  it("composes Worker frames with fading tracer tails, domain context, and stills", () => {
    const renderer = new WakeRasterRenderer(18);
    const field = {
      width: 32,
      height: 16,
      cylinderDiameter: 4,
      cylinderCenterX: 8,
      cylinderCenterY: 8,
      latticeSpeed: 0.08,
      solid: new Uint8Array(32 * 16),
      velocityX: new Float64Array(32 * 16).fill(0.08),
      velocityY: new Float64Array(32 * 16),
    };
    for (let index = 0; index < 3; index += 1) renderer.render(field, 0.25, true);
    const frame = renderer.render(field, 0.25, true);
    expect(frame).toMatchObject({ width: 32, height: 16 });
    expect(frame?.pixels).toHaveLength(32 * 16 * 4);
    expect(frame?.pixels.some((value) => value === 245)).toBe(true);
    const cylinderCentre = (8 * 32 + 8) * 4;
    expect(frame?.pixels[cylinderCentre]).toBeGreaterThan(220);
    expect(
      frame?.pixels.some((value) => value > 23 && value < 220),
    ).toBe(true);
    expect(renderer.captureStill(field, true)).toMatchObject({ type: "image/bmp" });
  });

  it("links neutral tracer cores to the local signed vorticity with a coloured halo", () => {
    const positiveField = rotatingField(1);
    const negativeField = rotatingField(-1);

    const positiveWithoutTracers = renderedFrame(positiveField, false);
    const positiveWithTracers = renderedFrame(positiveField, true);
    const negativeWithoutTracers = renderedFrame(negativeField, false);
    const negativeWithTracers = renderedFrame(negativeField, true);

    expect(hasSignedHalo(positiveWithoutTracers.pixels, positiveWithTracers.pixels, "positive")).toBe(true);
    expect(hasSignedHalo(negativeWithoutTracers.pixels, negativeWithTracers.pixels, "negative")).toBe(true);
    expect(hasNeutralCore(positiveWithoutTracers.pixels, positiveWithTracers.pixels)).toBe(true);

    const combined = renderedFrame(positiveField, false, "combined");
    const motionFocused = renderedFrame(positiveField, false, "motion");
    const sample = (8 * positiveField.width + 20) * 4;
    const neutral = [23, 26, 31] as const;
    expect(colourDistance(motionFocused.pixels, sample, neutral)).toBeLessThan(
      colourDistance(combined.pixels, sample, neutral),
    );
  });
});

type TestField = Parameters<WakeRasterRenderer["render"]>[0];
type TestFocus = "combined" | "motion" | "rotation";

function rotatingField(sign: 1 | -1): TestField {
  const width = 32;
  const height = 16;
  const velocityY = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      velocityY[y * width + x] = sign * x * 0.02;
    }
  }
  return {
    width,
    height,
    cylinderDiameter: 4,
    cylinderCenterX: 8,
    cylinderCenterY: 8,
    latticeSpeed: 0.08,
    solid: new Uint8Array(width * height),
    velocityX: new Float64Array(width * height).fill(0.08),
    velocityY,
  };
}

function renderedFrame(field: TestField, tracers: boolean, focus: TestFocus = "combined") {
  const renderer = new WakeRasterRenderer(18);
  let frame;
  for (let index = 0; index < 4; index += 1) {
    frame = renderer.render(field, 0.08, tracers, focus);
  }
  if (frame === undefined) throw new Error("Expected a rendered frame.");
  return frame;
}

function hasSignedHalo(
  base: Uint8ClampedArray,
  rendered: Uint8ClampedArray,
  sign: "positive" | "negative",
): boolean {
  for (let index = 0; index < rendered.length; index += 4) {
    const redChange = rendered[index]! - base[index]!;
    const blueChange = rendered[index + 2]! - base[index + 2]!;
    if (sign === "positive" && redChange > 20 && redChange > blueChange * 1.5) return true;
    if (sign === "negative" && blueChange > 20 && blueChange > redChange * 1.5) return true;
  }
  return false;
}

function hasNeutralCore(base: Uint8ClampedArray, pixels: Uint8ClampedArray): boolean {
  for (let index = 0; index < pixels.length; index += 4) {
    if (
      pixels[index]! > base[index]!
      && pixels[index]! >= 235
      && pixels[index + 1]! >= 235
      && pixels[index + 2]! >= 235
    ) {
      return true;
    }
  }
  return false;
}

function colourDistance(
  pixels: Uint8ClampedArray,
  offset: number,
  target: readonly [number, number, number],
): number {
  return Math.hypot(
    pixels[offset]! - target[0],
    pixels[offset + 1]! - target[1],
    pixels[offset + 2]! - target[2],
  );
}
