import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export default class GuidePerformanceReporter {
  async onTestEnd(_test, result) {
    const outputDirectory = process.env.CFD_GUIDE_PERFORMANCE_DIR;
    if (outputDirectory === undefined) return;
    for (const attachment of result.attachments) {
      if (attachment.name !== "guide-performance") continue;
      const body =
        attachment.body?.toString("utf8") ??
        (attachment.path === undefined
          ? undefined
          : await readFile(attachment.path, "utf8"));
      if (body === undefined) {
        throw new Error("Guide performance attachment has no body or path.");
      }
      const measurement = JSON.parse(body);
      const safeBrowser = String(measurement.browser).replaceAll(/[^a-z0-9-]/gi, "-");
      const safeBackend = String(measurement.backendId).replaceAll(/[^a-z0-9-]/gi, "-");
      const resolvedOutput = resolve(outputDirectory);
      await mkdir(resolvedOutput, { recursive: true });
      await writeFile(
        resolve(resolvedOutput, `${safeBackend}-${safeBrowser}.json`),
        `${JSON.stringify(measurement, undefined, 2)}\n`,
        "utf8",
      );
    }
  }
}
