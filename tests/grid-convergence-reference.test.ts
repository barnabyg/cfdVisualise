import { describe, expect, it } from "vitest";

import {
  GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE,
  parseValidationSuite,
  parseValidationManifest,
  runValidation,
  type SolverBackend,
} from "../src/validation/index.js";

describe("grid and cylinder-placement convergence catalogue", () => {
  it("declares candidate and finer-reference cohorts for steady and periodic wakes", () => {
    const suite = parseValidationSuite(
      GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE,
    );

    expect(suite).toMatchObject({
      schemaVersion: "1",
      id: "grid-and-placement-convergence-cpu-reference-v1",
    });

    const casesByCohort = new Map<
      string,
      (typeof suite.cases)[number][]
    >();
    for (const definition of suite.cases) {
      const cohort = definition.cohort ?? "unassigned";
      casesByCohort.set(cohort, [
        ...(casesByCohort.get(cohort) ?? []),
        definition,
      ]);
    }
    expect(
      casesByCohort
        .get("grid-steady-re020")
        ?.map(({ configuration }) => configuration.cylinder.cellsPerDiameter),
    ).toEqual([16, 18, 20]);
    expect(
      casesByCohort
        .get("grid-periodic-re100")
        ?.map(({ configuration }) => configuration.cylinder.cellsPerDiameter),
    ).toEqual([18, 19, 20]);
    expect(
      suite.cases
        .filter(({ reynoldsNumber }) => reynoldsNumber === 100)
        .every(
          ({ protocol }) =>
            protocol.warmUpFlowThroughTime === 80 &&
            protocol.sampleFlowThroughTime === 32 &&
            protocol.sampleInterval === 0.4,
        ),
    ).toBe(true);
    expect(
      casesByCohort
        .get("grid-steady-re020")
        ?.map(({ configuration }) => configuration.qualityTier),
    ).toEqual([
      "production-candidate-d16",
      "production-candidate-d18",
      "fine-reference-d20",
    ]);
    expect(
      casesByCohort
        .get("grid-periodic-re100")
        ?.map(({ configuration }) => configuration.qualityTier),
    ).toEqual([
      "production-candidate-d18",
      "production-candidate-d19",
      "fine-reference-d20",
    ]);

    for (const cohort of ["placement-steady-re020", "placement-periodic-re100"]) {
      expect(casesByCohort.get(cohort)?.map(({ configuration }) => configuration.cylinder)).toEqual([
        { cellsPerDiameter: 18, offsetX: 0.5, offsetY: 0 },
      ]);
    }

    expect(suite.reconciliations).toEqual([
      expect.objectContaining({
        id: "grid-steady-re020",
        kind: "grid",
        baselineCaseId: "grid-steady-re020-candidate-d16",
        comparisonCaseIds: [
          "grid-steady-re020-candidate-d18",
          "grid-steady-re020-reference-d20",
        ],
        maximumRelativeChange: {
          meanDragCoefficient: 0.01,
          recirculationLength: 0.02,
        },
        requireSameRegime: true,
      }),
      expect.objectContaining({
        id: "grid-periodic-re100",
        kind: "grid",
        baselineCaseId: "grid-periodic-re100-candidate-d18",
        comparisonCaseIds: [
          "grid-periodic-re100-candidate-d19",
          "grid-periodic-re100-reference-d20",
        ],
        maximumRelativeChange: {
          meanDragCoefficient: 0.01,
          strouhalNumber: 0.01,
        },
        requireSameRegime: true,
      }),
      expect.objectContaining({
        id: "placement-steady-re020",
        kind: "cylinder-placement",
        baselineCaseId: "grid-steady-re020-candidate-d18",
        comparisonCaseIds: ["placement-steady-re020-shifted-d18"],
        maximumRelativeChange: {
          meanDragCoefficient: 0.01,
          recirculationLength: 0.02,
        },
        requireSameRegime: true,
      }),
      expect.objectContaining({
        id: "placement-periodic-re100",
        kind: "cylinder-placement",
        baselineCaseId: "grid-periodic-re100-candidate-d18",
        comparisonCaseIds: ["placement-periodic-re100-shifted-d18"],
        maximumRelativeChange: {
          meanDragCoefficient: 0.01,
          strouhalNumber: 0.01,
        },
        requireSameRegime: true,
      }),
    ]);
  });

  it("identifies every passing resolution and placement candidate in manifest evidence", async () => {
    const manifest = await runValidation(
      GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE,
      convergedSyntheticBackend(),
    );

    expect(parseValidationManifest(manifest)).toEqual(manifest);
    expect(manifest.status).toBe("pass");
    expect(
      manifest.reconciliations.map(({ id, kind, comparisons }) => ({
        id,
        kind,
        passingCaseIds: comparisons
          .filter(({ status }) => status === "pass")
          .map(({ comparisonCaseId }) => comparisonCaseId),
      })),
    ).toEqual([
      {
        id: "grid-steady-re020",
        kind: "grid",
        passingCaseIds: [
          "grid-steady-re020-candidate-d18",
          "grid-steady-re020-reference-d20",
        ],
      },
      {
        id: "grid-periodic-re100",
        kind: "grid",
        passingCaseIds: [
          "grid-periodic-re100-candidate-d19",
          "grid-periodic-re100-reference-d20",
        ],
      },
      {
        id: "placement-steady-re020",
        kind: "cylinder-placement",
        passingCaseIds: ["placement-steady-re020-shifted-d18"],
      },
      {
        id: "placement-periodic-re100",
        kind: "cylinder-placement",
        passingCaseIds: ["placement-periodic-re100-shifted-d18"],
      },
    ]);
  });
});

function convergedSyntheticBackend(): SolverBackend {
  return {
    schemaVersion: "1",
    identity: {
      schemaVersion: "1",
      id: "cpu-reference",
      kind: "cpu-worker",
      solver: "Synthetic TRT/BFL convergence evidence",
      solverVersion: "1.0.0",
      buildId: "ticket-05-test",
    },
    async *runCase(definition) {
      const interval = definition.protocol.sampleInterval;
      const duration =
        definition.protocol.warmUpFlowThroughTime +
        definition.protocol.sampleFlowThroughTime;
      for (let index = 0; index <= Math.round(duration / interval); index += 1) {
        const flowThroughTime = index * interval;
        const periodic = definition.reynoldsNumber === 100;
        yield {
          step: index,
          flowThroughTime,
          domainMass: 100,
          inletFlux: 1,
          outletFlux: 1,
          density: { minimum: 0.99, maximum: 1.01, mean: 1 },
          upstreamReflection: 0,
          fieldResidual: periodic ? 0.01 : 0.0001,
          symmetryError: periodic ? 0.05 : 0.0001,
          dragCoefficient: periodic ? 1.35 : 2.1,
          liftCoefficient: periodic
            ? 0.3 * Math.sin(2 * Math.PI * 0.16 * flowThroughTime)
            : 0,
          ...(periodic ? {} : { recirculationLength: 0.95 }),
        };
      }
    },
  };
}
