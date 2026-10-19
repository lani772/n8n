import test from "node:test";
import assert from "node:assert/strict";
import { deploymentNextAction } from "../src/deploymentStatusPolicy.js";

test("created inactive deployments do not recommend reconciliation", () => {
  assert.equal(deploymentNextAction("created_inactive"), "workflow_created_inactive");
});

test("pending deployments recommend reconciliation before any retry", () => {
  assert.equal(deploymentNextAction("pending"), "reconcile_before_retry");
});

test("uncertain deployments recommend reconciliation before any retry", () => {
  assert.equal(deploymentNextAction("reconciliation_required"), "reconcile_before_retry");
});
