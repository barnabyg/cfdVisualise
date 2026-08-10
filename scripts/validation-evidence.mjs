import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("../", import.meta.url));

export const VALIDATION_EVIDENCE_LOCK_PATH = resolve(
  workspace,
  "validation-evidence-lock.json",
);

const manifests = Object.freeze({
  cpu: resolve(workspace, "src/engine/cpu-production-manifest.json"),
  webgpu: resolve(workspace, "src/validation/webgpu-backend-manifest.json"),
});

export async function currentValidationEvidenceState() {
  const inputs = await validationEvidenceInputFiles();
  return {
    schemaVersion: "1",
    inputs: {
      sha256: await fingerprintFiles(inputs),
    },
    manifests: {
      cpu: await manifestState(manifests.cpu),
      webgpu: await manifestState(manifests.webgpu),
    },
  };
}

export async function validationEvidenceSourceFingerprint() {
  return fingerprintFiles(await validationEvidenceInputFiles());
}

async function validationEvidenceInputFiles() {
  return [
    resolve(workspace, "package-lock.json"),
    resolve(workspace, "scripts/generate-cpu-production-manifest.ts"),
    resolve(workspace, "scripts/generate-webgpu-backend-manifest.mjs"),
    resolve(workspace, "scripts/validation-evidence.mjs"),
    resolve(workspace, "scripts/webgpu-chrome-profile.json"),
    ...(await typescriptFiles(resolve(workspace, "src/validation"))),
  ].sort();
}

async function manifestState(path) {
  return {
    path: relative(workspace, path).replaceAll("\\", "/"),
    sha256: await textFileHash(path),
  };
}

async function fingerprintFiles(files) {
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(relative(workspace, path).replaceAll("\\", "/"));
    hash.update("\0");
    const contents = await readFile(path, "utf8");
    hash.update(contents.replaceAll("\r\n", "\n"));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function textFileHash(path) {
  const contents = await readFile(path, "utf8");
  return createHash("sha256")
    .update(contents.replaceAll("\r\n", "\n"))
    .digest("hex");
}

async function typescriptFiles(directory) {
  const nonEvidenceModules = new Set([
    "index.ts",
    "manifest-consumers.ts",
    "method-and-validation-surface.ts",
  ]);
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await typescriptFiles(path));
    else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !nonEvidenceModules.has(entry.name)
    ) {
      files.push(path);
    }
  }
  return files;
}
