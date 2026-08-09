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
    expect(renderer.captureStill(field, true)).toMatchObject({ type: "image/bmp" });
  });
});
