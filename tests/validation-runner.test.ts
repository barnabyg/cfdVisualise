import { describe, expect, it } from "vitest";

import {
  parseValidationManifest,
  runValidation,
  type SolverBackend,
  type ValidationSuite,
} from "../src/validation/index.js";
import {
  syntheticBackend,
  syntheticValidationSuite,
} from "./fixtures/synthetic-validation.js";

describe("validation runner", () => {
  it("emits deterministic passing evidence for a declared steady case", async () => {
    const suite = syntheticValidationSuite();
    const backend = syntheticBackend();

    const first = await runValidation(suite, backend);
    const second = await runValidation(suite, backend);

    expect(first).toEqual(second);
    expect(parseValidationManifest(first)).toEqual(first);
    expect(first.status).toBe("pass");
    expect(first.cases[0]).toMatchObject({
      caseId: "re20-steady",
      status: "pass",
      regime: "steady",
      achieved: { steps: 4, flowThroughTime: 4 },
    });
    expect(first.cases[0]?.metrics.meanDragCoefficient).toMatchObject({
      applicability: "applicable",
      measured: 2.1,
      status: "pass",
    });
    expect(first.cases[0]?.metrics.strouhalNumber).toEqual({
      schemaVersion: "1",
      applicability: "inapplicable",
      status: "not-assessed",
      message: "Strouhal number is inapplicable without a stable periodic lift signal.",
    });
  });

  it("rejects incompatible or non-finite contracts before executing a backend", async () => {
    const suite = syntheticValidationSuite();
    const backend = syntheticBackend();
    let executions = 0;
    const guardedBackend: SolverBackend = {
      ...backend,
      async *runCase(definition) {
        executions += 1;
        yield* backend.runCase(definition);
      },
    };

    await expect(
      runValidation(
        {
          ...suite,
          cases: [{ ...suite.cases[0]!, schemaVersion: "2" }],
        } as unknown as ValidationSuite,
        guardedBackend,
      ),
    ).rejects.toThrow("case schema version");
    await expect(
      runValidation(
        {
          ...suite,
          cases: [{ ...suite.cases[0]!, reynoldsNumber: Number.NaN }],
        },
        guardedBackend,
      ),
    ).rejects.toThrow("finite number");
    const validCase = suite.cases[0]!;
    const incompatibleCases = [
      { ...validCase, reynoldsNumber: "twenty" },
      { ...validCase, expectedRegimes: ["mystery-flow"] },
      {
        ...validCase,
        protocol: { ...validCase.protocol, sampleInterval: "often" },
      },
      {
        ...validCase,
        configuration: { ...validCase.configuration, precision: "float16" },
      },
      { ...validCase, expectations: "none" },
    ];
    for (const incompatibleCase of incompatibleCases) {
      await expect(
        runValidation(
          { ...suite, cases: [incompatibleCase] } as unknown as ValidationSuite,
          guardedBackend,
        ),
      ).rejects.toThrow();
    }
    await expect(
      runValidation(
        suite,
        { ...guardedBackend, schemaVersion: "2" } as unknown as SolverBackend,
      ),
    ).rejects.toThrow("backend schema version");
    expect(executions).toBe(0);
  });

  it("emits actionable evidence for a synthetic scientific failure", async () => {
    const manifest = await runValidation(syntheticValidationSuite(), syntheticBackend(2.5));

    expect(manifest.cases[0]).toMatchObject({
      status: "fail",
      availability: "available",
      regime: "steady",
      metrics: {
        meanDragCoefficient: {
          schemaVersion: "1",
          measured: 2.5,
          expected: { minimum: 2, maximum: 2.2 },
          tolerance: 0,
          status: "fail",
          message: expect.stringContaining("Case re20-steady"),
        },
      },
      failures: [
        "Case re20-steady: meanDragCoefficient measured 2.5; expected [2, 2.2] with tolerance 0.",
      ],
    });
  });
});
