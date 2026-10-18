import test from "node:test";
import assert from "node:assert/strict";
import { evaluateReconciliation, type ReconciliationWorkflow } from "../src/reconciliationPolicy.js";
import type { Requirements } from "../src/types.js";

const requirements: Requirements = {
  name: "Order webhook",
  trigger: "webhook",
  action: "http_request",
  endpoint: "https://api.example.com/orders",
  method: "POST",
  approved: true,
  description: "",
};
const validWorkflow: ReconciliationWorkflow = {
  id: "wf-1",
  name: "Order webhook [architect:abc123]",
  nodes: [
    { name: "Incoming Webhook", type: "n8n-nodes-base.webhook", parameters: { httpMethod: "POST" } },
    { name: "Send to Approved API", type: "n8n-nodes-base.httpRequest", parameters: { url: "https://api.example.com/orders", method: "POST" } },
  ],
};

test("reconciliation refuses to infer success when no marker match exists", () => {
  assert.deepEqual(evaluateReconciliation([], requirements, requirements.endpoint), { ok: false, reason: "no_match" });
});

test("reconciliation refuses ambiguous duplicate marker matches", () => {
  assert.deepEqual(evaluateReconciliation([validWorkflow, { ...validWorkflow, id: "wf-2" }], requirements, requirements.endpoint), { ok: false, reason: "multiple_matches" });
});

test("reconciliation refuses invalid or missing stored requirements", () => {
  assert.deepEqual(evaluateReconciliation([validWorkflow], null, null), { ok: false, reason: "invalid_requirements" });
});

test("reconciliation refuses an unexpected endpoint", () => {
  const altered = { ...validWorkflow, nodes: [validWorkflow.nodes![0]!, { ...validWorkflow.nodes![1]!, parameters: { url: "https://attacker.example/collect", method: "POST" } }] };
  assert.deepEqual(evaluateReconciliation([altered], requirements, requirements.endpoint), { ok: false, reason: "workflow_mismatch" });
});

test("reconciliation refuses an unexpected HTTP method", () => {
  const altered = { ...validWorkflow, nodes: [validWorkflow.nodes![0]!, { ...validWorkflow.nodes![1]!, parameters: { url: requirements.endpoint, method: "DELETE" } }] };
  assert.deepEqual(evaluateReconciliation([altered], requirements, requirements.endpoint), { ok: false, reason: "workflow_mismatch" });
});

test("reconciliation refuses workflows missing the required node types", () => {
  const altered = { ...validWorkflow, nodes: [{ name: "HTTP", type: "n8n-nodes-base.httpRequest", parameters: { url: requirements.endpoint, method: "POST" } }] };
  assert.deepEqual(evaluateReconciliation([altered], requirements, requirements.endpoint), { ok: false, reason: "workflow_mismatch" });
});

test("reconciliation accepts one workflow matching approved node types, endpoint, and method", () => {
  assert.deepEqual(evaluateReconciliation([validWorkflow], requirements, requirements.endpoint), { ok: true });
});
