// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/preact";
import { h } from "preact";
import { afterEach, describe, expect, it } from "vitest";

import {
  MethodAndValidation,
  MethodAndValidationSurface,
  runValidation,
  type MethodAndValidationModel,
} from "../src/validation/index.js";
import {
  syntheticBackend,
  syntheticValidationSuite,
} from "./fixtures/synthetic-validation.js";

afterEach(cleanup);

describe("Method and validation surface", () => {
  it("renders a synthetic runner manifest as passing evidence", async () => {
    const manifest = await runValidation(syntheticValidationSuite(), syntheticBackend());

    render(
      h(MethodAndValidation, {
        manifest,
        active: {
          backendId: "cpu-test",
          qualityTier: "reference",
          buildId: "build-1",
        },
      }),
    );

    const surface = screen.getByRole("region", { name: "Method and validation" });
    expect(surface.getAttribute("data-evidence-state")).toBe("passing");
    expect(screen.getByText("Synthetic TRT/BFL 1.0.0")).toBeTruthy();
    expect(
      screen.getByText(
        "A qualitative two-dimensional open-flow model within the validated Reynolds-number envelope.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "regularized-velocity / free-slip / fixed-density-nee / linear-bfl",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Re=20 — steady")).toBeTruthy();
    expect(
      screen.getByText(
        "meanDragCoefficient: 2.1; expected [2, 2.2]; tolerance 0 — pass",
      ),
    ).toBeTruthy();
  });

  it("rejects hand-claimed passing evidence whose measurement misses its tolerance", async () => {
    const manifest = await runValidation(syntheticValidationSuite(), syntheticBackend());
    const caseResult = manifest.cases[0]!;
    const forgedManifest = {
      ...manifest,
      cases: [
        {
          ...caseResult,
          metrics: {
            ...caseResult.metrics,
            meanDragCoefficient: {
              ...caseResult.metrics.meanDragCoefficient!,
              measured: 9,
              status: "pass" as const,
            },
          },
        },
      ],
    };

    render(
      h(MethodAndValidation, {
        manifest: forgedManifest,
        active: {
          backendId: "cpu-test",
          qualityTier: "reference",
          buildId: "build-1",
        },
      }),
    );

    const surface = screen.getByRole("region", { name: "Method and validation" });
    expect(surface.getAttribute("data-evidence-state")).toBe("incompatible");
    expect(screen.getByRole("status").textContent).toBe("Validation evidence unavailable");
    expect(screen.queryByText("Validation evidence passed")).toBeNull();
  });

  it("derives missing evidence from the manifest boundary", () => {
    render(
      h(MethodAndValidation, {
        manifest: undefined,
        active: {
          backendId: "cpu-test",
          qualityTier: "reference",
          buildId: "build-1",
        },
      }),
    );

    const surface = screen.getByRole("region", { name: "Method and validation" });
    expect(surface.getAttribute("data-evidence-state")).toBe("missing");
    expect(screen.getByRole("status").textContent).toBe("Validation evidence unavailable");
  });

  it("renders exact passing evidence and scientific sources", () => {
    render(
      h(MethodAndValidationSurface, {
        model: {
          status: "validated",
          evidenceState: "passing",
          suiteId: "synthetic-v1",
          backendId: "cpu-test",
          qualityTier: "reference",
          solver: "Synthetic TRT/BFL",
          solverVersion: "1.0.0",
          buildId: "build-1",
          modelScope:
            "A qualitative two-dimensional open-flow model within the validated Reynolds-number envelope.",
          boundaries: {
            inlet: "regularized-velocity",
            lateral: "free-slip",
            outlet: "fixed-density-nee",
            cylinder: "linear-bfl",
          },
          referenceCases: [],
          sources: [
            {
              id: "worked-reference",
              url: "https://example.test/reference",
              convention: "time mean after warm-up",
            },
          ],
        },
      }),
    );

    const surface = screen.getByRole("region", { name: "Method and validation" });
    expect(surface.getAttribute("data-evidence-state")).toBe("passing");
    expect(screen.getByText("Synthetic TRT/BFL 1.0.0")).toBeTruthy();
    expect(screen.getByText("cpu-test / reference / build-1")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "worked-reference" }).getAttribute("href"),
    ).toBe("https://example.test/reference");
  });

  it.each(["failing", "missing", "mismatched", "incompatible"] as const)(
    "renders %s evidence as unavailable without validation claims",
    (evidenceState) => {
      const model: MethodAndValidationModel = {
        status: "unavailable",
        evidenceState,
        reason: `Evidence is ${evidenceState}.`,
      };

      render(h(MethodAndValidationSurface, { model }));

      const surface = screen.getByRole("region", { name: "Method and validation" });
      expect(surface.getAttribute("data-evidence-state")).toBe(evidenceState);
      expect(screen.getByRole("status").textContent).toBe("Validation evidence unavailable");
      expect(screen.getByText(`Evidence is ${evidenceState}.`)).toBeTruthy();
      expect(screen.queryByText(/validated/i)).toBeNull();
    },
  );
});
