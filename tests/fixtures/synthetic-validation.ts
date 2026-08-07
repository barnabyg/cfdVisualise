import type {
  SolverBackend,
  ValidationSuite,
} from "../../src/validation/index.js";

export function syntheticValidationSuite(): ValidationSuite {
  return {
    schemaVersion: "1",
    id: "synthetic-suite",
    metricVersions: {
      densityHealth: "1",
      fluxBalance: "1",
    },
    cases: [
      {
        schemaVersion: "1",
        id: "re20-steady",
        reynoldsNumber: 20,
        physicalScenario: {
          flowSpeedMetersPerSecond: 0.002,
          cylinderDiameterMeters: 0.01,
          kinematicViscositySquareMetersPerSecond: 0.000001,
        },
        expectedRegimes: ["steady"],
        configuration: {
          backendId: "cpu-test",
          qualityTier: "reference",
          precision: "float64",
          collision: "D2Q9 TRT",
          boundaries: {
            inlet: "regularized-velocity",
            lateral: "free-slip",
            outlet: "fixed-density-nee",
            cylinder: "linear-bfl",
          },
          domain: {
            upstreamDiameters: 8,
            downstreamDiameters: 24,
            lateralDiameters: 8,
          },
          cylinder: {
            cellsPerDiameter: 32,
            offsetX: 0,
            offsetY: 0,
          },
        },
        protocol: {
          warmUpFlowThroughTime: 2,
          sampleFlowThroughTime: 2,
          sampleInterval: 1,
        },
        health: {
          targetDensity: 1,
          densityRange: { minimum: 0.9, maximum: 1.1 },
          maximumMeanDensityDrift: 0.01,
          maximumFluxResidual: 0.01,
          maximumUpstreamReflection: 0.01,
        },
        classification: {
          maximumSteadyFieldResidual: 0.001,
          maximumSteadySymmetryError: 0.001,
          maximumSteadyLiftRms: 0.001,
          maximumSteadyDragRelativeVariation: 0.01,
          minimumPeriodicCycles: 4,
          maximumPeriodicFrequencyVariation: 0.02,
          maximumPeriodicAmplitudeVariation: 0.05,
        },
        expectations: [
          {
            metric: "meanDragCoefficient",
            range: { minimum: 2, maximum: 2.2 },
            tolerance: 0,
            sources: [
              {
                id: "worked-reference",
                url: "https://example.test/reference",
                convention: "time mean after warm-up",
              },
            ],
          },
        ],
      },
    ],
    reconciliations: [],
  };
}

export function syntheticBackend(dragCoefficient = 2.1): SolverBackend {
  return {
    identity: {
      schemaVersion: "1",
      id: "cpu-test",
      kind: "cpu-worker",
      solver: "Synthetic TRT/BFL",
      solverVersion: "1.0.0",
      buildId: "build-1",
    },
    async *runCase() {
      yield sample(0, 0, 100, 1, 0, 0, dragCoefficient);
      yield sample(1, 1, 100, 1, 1, 1, dragCoefficient);
      yield sample(2, 2, 100, 1, 1, 1, dragCoefficient);
      yield sample(3, 3, 100, 1, 1, 1, dragCoefficient);
      yield sample(4, 4, 100, 1, 1, 1, dragCoefficient);
    },
  };
}

function sample(
  step: number,
  flowThroughTime: number,
  domainMass: number,
  meanDensity: number,
  inletFlux: number,
  outletFlux: number,
  dragCoefficient: number,
) {
  return {
    step,
    flowThroughTime,
    domainMass,
    inletFlux,
    outletFlux,
    density: { minimum: 0.99, maximum: 1.01, mean: meanDensity },
    upstreamReflection: 0,
    fieldResidual: 0.0001,
    symmetryError: 0.0001,
    dragCoefficient,
    liftCoefficient: 0,
  };
}
