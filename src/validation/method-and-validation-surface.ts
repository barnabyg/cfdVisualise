import { h } from "preact";

import {
  createMethodAndValidationModel,
  type ActiveValidationIdentity,
  type MethodAndValidationModel,
} from "./manifest-consumers.js";
import type { MetricEvidence } from "./types.js";

export interface MethodAndValidationProps {
  readonly manifest: unknown;
  readonly active: ActiveValidationIdentity;
}

export function MethodAndValidation({ manifest, active }: MethodAndValidationProps) {
  return h(MethodAndValidationSurface, {
    model: createMethodAndValidationModel(manifest, active),
  });
}

export interface MethodAndValidationSurfaceProps {
  readonly model: MethodAndValidationModel;
}

export function MethodAndValidationSurface({
  model,
}: MethodAndValidationSurfaceProps) {
  const headingId = "method-and-validation-heading";
  if (model.status === "unavailable") {
    return h(
      "section",
      {
        "aria-labelledby": headingId,
        "data-evidence-state": model.evidenceState,
      },
      h("h2", { id: headingId }, "Method and validation"),
      h("p", { role: "status" }, "Validation evidence unavailable"),
      h("p", null, model.reason),
    );
  }

  return h(
    "section",
    {
      "aria-labelledby": headingId,
      "data-evidence-state": model.evidenceState,
    },
    h("h2", { id: headingId }, "Method and validation"),
    h("p", { role: "status" }, "Validation evidence passed"),
    h(
      "dl",
      null,
      h("dt", null, "Model scope"),
      h("dd", null, model.modelScope),
      h("dt", null, "Boundary assumptions"),
      h(
        "dd",
        null,
        `${model.boundaries.inlet} / ${model.boundaries.lateral} / ${model.boundaries.outlet} / ${model.boundaries.cylinder}`,
      ),
      h("dt", null, "Method"),
      h("dd", null, `${model.solver} ${model.solverVersion}`),
      h("dt", null, "Active evidence"),
      h("dd", null, `${model.backendId} / ${model.qualityTier} / ${model.buildId}`),
      h("dt", null, "Validation suite"),
      h("dd", null, model.suiteId),
    ),
    h("h3", null, "Reference-case evidence"),
    h(
      "ul",
      { "aria-label": "Reference-case evidence" },
      ...model.referenceCases.map((referenceCase) =>
        h(
          "li",
          { key: referenceCase.caseId },
          h(
            "p",
            null,
            `Re=${referenceCase.reynoldsNumber} — ${referenceCase.regime ?? "unclassified"}`,
          ),
          h(
            "ul",
            null,
            ...Object.entries(referenceCase.metrics).map(([metric, evidence]) =>
              h("li", { key: metric }, metricSummary(metric, evidence)),
            ),
          ),
        ),
      ),
    ),
    h(
      "ul",
      { "aria-label": "Scientific sources" },
      ...model.sources.map((source) =>
        h(
          "li",
          { key: `${source.id}:${source.url}` },
          h(
            "a",
            { href: source.url, rel: "noreferrer" },
            source.id,
          ),
          ` — ${source.convention}`,
        ),
      ),
    ),
  );
}

function metricSummary(
  metric: string,
  evidence: MetricEvidence,
): string {
  const measured = evidence.measured === undefined ? "unavailable" : String(evidence.measured);
  const expectation =
    evidence.expected === undefined
      ? ""
      : `; expected [${evidence.expected.minimum}, ${evidence.expected.maximum}]; tolerance ${evidence.tolerance ?? "undeclared"}`;
  return `${metric}: ${measured}${expectation} — ${evidence.status}`;
}
