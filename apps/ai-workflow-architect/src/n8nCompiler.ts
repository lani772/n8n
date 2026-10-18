import { createHash, randomUUID } from "node:crypto";
import { config } from "./config.js";
import { validateEndpoint } from "./endpointPolicy.js";
import { RequirementsSchema, type N8nWorkflowPayload, type Requirements } from "./types.js";
export interface CredentialMapping { id: string; name: string; type: "httpHeaderAuth"; }
export class N8nCompiler {
  constructor(private readonly credentials: ReadonlyMap<string, CredentialMapping> = new Map()) {}
  validateEndpoint(raw: string): URL { return validateEndpoint(raw, config.customApiAllowedHosts); }
  compile(input: unknown): N8nWorkflowPayload {
    const req = RequirementsSchema.parse(input);
    const endpoint = this.validateEndpoint(req.endpoint);
    const credential = req.credentialKey ? this.credentials.get(req.credentialKey) : undefined;
    if (req.credentialKey && !credential) throw new Error(`Credential mapping '${req.credentialKey}' is not approved`);
    const triggerName = "Incoming Webhook", actionName = "Send to Approved API";
    const triggerId = randomUUID(), actionId = randomUUID();
    const action: N8nWorkflowPayload["nodes"][number] = {
      id: actionId, name: actionName, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [520, 300],
      parameters: { method: req.method, url: endpoint.toString(), sendBody: ["POST", "PUT", "PATCH"].includes(req.method), specifyBody: "json", jsonBody: "={{ $json }}", options: { timeout: 15000, redirect: { redirect: { followRedirects: false } } } },
    };
    if (credential) action.credentials = { httpHeaderAuth: { id: credential.id, name: credential.name } };
    return {
      name: req.name,
      nodes: [
        { id: triggerId, name: triggerName, type: "n8n-nodes-base.webhook", typeVersion: 2, position: [240, 300], webhookId: randomUUID(), parameters: { httpMethod: "POST", path: `architect/${randomUUID()}`, responseMode: "onReceived", options: {} } },
        action,
      ],
      connections: { [triggerName]: { main: [[{ node: actionName, type: "main", index: 0 }]] } },
      settings: { executionOrder: "v1", saveManualExecutions: true },
    };
  }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const base = new URL(config.N8N_BASE_URL.endsWith("/") ? config.N8N_BASE_URL : `${config.N8N_BASE_URL}/`);
    const url = new URL(path.replace(/^\//, ""), base);
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000), headers: { "X-N8N-API-KEY": config.N8N_API_KEY, "Content-Type": "application/json", ...init.headers } });
    if (!response.ok) throw new Error(`n8n API returned HTTP ${response.status}`);
    return await response.json() as T;
  }
  deploymentMarker(userId: string, sessionId: string): string {
    return createHash("sha256").update(`${userId}:${sessionId}`).digest("hex").slice(0, 20);
  }

  async deploy(input: unknown, marker?: string): Promise<{ id: string; name: string }> {
    const req: Requirements = RequirementsSchema.parse(input);
    if (!req.approved) throw new Error("Explicit approval is required before deployment");
    const workflow = this.compile(req);
    if (marker) workflow.name = `${req.name} [architect:${marker}]`;
    return this.request("workflows", { method: "POST", body: JSON.stringify(workflow) });
  }

  async getWorkflowDetails(workflowId: string): Promise<{
    id: string;
    name: string;
    nodes?: Array<{ name?: string; type?: string; parameters?: Record<string, unknown> }>;
  }> {
    return this.request(`workflows/${encodeURIComponent(workflowId)}`, { method: "GET" });
  }

  async findByDeploymentMarker(marker: string): Promise<Array<{ id: string; name: string }>> {
    const suffix = `[architect:${marker}]`;
    const matches: Array<{ id: string; name: string }> = [];
    let cursor: string | undefined;
    // Bound the scan so a large n8n instance cannot cause an unbounded API request.
    for (let page = 0; page < 20; page += 1) {
      const query = new URLSearchParams({ limit: "250" });
      if (cursor) query.set("cursor", cursor);
      const result = await this.request<{ data?: Array<{ id: string; name: string }>; nextCursor?: string }>(
        `workflows?${query.toString()}`,
        { method: "GET" },
      );
      matches.push(...(result.data ?? []).filter((workflow) => workflow.name.endsWith(suffix)));
      if (matches.length > 1 || !result.nextCursor) return matches;
      cursor = result.nextCursor;
    }
    throw new Error("Reconciliation scan reached its 5,000-workflow safety limit");
  }
}
