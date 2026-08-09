import { describe, expect, it } from "vitest";

import {
  D2Q9_OPEN_CYLINDER_CONTRACT,
  buildOpenCylinderGeometry,
  equilibriumPopulation,
  trtRelaxationRates,
} from "../src/validation/d2q9-open-cylinder-contract.js";
import { STEADY_RE20_VALIDATION_SUITE } from "../src/validation/index.js";

describe("backend-neutral D2Q9 TRT/BFL contract", () => {
  it("declares the accepted algebra and curved-wall lattice data", () => {
    expect(D2Q9_OPEN_CYLINDER_CONTRACT).toMatchObject({
      directions: [
        [0, 0],
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ],
      opposite: [0, 3, 4, 1, 2, 7, 8, 5, 6],
      weights: [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36],
      trtMagicParameter: 3 / 16,
      boundaryPrecedence: [
        "free-slip-lateral",
        "regularized-velocity-inlet",
        "fixed-density-nee-outlet",
      ],
    });
    expect(
      D2Q9_OPEN_CYLINDER_CONTRACT.weights.map((_, direction) =>
        equilibriumPopulation(direction, 1, 0, 0),
      ),
    ).toEqual(D2Q9_OPEN_CYLINDER_CONTRACT.weights);
    expect(trtRelaxationRates(20, 18, 0.08)).toEqual({
      omegaEven: 1 / (0.5 + 3 * ((0.08 * 18) / 20)),
      omegaOdd: 1 / (0.5 + (3 / 16) / (3 * ((0.08 * 18) / 20))),
    });

    const geometry = buildOpenCylinderGeometry(
      STEADY_RE20_VALIDATION_SUITE.cases[0]!,
    );
    expect(geometry.bounceLinks.length).toBeGreaterThan(0);
    expect(
      [...geometry.bounceLinks].every((link) => {
        const fraction = geometry.cutFraction[link];
        return fraction !== undefined && fraction > 0 && fraction <= 1;
      }),
    ).toBe(true);
  });
});
