import { describe, expect, it } from "vitest";

import {
  DOMAIN_AND_BOUNDARY_VALIDATION_SUITE,
  parseValidationManifest,
  parseValidationSuite,
  runValidation,
  type SolverBackend,
} from "../src/validation/index.js";

describe("domain and open-boundary validation catalogue", () => {
  it("varies each domain extent and open-boundary formulation across representative wakes", () => {
    const suite = parseValidationSuite(DOMAIN_AND_BOUNDARY_VALIDATION_SUITE);

    expect(suite).toMatchObject({
      schemaVersion: "1",
      id: "domain-and-open-boundary-cpu-reference-v1",
      evidenceScope: {
        selectedProductionDomain: {
          upstreamDiameters: 6,
          downstreamDiameters: 14,
          lateralDiameters: 8,
        },
        selectedProductionBoundaries: {
          inlet: "regularized-velocity",
          lateral: "free-slip",
          outlet: "fixed-density-nee",
          cylinder: "linear-bfl",
        },
        benchmarkRoles: [
          { id: "open-cylinder-wake", role: "product-validation" },
          { id: "confined-channel", role: "solver-regression" },
        ],
      },
    });
    expect(
      suite.cases.every(
        ({ configuration }) => configuration.cylinder.cellsPerDiameter === 18,
      ),
    ).toBe(true);

    for (const reynoldsNumber of [5, 45, 100]) {
      const cohort = `domain-re${String(reynoldsNumber).padStart(3, "0")}`;
      const cases = suite.cases.filter((definition) => definition.cohort === cohort);
      const baseline = cases.find(({ id }) => id.endsWith("-production"));

      expect(baseline?.configuration.domain).toEqual({
        upstreamDiameters: 6,
        downstreamDiameters: 14,
        lateralDiameters: 8,
      });
      expect(cases.map(({ configuration }) => configuration.domain)).toEqual([
        { upstreamDiameters: 6, downstreamDiameters: 14, lateralDiameters: 8 },
        { upstreamDiameters: 6.5, downstreamDiameters: 14, lateralDiameters: 8 },
        { upstreamDiameters: 6, downstreamDiameters: 16, lateralDiameters: 8 },
        { upstreamDiameters: 6, downstreamDiameters: 14, lateralDiameters: 9 },
      ]);
    }

    expect(
      suite.reconciliations
        .filter(({ kind }) => kind === "domain")
        .map(({ id, maximumRelativeChange }) => ({ id, maximumRelativeChange })),
    ).toEqual([
      {
        id: "domain-re005",
        maximumRelativeChange: { meanDragCoefficient: 0.01 },
      },
      {
        id: "domain-re045",
        maximumRelativeChange: {
          meanDragCoefficient: 0.01,
          recirculationLength: 0.02,
        },
      },
      {
        id: "domain-re100",
        maximumRelativeChange: {
          meanDragCoefficient: 0.01,
          strouhalNumber: 0.01,
        },
      },
    ]);

    expect(
      suite.reconciliations
        .filter(({ kind }) => kind === "boundary")
        .map(({ id, baselineCaseId, comparisonCaseIds }) => ({
          id,
          baselineCaseId,
          comparisonCaseIds,
        })),
    ).toEqual([
      {
        id: "boundary-inlet-re020",
        baselineCaseId: "boundary-re020-production",
        comparisonCaseIds: ["boundary-re020-equilibrium-inlet"],
      },
      {
        id: "boundary-lateral-re045",
        baselineCaseId: "domain-re045-production",
        comparisonCaseIds: ["boundary-re045-periodic-lateral"],
      },
      {
        id: "boundary-outlet-re100",
        baselineCaseId: "domain-re100-production",
        comparisonCaseIds: ["boundary-re100-convective-outlet"],
      },
    ]);
  });

  it("emits the selected open-flow scope in passing manifest evidence", async () => {
    const manifest = await runValidation(
      DOMAIN_AND_BOUNDARY_VALIDATION_SUITE,
      matchingSyntheticBackend(),
    );

    expect(parseValidationManifest(manifest)).toEqual(manifest);
    expect(manifest.status).toBe("pass");
    expect(manifest.suite.evidenceScope).toEqual(
      DOMAIN_AND_BOUNDARY_VALIDATION_SUITE.evidenceScope,
    );
    expect(
      manifest.reconciliations.map(({ id, kind, status }) => ({ id, kind, status })),
    ).toEqual([
      { id: "domain-re005", kind: "domain", status: "pass" },
      { id: "domain-re045", kind: "domain", status: "pass" },
      { id: "domain-re100", kind: "domain", status: "pass" },
      { id: "boundary-inlet-re020", kind: "boundary", status: "pass" },
      { id: "boundary-lateral-re045", kind: "boundary", status: "pass" },
      { id: "boundary-outlet-re100", kind: "boundary", status: "pass" },
    ]);
  });

  it("quantifies upstream reflection after startup and a declared Reynolds change", async () => {
    const probe = DOMAIN_AND_BOUNDARY_VALIDATION_SUITE.cases.find(
      ({ id }) => id === "disturbance-re100-from-re020",
    );

    expect(probe?.protocol.reynoldsChange).toEqual({
      initialReynoldsNumber: 20,
      atFlowThroughTime: 8,
      rampFlowThroughTime: 4,
      observationFlowThroughTime: 4,
    });
    expect(
      DOMAIN_AND_BOUNDARY_VALIDATION_SUITE.cases
        .filter(({ reynoldsNumber, id }) => reynoldsNumber === 100 && id !== probe?.id)
        .every(({ protocol }) => protocol.reynoldsChange === undefined),
    ).toBe(true);

    const manifest = await runValidation(
      DOMAIN_AND_BOUNDARY_VALIDATION_SUITE,
      matchingSyntheticBackend(),
    );
    const result = manifest.cases.find(({ caseId }) => caseId === probe?.id);
    expect(result?.metrics.startupUpstreamReflection).toMatchObject({
      measured: 0.004,
      status: "pass",
    });
    expect(result?.metrics.reynoldsChangeUpstreamReflection).toMatchObject({
      measured: 0.007,
      status: "pass",
    });
    expect(result?.metrics.startupMeanDensityDrift).toMatchObject({
      measured: 0,
      status: "pass",
    });
    expect(result?.metrics.startupFluxResidual).toMatchObject({
      measured: 0,
      status: "pass",
    });
    expect(result?.metrics.reynoldsChangeMeanDensityDrift).toMatchObject({
      measured: 0,
      status: "pass",
    });
    expect(result?.metrics.reynoldsChangeFluxResidual).toMatchObject({
      measured: 0,
      status: "pass",
    });
    expect(result?.metrics.fluxResidual).toMatchObject({ status: "pass" });
    expect(result?.metrics.meanDensityDrift).toMatchObject({ status: "pass" });
  });

  it("fails disturbance-window density and flux excursions that recover before sampling", async () => {
    const manifest = await runValidation(
      DOMAIN_AND_BOUNDARY_VALIDATION_SUITE,
      matchingSyntheticBackend(new Set(), true),
    );
    const result = manifest.cases.find(
      ({ caseId }) => caseId === "disturbance-re100-from-re020",
    );

    expect(result?.metrics.startupMeanDensityDrift).toMatchObject({ status: "fail" });
    expect(result?.metrics.reynoldsChangeFluxResidual).toMatchObject({ status: "fail" });
    expect(result?.status).toBe("fail");
  });

  it("makes changed extents and boundary formulations actionable in failures", async () => {
    const manifest = await runValidation(
      DOMAIN_AND_BOUNDARY_VALIDATION_SUITE,
      matchingSyntheticBackend(
        new Set([
          "domain-re005-upstream-plus0p5d",
          "boundary-re020-equilibrium-inlet",
        ]),
      ),
    );

    expect(manifest.status).toBe("fail");
    expect(
      manifest.reconciliations.find(({ id }) => id === "domain-re005")?.failures,
    ).toEqual([
      expect.stringMatching(
        /upstreamDiameters changed from 6 to 6\.5.*meanDragCoefficient changed by.*maximum 0\.01/,
      ),
    ]);
    expect(
      manifest.reconciliations.find(({ id }) => id === "boundary-inlet-re020")
        ?.failures,
    ).toEqual([
      expect.stringMatching(
        /inlet changed from regularized-velocity to equilibrium-velocity.*meanDragCoefficient changed by.*maximum 0\.01/,
      ),
    ]);
  });

  it("rejects production evidence that contradicts the accepted open-wake model", () => {
    const scope = DOMAIN_AND_BOUNDARY_VALIDATION_SUITE.evidenceScope!;

    expect(() =>
      parseValidationSuite({
        ...DOMAIN_AND_BOUNDARY_VALIDATION_SUITE,
        evidenceScope: {
          ...scope,
          selectedProductionBoundaries: {
            ...scope.selectedProductionBoundaries,
            lateral: "no-slip",
          },
        },
      }),
    ).toThrow("production lateral boundary");

    expect(() =>
      parseValidationSuite({
        ...DOMAIN_AND_BOUNDARY_VALIDATION_SUITE,
        evidenceScope: {
          ...scope,
          benchmarkRoles: [
            { id: "open-cylinder-wake", role: "product-validation" },
            { id: "confined-channel", role: "product-validation" },
          ],
        },
      }),
    ).toThrow("confined-channel benchmark must be solver-regression");

    const probe = DOMAIN_AND_BOUNDARY_VALIDATION_SUITE.cases.find(
      ({ id }) => id === "disturbance-re100-from-re020",
    )!;
    const { rampFlowThroughTime: _ramp, ...changeWithoutRamp } =
      probe.protocol.reynoldsChange!;
    expect(() =>
      parseValidationSuite({
        ...DOMAIN_AND_BOUNDARY_VALIDATION_SUITE,
        cases: DOMAIN_AND_BOUNDARY_VALIDATION_SUITE.cases.map((definition) =>
          definition.id === probe.id
            ? {
                ...definition,
                protocol: {
                  ...definition.protocol,
                  reynoldsChange: changeWithoutRamp,
                },
              }
            : definition,
        ),
      }),
    ).toThrow("Reynolds-change ramp window");
  });
});

function matchingSyntheticBackend(
  changedDragCases: ReadonlySet<string> = new Set(),
  injectDisturbanceHealthFailure = false,
): SolverBackend {
  return {
    schemaVersion: "1",
    identity: {
      schemaVersion: "1",
      id: "cpu-reference",
      kind: "cpu-worker",
      solver: "Synthetic TRT/BFL domain and boundary evidence",
      solverVersion: "1.0.0",
      buildId: "ticket-06-test",
    },
    async *runCase(definition) {
      const interval = definition.protocol.sampleInterval;
      const duration =
        definition.protocol.warmUpFlowThroughTime +
        definition.protocol.sampleFlowThroughTime;
      for (let index = 0; index <= Math.round(duration / interval); index += 1) {
        const flowThroughTime = index * interval;
        const periodic = definition.reynoldsNumber === 100;
        const onset = definition.reynoldsNumber === 45;
        yield {
          step: index,
          flowThroughTime,
          domainMass: 100,
          inletFlux: 1,
          outletFlux:
            injectDisturbanceHealthFailure &&
            definition.id === "disturbance-re100-from-re020" &&
            flowThroughTime > 12 &&
            flowThroughTime <= 16
              ? 0.95
              : 1,
          density: {
            minimum: 0.99,
            maximum: 1.01,
            mean:
              injectDisturbanceHealthFailure &&
              definition.id === "disturbance-re100-from-re020" &&
              flowThroughTime <= 8
                ? 1.02
                : 1,
          },
          upstreamReflection:
            definition.reynoldsNumber === 100
              ? flowThroughTime <= 8
                ? 0.004
                : flowThroughTime <= 16
                  ? 0.007
                  : 0.001
              : 0.001,
          fieldResidual: periodic ? 0.01 : 0.0001,
          symmetryError: periodic ? 0.05 : 0.0001,
          dragCoefficient:
            (periodic
              ? 1.35
              : onset
                ? 1.45
                : definition.reynoldsNumber === 5
                  ? 4.1
                  : 2.1) *
            (changedDragCases.has(definition.id) ? 1.02 : 1),
          liftCoefficient: periodic
            ? 0.3 * Math.sin(2 * Math.PI * 0.16 * flowThroughTime)
            : 0,
          ...(periodic ? {} : { recirculationLength: onset ? 2.6 : 0.95 }),
        };
      }
    },
  };
}
