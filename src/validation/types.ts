export const FLOW_REGIMES = [
  "developing",
  "adapting",
  "steady",
  "periodically-shedding",
  "numerically-unstable",
  "unclassified",
] as const;

export const VALIDATION_SCHEMA_VERSION = "1" as const;

export type FlowRegime = (typeof FLOW_REGIMES)[number];

export type ResultAvailability = "available" | "unavailable";

export type ContractSchemaVersion = typeof VALIDATION_SCHEMA_VERSION;

export interface InclusiveRange {
  readonly minimum: number;
  readonly maximum: number;
}

export interface PhysicalScenario {
  readonly flowSpeedMetersPerSecond: number;
  readonly cylinderDiameterMeters: number;
  readonly kinematicViscositySquareMetersPerSecond: number;
}

export interface ScientificSource {
  readonly id: string;
  readonly url: string;
  readonly convention: string;
}

export interface DomainConfiguration {
  readonly upstreamDiameters: number;
  readonly downstreamDiameters: number;
  readonly lateralDiameters: number;
}

export interface CylinderConfiguration {
  readonly cellsPerDiameter: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface BoundaryConfiguration {
  readonly inlet: "regularized-velocity" | "equilibrium-velocity";
  readonly lateral: "free-slip" | "periodic" | "no-slip";
  readonly outlet: "fixed-density-nee" | "convective" | "extrapolated";
  readonly cylinder: "linear-bfl";
}

export interface NumericalConfiguration {
  readonly backendId: string;
  readonly qualityTier: string;
  readonly precision: "float32" | "float64" | "mixed";
  readonly latticeSpeed?: number;
  readonly initialTransversePerturbation?: number;
  readonly upstreamReflectionMode?:
    | "velocity-vector-about-mean"
    | "streamwise-from-inlet";
  readonly collision: "D2Q9 TRT";
  readonly boundaries: BoundaryConfiguration;
  readonly domain: DomainConfiguration;
  readonly cylinder: CylinderConfiguration;
}

export interface SamplingProtocol {
  readonly warmUpFlowThroughTime: number;
  readonly sampleFlowThroughTime: number;
  readonly sampleInterval: number;
  readonly minimumStableCycles?: number;
}

export interface NumericalHealthThresholds {
  readonly targetDensity: number;
  readonly densityRange: InclusiveRange;
  readonly maximumMeanDensityDrift: number;
  readonly maximumFluxResidual: number;
  readonly maximumUpstreamReflection: number;
}

export interface ClassificationThresholds {
  readonly maximumSteadyFieldResidual: number;
  readonly maximumSteadySymmetryError: number;
  readonly maximumSteadyLiftRms: number;
  readonly maximumSteadyDragRelativeVariation: number;
  readonly minimumPeriodicCycles: number;
  readonly minimumPeriodicAmplitude?: number;
  readonly maximumPeriodicFrequencyVariation: number;
  readonly maximumPeriodicAmplitudeVariation: number;
}

export type ObservableMetric =
  | "densityMinimum"
  | "densityMaximum"
  | "meanDragCoefficient"
  | "dragRelativeVariation"
  | "liftRms"
  | "periodicCycleCount"
  | "dominantFrequency"
  | "frequencyVariation"
  | "amplitudeVariation"
  | "frequencyUncertainty"
  | "recirculationLength"
  | "strouhalNumber"
  | "meanDensity"
  | "meanDensityDrift"
  | "nonFiniteValueCount"
  | "nonPositiveDensityCount"
  | "fluxResidual"
  | "upstreamReflection"
  | "fieldResidual"
  | "symmetryError";

export interface MetricExpectation {
  readonly metric: ObservableMetric;
  readonly applicableRegimes?: readonly FlowRegime[];
  readonly range: InclusiveRange;
  readonly tolerance: number;
  readonly sources: readonly ScientificSource[];
}

export interface ValidationCaseDefinition {
  readonly schemaVersion: ContractSchemaVersion;
  readonly id: string;
  readonly reynoldsNumber: number;
  readonly physicalScenario: PhysicalScenario;
  readonly expectedRegimes: readonly FlowRegime[];
  readonly configuration: NumericalConfiguration;
  readonly protocol: SamplingProtocol;
  readonly health: NumericalHealthThresholds;
  readonly classification: ClassificationThresholds;
  readonly expectations: readonly MetricExpectation[];
  readonly cohort?: string;
}

export interface ReconciliationDefinition {
  readonly schemaVersion: ContractSchemaVersion;
  readonly id: string;
  readonly kind: "grid" | "domain" | "cylinder-placement" | "boundary" | "backend";
  readonly baselineCaseId: string;
  readonly comparisonCaseIds: readonly string[];
  readonly maximumRelativeChange: Partial<
    Readonly<Record<"meanDragCoefficient" | "recirculationLength" | "strouhalNumber", number>>
  >;
  readonly requireSameRegime: boolean;
}

export interface ValidationSuite {
  readonly schemaVersion: ContractSchemaVersion;
  readonly id: string;
  readonly metricVersions: Readonly<Record<string, string>>;
  readonly cases: readonly ValidationCaseDefinition[];
  readonly reconciliations: readonly ReconciliationDefinition[];
}

export interface BackendIdentity {
  readonly schemaVersion: ContractSchemaVersion;
  readonly id: string;
  readonly kind: "cpu-worker" | "webgpu";
  readonly solver: string;
  readonly solverVersion: string;
  readonly buildId: string;
}

export interface DensitySample {
  readonly minimum: number;
  readonly maximum: number;
  readonly mean: number;
  readonly nonFiniteValueCount?: number;
  readonly nonPositiveValueCount?: number;
}

export interface ValidationSample {
  readonly step: number;
  readonly flowThroughTime: number;
  readonly domainMass: number;
  readonly inletFlux: number;
  readonly outletFlux: number;
  readonly density: DensitySample;
  readonly upstreamReflection: number;
  readonly fieldResidual: number;
  readonly symmetryError: number;
  readonly dragCoefficient: number;
  readonly liftCoefficient: number;
  readonly recirculationLength?: number;
}

export interface SolverBackend {
  readonly schemaVersion: ContractSchemaVersion;
  readonly identity: BackendIdentity;
  runCase(caseDefinition: ValidationCaseDefinition): AsyncIterable<ValidationSample>;
}

export interface MetricEvidence {
  readonly schemaVersion: ContractSchemaVersion;
  readonly applicability: "applicable" | "inapplicable";
  readonly measured?: number;
  readonly expected?: InclusiveRange;
  readonly tolerance?: number;
  readonly sources?: readonly ScientificSource[];
  readonly status: "pass" | "fail" | "not-assessed";
  readonly message?: string;
}

export interface CaseManifest {
  readonly schemaVersion: ContractSchemaVersion;
  readonly caseId: string;
  readonly reynoldsNumber: number;
  readonly configuration: NumericalConfiguration;
  readonly definition: {
    readonly schemaVersion: ContractSchemaVersion;
    readonly physicalScenario: PhysicalScenario;
    readonly expectedRegimes: readonly FlowRegime[];
    readonly protocol: SamplingProtocol;
    readonly health: NumericalHealthThresholds;
    readonly classification: ClassificationThresholds;
  };
  readonly status: "pass" | "fail";
  readonly availability: ResultAvailability;
  readonly regime?: FlowRegime;
  readonly achieved: {
    readonly steps: number;
    readonly flowThroughTime: number;
    readonly warmUpFlowThroughTime: number;
    readonly sampleFlowThroughTime: number;
  };
  readonly metrics: Readonly<Record<string, MetricEvidence>>;
  readonly failures: readonly string[];
}

export interface ReconciliationManifest {
  readonly schemaVersion: ContractSchemaVersion;
  readonly id: string;
  readonly kind: ReconciliationDefinition["kind"];
  readonly baselineCaseId: string;
  readonly comparisons: readonly {
    readonly comparisonCaseId: string;
    readonly baselineBackendId?: string;
    readonly comparisonBackendId?: string;
    readonly baselineBackendKind?: BackendIdentity["kind"];
    readonly comparisonBackendKind?: BackendIdentity["kind"];
    readonly baselineRegime?: FlowRegime;
    readonly comparisonRegime?: FlowRegime;
    readonly metrics: Readonly<
      Record<
        string,
        {
          readonly baseline: number;
          readonly comparison: number;
          readonly relativeChange: number;
          readonly maximumRelativeChange: number;
          readonly status: "pass" | "fail";
        }
      >
    >;
    readonly status: "pass" | "fail";
  }[];
  readonly status: "pass" | "fail";
  readonly failures: readonly string[];
}

export interface ValidationManifest {
  readonly schemaVersion: ContractSchemaVersion;
  readonly suite: {
    readonly id: string;
    readonly schemaVersion: ContractSchemaVersion;
    readonly metricVersions: Readonly<Record<string, string>>;
  };
  readonly backend: BackendIdentity;
  readonly status: "pass" | "fail";
  readonly cases: readonly CaseManifest[];
  readonly reconciliations: readonly ReconciliationManifest[];
}
