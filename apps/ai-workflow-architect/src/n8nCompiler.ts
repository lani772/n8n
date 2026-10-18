import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { RequirementsSchema, type N8nWorkflowPayload, type Requirements } from "./types.js";

export interface CredentialMapping { id: string; name: string; type: "httpHeaderAuth"; }
export class N8nCompiler {
  constructor(private readonly credentials: ReadonlyMap<string, CredentialMapping> = new Map()) {}

  validateEndpoint(raw: string): URL {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("Endpoint must be HTTPS and contain no embedded credentials");
    const host = url.hostname.toLowerCase();
    if (!config.customApiAllowedHosts.includes(host)) throw new Error("Endpoint hostname is not allowlisted");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || this.isPrivateIp(host)) throw new Error("Private or local endpoint is not permitted");
    return url;
  }

  private isPrivateIp(host: string): boolean {
    // Reject IPv4 literals in non-public ranges. Network egress controls are still required.
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]), d = Number(m[4]);
    if ([a,b,c,d].some((n) => n > 255)) return true;
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }

  compile(input: unknown): N8nWorkflowPayload {
    const req = RequirementsSchema.parse(input);
    const endpoint = this.validateEndpoint(req.endpoint);
    const credential = req.credentialKey ? this.credentials.get(req.credentialKey) : undefined;
    if (req.credentialKey && !credential) throw new Error(`Credential mapping '${req.credentialKey}' is not approved`);
    const triggerName = "Incoming Webhook";
    const actionName = "Send to Approved API";
    const triggerId = randomUUID(), actionId = randomUUID();
    const action: N8nWorkflowPayload["nodes"][number] = {
      id: actionId, name: actionName, type: "n8n-nodes-base.httpRequest", typeVersion: 4.2,
      position: [520, 300],
      parameters: {
        method: req.method, url: endpoint.toString(),
        sendBody: ["POST", "PUT", "PATCH"].includes(req.method),
        specifyBody: "json", jsonBody: "={{ $json }}",
        options: { timeout: 15000, redirect: { redirect: { followRedirects: false } } },
      },
    };
    if (credential) action.credentials = { httpHeaderAuth: { id: credential.id, name: credential.name } };
    return {
      name: req.name,
      nodes: [
        { id: triggerId, name: triggerName, type: "n8n-nodes-base.webhook", typeVersion: 2,
          position: [240, 300], webhookId: randomUUID(),
          parameters: { httpMethod: "POST", path: `architect/${randomUUID()}`, responseMode: "onReceived", options: {} } },
        action,
      ],
      connections: { [triggerName]: { main: [[{ node: actionName, type: "main", index: 0 }]] } },
      settings: { executionOrder: "v1", saveManualExecutions: true },
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const base = new URL(config.N8N_BASE_URL.endsWith("/") ? config.N8N_BASE_URL : `${config.N8N_BASE_URL}/`);
    const url = new URL(path.replace(/^\//, ""), base);
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15000), headers: {
      "X-N8N-API-KEY": config.N8N_API_KEY, "Content-Type": "application/json", ...init.headers,
    }});
    if (!response.ok) throw new Error(`n8n API returned HTTP ${response.status}`);
    return await response.json() as T;
  }

  async deploy(input: unknown): Promise<{ id: string; name: string }> {
    const req: Requirements = RequirementsSchema.parse(input);
    if (!req.approved) throw new Error("Explicit approval is required before deployment");
    return this.request("workflows", { method: "POST", body: JSON.stringify(this.compile(req)) });
  }
}
