import type { DeploymentStatus } from "./workflowRepository.js";

/** Keep client recovery guidance deterministic and independent of persistence. */
export function deploymentNextAction(status: DeploymentStatus): "workflow_created_inactive" | "reconcile_before_retry" {
  return status === "created_inactive" ? "workflow_created_inactive" : "reconcile_before_retry";
}
