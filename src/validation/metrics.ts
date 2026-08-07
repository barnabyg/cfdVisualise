export interface FluxSample {
  readonly flowThroughTime: number;
  readonly inletFlux: number;
  readonly outletFlux: number;
}

export interface DomainMassReconciliationInput {
  readonly initialMass: number;
  readonly finalMass: number;
  readonly samples: readonly FluxSample[];
}

export interface DomainMassReconciliation {
  readonly signedBalance: number;
  readonly normalizedResidual: number;
  readonly meanInletFlux: number;
  readonly meanOutletFlux: number;
  readonly sampleDuration: number;
}

export interface LiftSignalSample {
  readonly flowThroughTime: number;
  readonly liftCoefficient: number;
}

export interface LiftSignalThresholds {
  readonly minimumCycles: number;
  readonly maximumFrequencyVariation: number;
  readonly maximumAmplitudeVariation: number;
}

export interface LiftSignalAnalysis {
  readonly stable: boolean;
  readonly strouhalNumber: number;
  readonly cycles: number;
  readonly amplitude: number;
  readonly frequencyVariation: number;
  readonly amplitudeVariation: number;
}

export function measureCentrelineSymmetry(
  upperField: readonly number[],
  mirroredLowerField: readonly number[],
): number {
  requireSameNonEmptyLength(upperField, mirroredLowerField, "Mirrored fields");
  let squaredDifference = 0;
  let squaredReference = 0;
  for (let index = 0; index < upperField.length; index += 1) {
    const upper = finite(upperField[index], `Upper field value ${index}`);
    const lower = finite(mirroredLowerField[index], `Mirrored lower field value ${index}`);
    squaredDifference += (upper - lower) ** 2;
    squaredReference += (upper ** 2 + lower ** 2) / 2;
  }
  if (squaredReference === 0) {
    return squaredDifference === 0 ? 0 : Number.POSITIVE_INFINITY;
  }
  return Math.sqrt(squaredDifference / squaredReference);
}

export function measureRecirculationLength(
  centrelineX: readonly number[],
  streamwiseVelocity: readonly number[],
  cylinderRearX: number,
): number | undefined {
  requireSameNonEmptyLength(centrelineX, streamwiseVelocity, "Centreline samples");
  finite(cylinderRearX, "Cylinder rear position");
  let sawReverseFlow = false;
  for (let index = 0; index < centrelineX.length - 1; index += 1) {
    const leftX = finite(centrelineX[index], `Centreline x ${index}`);
    const rightX = finite(centrelineX[index + 1], `Centreline x ${index + 1}`);
    const leftVelocity = finite(streamwiseVelocity[index], `Streamwise velocity ${index}`);
    const rightVelocity = finite(
      streamwiseVelocity[index + 1],
      `Streamwise velocity ${index + 1}`,
    );
    if (rightX <= leftX) {
      throw new RangeError("Centreline positions must increase strictly.");
    }
    if (leftX < cylinderRearX) {
      continue;
    }
    sawReverseFlow ||= leftVelocity < 0;
    if (sawReverseFlow && leftVelocity <= 0 && rightVelocity >= 0) {
      const fraction = leftVelocity === rightVelocity ? 0 : -leftVelocity / (rightVelocity - leftVelocity);
      return leftX + fraction * (rightX - leftX) - cylinderRearX;
    }
  }
  return undefined;
}

export function reconcileDomainMass(
  input: DomainMassReconciliationInput,
): DomainMassReconciliation {
  finite(input.initialMass, "Initial domain mass");
  finite(input.finalMass, "Final domain mass");
  if (input.samples.length < 2) {
    throw new RangeError("Flux reconciliation requires at least two samples.");
  }
  let integratedInlet = 0;
  let integratedOutlet = 0;
  let previous = input.samples[0]!;
  validateFluxSample(previous, 0);
  for (let index = 1; index < input.samples.length; index += 1) {
    const current = input.samples[index]!;
    validateFluxSample(current, index);
    const duration = current.flowThroughTime - previous.flowThroughTime;
    if (duration <= 0) {
      throw new RangeError("Flux sample flow-through time must increase strictly.");
    }
    integratedInlet += (duration * (previous.inletFlux + current.inletFlux)) / 2;
    integratedOutlet += (duration * (previous.outletFlux + current.outletFlux)) / 2;
    previous = current;
  }
  const first = input.samples[0]!;
  const sampleDuration = previous.flowThroughTime - first.flowThroughTime;
  const meanInletFlux = integratedInlet / sampleDuration;
  const meanOutletFlux = integratedOutlet / sampleDuration;
  const signedBalance =
    input.finalMass - input.initialMass - (integratedInlet - integratedOutlet);
  const normalizer = Math.max(Math.abs(integratedInlet), Number.EPSILON);
  return {
    signedBalance,
    normalizedResidual: signedBalance / normalizer,
    meanInletFlux,
    meanOutletFlux,
    sampleDuration,
  };
}

export function analyseLiftSignal(
  samples: readonly LiftSignalSample[],
  thresholds: LiftSignalThresholds,
): LiftSignalAnalysis {
  if (samples.length < 8) {
    return emptyLiftAnalysis();
  }
  validateLiftSamples(samples);
  const middle = Math.floor(samples.length / 2);
  const first = samples.slice(0, middle + 1);
  const second = samples.slice(middle);
  const frequency = dominantFrequency(samples);
  const firstFrequency = dominantFrequency(first);
  const secondFrequency = dominantFrequency(second);
  const amplitude = signalAmplitude(samples);
  const firstAmplitude = signalAmplitude(first);
  const secondAmplitude = signalAmplitude(second);
  const frequencyVariation = relativeDifference(firstFrequency, secondFrequency);
  const amplitudeVariation = relativeDifference(firstAmplitude, secondAmplitude);
  const duration = samples.at(-1)!.flowThroughTime - samples[0]!.flowThroughTime;
  const cycles = frequency * duration;
  return {
    stable:
      frequency > 0 &&
      amplitude > Number.EPSILON &&
      cycles >= thresholds.minimumCycles - 1e-9 &&
      frequencyVariation <= thresholds.maximumFrequencyVariation &&
      amplitudeVariation <= thresholds.maximumAmplitudeVariation,
    strouhalNumber: frequency,
    cycles,
    amplitude,
    frequencyVariation,
    amplitudeVariation,
  };
}

function dominantFrequency(samples: readonly LiftSignalSample[]): number {
  const firstTime = samples[0]!.flowThroughTime;
  const duration = samples.at(-1)!.flowThroughTime - firstTime;
  if (duration <= 0) {
    return 0;
  }
  const values = samples.map((sample) => sample.liftCoefficient);
  const average = mean(values);
  let dominantFrequency = 0;
  let dominantPower = 0;
  const maximumBin = Math.floor((samples.length - 1) / 2);
  for (let bin = 1; bin <= maximumBin; bin += 1) {
    const frequency = bin / duration;
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index]!;
      const angle = 2 * Math.PI * frequency * (sample.flowThroughTime - firstTime);
      const value = sample.liftCoefficient - average;
      real += value * Math.cos(angle);
      imaginary -= value * Math.sin(angle);
    }
    const power = real ** 2 + imaginary ** 2;
    if (power > dominantPower) {
      dominantPower = power;
      dominantFrequency = frequency;
    }
  }
  return dominantPower <= Number.EPSILON ? 0 : dominantFrequency;
}

function signalAmplitude(samples: readonly LiftSignalSample[]): number {
  const values = samples.map((sample) => sample.liftCoefficient);
  const average = mean(values);
  return Math.SQRT2 * Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function validateLiftSamples(samples: readonly LiftSignalSample[]): void {
  let previousTime = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    finite(sample.flowThroughTime, `Lift sample ${index} flow-through time`);
    finite(sample.liftCoefficient, `Lift sample ${index} coefficient`);
    if (sample.flowThroughTime <= previousTime) {
      throw new RangeError("Lift sample flow-through time must increase strictly.");
    }
    previousTime = sample.flowThroughTime;
  }
}

function validateFluxSample(sample: FluxSample, index: number): void {
  finite(sample.flowThroughTime, `Flux sample ${index} flow-through time`);
  finite(sample.inletFlux, `Flux sample ${index} inlet flux`);
  finite(sample.outletFlux, `Flux sample ${index} outlet flux`);
}

function requireSameNonEmptyLength(
  left: readonly number[],
  right: readonly number[],
  label: string,
): void {
  if (left.length === 0 || left.length !== right.length) {
    throw new RangeError(`${label} must have the same non-zero length.`);
  }
}

function finite(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite.`);
  }
  return value;
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function relativeDifference(left: number, right: number): number {
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), Number.EPSILON);
}

function emptyLiftAnalysis(): LiftSignalAnalysis {
  return {
    stable: false,
    strouhalNumber: 0,
    cycles: 0,
    amplitude: 0,
    frequencyVariation: Number.POSITIVE_INFINITY,
    amplitudeVariation: Number.POSITIVE_INFINITY,
  };
}
