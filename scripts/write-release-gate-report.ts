import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { BUNDLED_TIER_EVIDENCE } from "../src/engine/quality-tiers.js";
import {
  createReleaseGateReport,
  parseGuidePerformanceMeasurement,
} from "../src/engine/release-gates.js";

const reportDirectory = resolve("release-evidence");
const measurementDirectory = resolve(
  process.env.CFD_GUIDE_PERFORMANCE_DIR ??
    resolve(reportDirectory, "guide-performance"),
);
const measurements = [];
for (const file of await measurementFiles(measurementDirectory)) {
  const input = JSON.parse(await readFile(file, "utf8"));
  measurements.push(parseGuidePerformanceMeasurement(input));
}

const report = createReleaseGateReport(BUNDLED_TIER_EVIDENCE, measurements);
await mkdir(reportDirectory, { recursive: true });
await writeFile(
  resolve(reportDirectory, "release-gate-report.json"),
  `${JSON.stringify(report, undefined, 2)}\n`,
  "utf8",
);

for (const tier of report.tiers) {
  process.stdout.write(
    `${tier.qualityTier} scientific validation: ${tier.validation.status.toUpperCase()}\n`,
  );
  for (const failure of tier.validation.failures) {
    process.stdout.write(`  - ${failure}\n`);
  }
  process.stdout.write(
    `${tier.qualityTier} default-guide performance: ${tier.performance.status.toUpperCase()}\n`,
  );
  for (const measurement of tier.performance.measurements) {
    const isGate = tier.performance.gateBrowsers.includes(measurement.browser);
    process.stdout.write(
      isGate
        ? `  - ${measurement.browser} gate: ${measurement.guideDurationSeconds.toFixed(2)}s / ${tier.performance.maximumGuideDurationSeconds}s\n`
        : `  - ${measurement.browser} matrix observation: ${measurement.guideDurationSeconds.toFixed(2)}s\n`,
    );
  }
  for (const failure of tier.performance.failures) {
    process.stdout.write(`  - ${failure}\n`);
  }
}
process.stdout.write(
  `Release gates: ${report.status.toUpperCase()} (report: release-evidence/release-gate-report.json)\n`,
);
if (report.status === "fail") process.exitCode = 1;

async function measurementFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return measurementFiles(path);
      return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
    }),
  );
  return files.flat().sort();
}
