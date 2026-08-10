import { readFile, writeFile } from "node:fs/promises";

import {
  VALIDATION_EVIDENCE_LOCK_PATH,
  currentValidationEvidenceState,
} from "./validation-evidence.mjs";

const current = await currentValidationEvidenceState();
if (process.argv.includes("--update")) {
  await writeFile(
    VALIDATION_EVIDENCE_LOCK_PATH,
    `${JSON.stringify(current, undefined, 2)}\n`,
    "utf8",
  );
  console.log("Updated validation evidence input and manifest fingerprints.");
  process.exit(0);
}

let locked;
try {
  locked = JSON.parse(await readFile(VALIDATION_EVIDENCE_LOCK_PATH, "utf8"));
} catch (error) {
  throw new Error(
    `Validation evidence lock is missing or unreadable. Run npm run validate:quality-tiers. ${error instanceof Error ? error.message : String(error)}`,
  );
}

const differences = [];
if (locked.schemaVersion !== current.schemaVersion) differences.push("schema version");
if (locked.inputs?.sha256 !== current.inputs.sha256) differences.push("validation inputs");
for (const backend of ["cpu", "webgpu"]) {
  if (locked.manifests?.[backend]?.path !== current.manifests[backend].path) {
    differences.push(`${backend} manifest path`);
  }
  if (locked.manifests?.[backend]?.sha256 !== current.manifests[backend].sha256) {
    differences.push(`${backend} manifest content`);
  }
}
if (differences.length > 0) {
  throw new Error(
    `Bundled validation evidence is stale (${differences.join(", ")}). Run npm run validate:quality-tiers and commit the regenerated evidence.`,
  );
}
console.log("Bundled validation evidence matches its locked inputs and manifests.");
