import { randomUUID } from "node:crypto";
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
  async deploy(input: unknown): Promise<{ id: string; name: string }> {
    const req: Requirements = RequirementsSchema.parse(input);
    if (!req.approved) throw new Error("Explicit approval is required before deployment");
    return this.request("workflows", { method: "POST", body: JSON.stringify(this.compile(req)) });
  }
}
