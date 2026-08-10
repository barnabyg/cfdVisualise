import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  CPU_REFERENCE_BACKEND_IDENTITY,
  runCpuReferenceCase,
} from "../src/validation/cpu-reference-backend.js";
import {
  CPU_PRODUCTION_CANONICAL_VALIDATION_SUITE,
  CPU_PRODUCTION_VALIDATION_SUITE,
} from "../src/validation/cpu-production-reference.js";
import { DOMAIN_AND_BOUNDARY_VALIDATION_SUITE } from "../src/validation/domain-boundary-reference.js";
import { GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE } from "../src/validation/grid-convergence-reference.js";
import {
  parseValidationManifest,
  serializeValidationManifest,
} from "../src/validation/manifest-schema.js";
import { runValidation } from "../src/validation/run-validation.js";
import type {
  SolverBackend,
  ValidationManifest,
  ValidationSuite,
} from "../src/validation/types.js";

const components = {
  canonical: CPU_PRODUCTION_CANONICAL_VALIDATION_SUITE,
  grid: GRID_AND_PLACEMENT_CONVERGENCE_VALIDATION_SUITE,
  domain: DOMAIN_AND_BOUNDARY_VALIDATION_SUITE,
} as const;
type Component = keyof typeof components;
const requestedComponent = process.argv
  .find((argument) => argument.startsWith("--component="))
  ?.slice("--component=".length) as Component | undefined;
const requestedCases = process.argv
  .find((argument) => argument.startsWith("--cases="))
  ?.slice("--cases=".length)
  .split(",");
const runId =
  process.argv.find((argument) => argument.startsWith("--run-id="))?.slice("--run-id=".length) ??
  randomUUID();
const intermediateDirectory = resolve("test-results/cpu-production-evidence");

if (requestedComponent !== undefined) {
  const suite = components[requestedComponent];
  if (suite === undefined) throw new Error(`Unknown validation component ${requestedComponent}.`);
  await mkdir(intermediateDirectory, { recursive: true });
  const selectedSuite =
    requestedCases === undefined
      ? { ...suite, qualityTier: CPU_PRODUCTION_VALIDATION_SUITE.qualityTier }
      : {
          ...suite,
          qualityTier: CPU_PRODUCTION_VALIDATION_SUITE.qualityTier,
          cases: suite.cases.filter(({ id }) => requestedCases.includes(id)),
          reconciliations: [],
        };
  const manifest = await validate(selectedSuite);
  await writeFile(
    componentPath(requestedComponent),
    serializeValidationManifest(manifest),
    "utf8",
  );
  assertPassing(manifest, `${requestedComponent} CPU production evidence`);
  console.info(`Completed passing ${requestedComponent} CPU production evidence.`);
} else {
  await mkdir(intermediateDirectory, { recursive: true });
  await Promise.all(
    (Object.keys(components) as Component[]).map((component) => runComponent(component)),
  );
  const manifests = await Promise.all(
    (Object.keys(components) as Component[]).map(async (component) =>
      parseValidationManifest(
        JSON.parse(await readFile(componentPath(component), "utf8")) as unknown,
      ),
    ),
  );
  const manifest = mergeManifests(manifests);
  const output = resolve("src/engine/cpu-production-manifest.json");
  await writeFile(output, serializeValidationManifest(manifest), "utf8");
  assertPassing(manifest, "CPU production evidence");
  console.info(`Wrote passing CPU production evidence to ${output}.`);
}

async function validate(suite: ValidationSuite): Promise<ValidationManifest> {
  const backend: SolverBackend = {
    schemaVersion: "1",
    identity: CPU_REFERENCE_BACKEND_IDENTITY,
    async *runCase(definition) {
      console.info(`Validating ${definition.id} at Re=${definition.reynoldsNumber}...`);
      yield* runCpuReferenceCase(definition);
    },
  };
  const manifest = await runValidation(suite, backend);
  return manifest;
}

function assertPassing(manifest: ValidationManifest, label: string): void {
  if (manifest.status === "pass") return;
  const failures = [
    ...manifest.cases.flatMap((result) => result.failures),
    ...manifest.reconciliations.flatMap((result) => result.failures),
  ];
  throw new Error(`${label} failed after its failing manifest was written:\n${failures.join("\n")}`);
}

function runComponent(component: Component): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [
        resolve("node_modules/vite-node/vite-node.mjs"),
        resolve("scripts/generate-cpu-production-manifest.ts"),
        `--component=${component}`,
        `--run-id=${runId}`,
      ],
      { stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 || code === 1) resolvePromise();
      else reject(new Error(`${component} evidence process exited with code ${code}.`));
    });
  });
}

function mergeManifests(
  manifests: readonly ValidationManifest[],
): ValidationManifest {
  const cases = manifests.flatMap((manifest) => manifest.cases);
  const reconciliations = manifests.flatMap((manifest) => manifest.reconciliations);
  return parseValidationManifest({
    schemaVersion: "1",
    suite: {
      id: CPU_PRODUCTION_VALIDATION_SUITE.id,
      schemaVersion: "1",
      metricVersions: CPU_PRODUCTION_VALIDATION_SUITE.metricVersions,
      evidenceScope: CPU_PRODUCTION_VALIDATION_SUITE.evidenceScope,
      qualityTier: CPU_PRODUCTION_VALIDATION_SUITE.qualityTier,
    },
    backend: CPU_REFERENCE_BACKEND_IDENTITY,
    status: manifests.every(({ status }) => status === "pass") ? "pass" : "fail",
    cases,
    reconciliations,
  });
}

function componentPath(component: Component): string {
  return resolve(intermediateDirectory, `${component}-${runId}.json`);
}
