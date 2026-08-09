import type { PhysicalScenario } from "../validation/types.js";

export const VALIDATED_REYNOLDS_INTERVAL = Object.freeze({ minimum: 5, maximum: 150 });
export const PHYSICAL_SCALE = Object.freeze({
  flowSpeedMetersPerSecond: Object.freeze({ minimum: 0.001, maximum: 2 }),
  cylinderDiameterMeters: Object.freeze({ minimum: 0.001, maximum: 0.5 }),
  kinematicViscositySquareMetersPerSecond: Object.freeze({
    minimum: 0.5e-6,
    maximum: 2e-3,
  }),
});

export const DEFAULT_PHYSICAL_SCENARIO = Object.freeze({
  flowSpeedMetersPerSecond: 0.002,
  cylinderDiameterMeters: 0.01,
  kinematicViscositySquareMetersPerSecond: 0.000001,
} satisfies PhysicalScenario);

export type PhysicalScenarioChange = {
  readonly kind: "adapt" | "restart";
  readonly scenario: PhysicalScenario;
  readonly reynoldsNumber: number;
};

export interface CoupledPhysicalIntervals {
  readonly speed: readonly [number, number];
  readonly diameter: readonly [number, number];
  readonly viscosity: readonly [number, number];
}

export function reynoldsNumber(scenario: PhysicalScenario): number {
  const value =
    (scenario.flowSpeedMetersPerSecond * scenario.cylinderDiameterMeters) /
    scenario.kinematicViscositySquareMetersPerSecond;
  return Number(value.toPrecision(12));
}

export function applyPhysicalScenarioChange(
  current: PhysicalScenario,
  requested: PhysicalScenario,
): PhysicalScenarioChange {
  validatePhysicalScenario(requested);
  return {
    kind:
      requested.cylinderDiameterMeters === current.cylinderDiameterMeters
        ? "adapt"
        : "restart",
    scenario: Object.freeze({ ...requested }),
    reynoldsNumber: reynoldsNumber(requested),
  };
}

export function coupledPhysicalIntervals(
  scenario: PhysicalScenario,
): CoupledPhysicalIntervals {
  return {
    speed: stableInterval([
      Math.max(
        PHYSICAL_SCALE.flowSpeedMetersPerSecond.minimum,
        (VALIDATED_REYNOLDS_INTERVAL.minimum *
          scenario.kinematicViscositySquareMetersPerSecond) /
          scenario.cylinderDiameterMeters,
      ),
      Math.min(
        PHYSICAL_SCALE.flowSpeedMetersPerSecond.maximum,
        (VALIDATED_REYNOLDS_INTERVAL.maximum *
          scenario.kinematicViscositySquareMetersPerSecond) /
          scenario.cylinderDiameterMeters,
      ),
    ]),
    diameter: stableInterval([
      Math.max(
        PHYSICAL_SCALE.cylinderDiameterMeters.minimum,
        (VALIDATED_REYNOLDS_INTERVAL.minimum *
          scenario.kinematicViscositySquareMetersPerSecond) /
          scenario.flowSpeedMetersPerSecond,
      ),
      Math.min(
        PHYSICAL_SCALE.cylinderDiameterMeters.maximum,
        (VALIDATED_REYNOLDS_INTERVAL.maximum *
          scenario.kinematicViscositySquareMetersPerSecond) /
          scenario.flowSpeedMetersPerSecond,
      ),
    ]),
    viscosity: stableInterval([
      Math.max(
        PHYSICAL_SCALE.kinematicViscositySquareMetersPerSecond.minimum,
        (scenario.flowSpeedMetersPerSecond * scenario.cylinderDiameterMeters) /
          VALIDATED_REYNOLDS_INTERVAL.maximum,
      ),
      Math.min(
        PHYSICAL_SCALE.kinematicViscositySquareMetersPerSecond.maximum,
        (scenario.flowSpeedMetersPerSecond * scenario.cylinderDiameterMeters) /
          VALIDATED_REYNOLDS_INTERVAL.minimum,
      ),
    ]),
  };
}

function stableInterval(
  interval: readonly [number, number],
): readonly [number, number] {
  return interval.map((value) => Number(value.toPrecision(12))) as [number, number];
}

export function validatePhysicalScenario(scenario: PhysicalScenario): void {
  const values = Object.values(scenario);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError("A physical scenario requires positive finite values.");
  }
  for (const field of Object.keys(PHYSICAL_SCALE) as (keyof PhysicalScenario)[]) {
    const interval = PHYSICAL_SCALE[field];
    if (scenario[field] < interval.minimum || scenario[field] > interval.maximum) {
      throw new RangeError(
        `${field} ${scenario[field]} is outside the supported physical scale ` +
          `${interval.minimum}-${interval.maximum}.`,
      );
    }
  }
  const reynolds = reynoldsNumber(scenario);
  if (
    reynolds < VALIDATED_REYNOLDS_INTERVAL.minimum ||
    reynolds > VALIDATED_REYNOLDS_INTERVAL.maximum
  ) {
    throw new RangeError(
      `Reynolds number ${reynolds} is outside the validated envelope ` +
        `${VALIDATED_REYNOLDS_INTERVAL.minimum}-${VALIDATED_REYNOLDS_INTERVAL.maximum}.`,
    );
  }
}

export type { PhysicalScenario };
