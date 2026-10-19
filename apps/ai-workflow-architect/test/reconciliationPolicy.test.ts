import test from "node:test";
import assert from "node:assert/strict";
import { evaluateReconciliation, type ReconciliationWorkflow } from "../src/reconciliationPolicy.js";
import type { Requirements } from "../src/types.js";

const requirements: Requirements = {
  name: "Order webhook", trigger: "webhook", action: "http_request",
  endpoint: "https://api.example.com/orders", method: "POST", approved: true, description: "",
};
const validWorkflow: ReconciliationWorkflow = {
  id: "wf-1", name: "Order webhook [architect:abc123]", active: false,
  nodes: [
    { name: "Incoming Webhook", type: "n8n-nodes-base.webhook", parameters: { httpMethod: "POST", path: "architect/test" } },
    { name: "Send to Approved API", type: "n8n-nodes-base.httpRequest", parameters: {
      url: "https://api.example.com/orders", method: "POST",
      options: { redirect: { redirect: { followRedirects: false } } },
    } },
  ],
  connections: { "Incoming Webhook": { main: [[{ node: "Send to Approved API", type: "main", index: 0 }]] } },
};
const reject = (workflows: readonly ReconciliationWorkflow[], req: Requirements | null = requirements, endpoint: string | null = requirements.endpoint, name?: string) =>
  assert.deepEqual(evaluateReconciliation(workflows, req, endpoint, name), { ok: false, reason: workflows.length > 1 ? "multiple_matches" : workflows.length === 0 ? "no_match" : !req || !endpoint ? "invalid_requirements" : "workflow_mismatch" });

test("rejects no marker matches", () => reject([]));
test("rejects duplicate marker matches", () => reject([validWorkflow, { ...validWorkflow, id: "wf-2" }]));
test("rejects missing requirements", () => reject([validWorkflow], null, null));
test("rejects fetched name mismatch", () => reject([validWorkflow], requirements, requirements.endpoint, "Different name"));
test("rejects an unexpected endpoint", () => reject([{ ...validWorkflow, nodes: [validWorkflow.nodes![0]!, { ...validWorkflow.nodes![1]!, parameters: { ...validWorkflow.nodes![1]!.parameters, url: "https://attacker.example/collect" } }] }]));
test("rejects an unexpected HTTP method", () => reject([{ ...validWorkflow, nodes: [validWorkflow.nodes![0]!, { ...validWorkflow.nodes![1]!, parameters: { ...validWorkflow.nodes![1]!.parameters, method: "DELETE" } }] }]));
test("rejects missing required node types", () => reject([{ ...validWorkflow, nodes: [validWorkflow.nodes![1]!] }]));
test("rejects active workflows", () => reject([{ ...validWorkflow, active: true }]));
test("rejects unknown active state", () => { const { active: _active, ...rest } = validWorkflow; reject([rest]); });
test("rejects an incorrect webhook-to-action connection", () => reject([{ ...validWorkflow, connections: { "Incoming Webhook": { main: [[{ node: "Unexpected Node", type: "main", index: 0 }]] } } }]));
test("rejects workflows with extra nodes", () => reject([{ ...validWorkflow, nodes: [...validWorkflow.nodes!, { name: "Unexpected", type: "n8n-nodes-base.set", parameters: {} }] }]));
test("rejects redirect-following configurations", () => reject([{ ...validWorkflow, nodes: [validWorkflow.nodes![0]!, { ...validWorkflow.nodes![1]!, parameters: { ...validWorkflow.nodes![1]!.parameters, options: { redirect: { redirect: { followRedirects: true } } } } }] }]));
test("accepts only the expected inactive connected workflow", () => assert.deepEqual(evaluateReconciliation([validWorkflow], requirements, requirements.endpoint), { ok: true }));
