import { describe, expect, it } from "vitest";

import {
  runValidation,
  type MetricExpectation,
  type SolverBackend,
  type ValidationSuite,
} from "../src/validation/index.js";
import { syntheticValidationSuite } from "./fixtures/synthetic-validation.js";

describe("steady reference diagnostics", () => {
  it("reports density health, residual, and symmetry evidence in the manifest", async () => {
    const base = syntheticValidationSuite();
    const suite: ValidationSuite = {
      ...base,
      cases: [
        {
          ...base.cases[0]!,
          expectations: diagnosticsExpectations(),
        },
      ],
    };
    const backend: SolverBackend = {
      schemaVersion: "1",
      identity: {
        schemaVersion: "1",
        id: "cpu-test",
        kind: "cpu-worker",
        solver: "diagnostic fixture",
        solverVersion: "1.0.0",
        buildId: "diagnostic-test",
      },
      async *runCase() {
        for (let step = 0; step <= 4; step += 1) {
          yield {
            step,
            flowThroughTime: step,
            domainMass: 100,
            inletFlux: 1,
            outletFlux: 1,
            density: {
              minimum: step === 3 ? 0.98 : 0.99,
              maximum: step === 4 ? 1.02 : 1.01,
              mean: step === 3 ? 1.001 : step === 4 ? 1.002 : 1,
              nonFiniteValueCount: 0,
              nonPositiveValueCount: 0,
            },
            upstreamReflection: 0,
            fieldResidual: step === 3 ? 0.0002 : 0.0001,
            symmetryError: step === 4 ? 0.0003 : 0.0001,
            dragCoefficient: 2.1,
            liftCoefficient: 0,
          };
        }
      },
    };

    const manifest = await runValidation(suite, backend);

    expect(manifest.cases[0]).toMatchObject({
      status: "pass",
      metrics: {
        densityMinimum: { measured: 0.98, status: "pass" },
        densityMaximum: { measured: 1.02, status: "pass" },
        meanDensity: { measured: 1.0015, status: "pass" },
        meanDensityDrift: { measured: 0.0015, status: "pass" },
        nonFiniteValueCount: { measured: 0, status: "pass" },
        nonPositiveDensityCount: { measured: 0, status: "pass" },
        fieldResidual: { measured: 0.0002, status: "pass" },
        symmetryError: { measured: 0.0003, status: "pass" },
      },
    });
  });
});

function diagnosticsExpectations(): readonly MetricExpectation[] {
  const source = [
    {
      id: "diagnostic-test",
      url: "https://example.test/diagnostics",
      convention: "analytic test fixture",
    },
  ];
  return [
    expected("densityMinimum", 0.97, 1, source),
    expected("densityMaximum", 1, 1.03, source),
    expected("meanDensity", 1, 1.01, source),
    expected("meanDensityDrift", 0, 0.01, source),
    expected("nonFiniteValueCount", 0, 0, source),
    expected("nonPositiveDensityCount", 0, 0, source),
    expected("fieldResidual", 0, 0.001, source),
    expected("symmetryError", 0, 0.001, source),
  ];
}

function expected(
  metric: MetricExpectation["metric"],
  minimum: number,
  maximum: number,
  sources: MetricExpectation["sources"],
): MetricExpectation {
  return { metric, range: { minimum, maximum }, tolerance: 0, sources };
}
