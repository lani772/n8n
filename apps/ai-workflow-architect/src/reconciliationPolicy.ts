import type { Requirements } from "./types.js";

export interface ReconciliationWorkflow {
  id: string;
  name: string;
  nodes?: Array<{
    name?: string;
    type?: string;
    parameters?: Record<string, unknown>;
  }>;
}

export type ReconciliationDecision =
  | { ok: true }
  | { ok: false; reason: "no_match" | "multiple_matches" | "invalid_requirements" | "workflow_mismatch" };

/** Fail closed: only one workflow with the expected trigger/action/endpoint can be adopted. */
export function evaluateReconciliation(
  matches: readonly ReconciliationWorkflow[],
  requirements: Requirements | null,
  expectedEndpoint: string | null,
): ReconciliationDecision {
  if (matches.length === 0) return { ok: false, reason: "no_match" };
  if (matches.length > 1) return { ok: false, reason: "multiple_matches" };
  if (!requirements || !expectedEndpoint) return { ok: false, reason: "invalid_requirements" };
  const workflow = matches[0]!;
  const trigger = workflow.nodes?.find((node) => node.type === "n8n-nodes-base.webhook");
  const action = workflow.nodes?.find((node) => node.type === "n8n-nodes-base.httpRequest");
  if (
    !trigger ||
    !action ||
    action.parameters?.url !== expectedEndpoint ||
    action.parameters?.method !== requirements.method
  ) {
    return { ok: false, reason: "workflow_mismatch" };
  }
  return { ok: true };
}
