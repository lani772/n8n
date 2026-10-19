import type { Requirements } from "./types.js";

export interface ReconciliationWorkflow {
  id: string;
  name: string;
  active?: boolean;
  nodes?: Array<{ name?: string; type?: string; parameters?: Record<string, unknown> }>;
  connections?: Record<string, { main?: Array<Array<{ node?: string; type?: string; index?: number }>> }>;
}
export type ReconciliationDecision =
  | { ok: true }
  | { ok: false; reason: "no_match" | "multiple_matches" | "invalid_requirements" | "workflow_mismatch" };

/** Fail closed: adopt only the exact, inactive two-node workflow emitted by this compiler. */
export function evaluateReconciliation(
  matches: readonly ReconciliationWorkflow[],
  requirements: Requirements | null,
  expectedEndpoint: string | null,
  expectedWorkflowName?: string,
): ReconciliationDecision {
  if (matches.length === 0) return { ok: false, reason: "no_match" };
  if (matches.length > 1) return { ok: false, reason: "multiple_matches" };
  if (!requirements || !expectedEndpoint) return { ok: false, reason: "invalid_requirements" };
  const workflow = matches[0]!;
  const nodes = workflow.nodes ?? [];
  const triggers = nodes.filter((node) => node.type === "n8n-nodes-base.webhook");
  const actions = nodes.filter((node) => node.type === "n8n-nodes-base.httpRequest");
  const trigger = triggers[0];
  const action = actions[0];
  const triggerName = trigger?.name;
  const actionName = action?.name;
  const triggerParameters = trigger?.parameters;
  const actionParameters = action?.parameters;
  const actionOptions = actionParameters?.options as { redirect?: { redirect?: { followRedirects?: unknown } } } | undefined;
  const outputs = triggerName ? workflow.connections?.[triggerName]?.main : undefined;
  const connected = outputs?.some((output) => output?.some((connection) =>
    connection.node === actionName && connection.type === "main" && connection.index === 0
  )) ?? false;
  if (
    (expectedWorkflowName !== undefined && workflow.name !== expectedWorkflowName) ||
    workflow.active !== false ||
    nodes.length !== 2 || triggers.length !== 1 || actions.length !== 1 ||
    !trigger || !action || !triggerName || !actionName ||
    triggerParameters?.httpMethod !== "POST" ||
    typeof triggerParameters.path !== "string" || triggerParameters.path.length === 0 ||
    !connected ||
    actionParameters?.url !== expectedEndpoint ||
    actionParameters?.method !== requirements.method ||
    actionOptions?.redirect?.redirect?.followRedirects !== false
  ) return { ok: false, reason: "workflow_mismatch" };
  return { ok: true };
}
