import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { RequirementsSchema } from "../src/types.js";
import { validateEndpoint } from "../src/endpointPolicy.js";

const base = { name: "Order webhook", trigger: "webhook", action: "http_request", endpoint: "https://api.example.com/orders", method: "POST", approved: false };
test("requirements schema accepts supported webhook-to-HTTP request", () => assert.equal(RequirementsSchema.parse(base).trigger, "webhook"));
test("requirements schema rejects unsupported trigger", () => assert.throws(() => RequirementsSchema.parse({ ...base, trigger: "schedule" })));
test("requirements schema rejects malformed URL", () => assert.throws(() => RequirementsSchema.parse({ ...base, endpoint: "not-a-url" })));
test("requirements schema rejects invalid method", () => assert.throws(() => RequirementsSchema.parse({ ...base, method: "TRACE" })));
test("endpoint policy accepts allowlisted HTTPS hostname", () => assert.equal(validateEndpoint("https://api.example.com/orders", ["api.example.com"]).hostname, "api.example.com"));
test("endpoint policy rejects HTTP", () => assert.throws(() => validateEndpoint("http://api.example.com", ["api.example.com"])));
test("endpoint policy rejects URL credentials", () => assert.throws(() => validateEndpoint("https://user:pass@api.example.com", ["api.example.com"])));
test("endpoint policy rejects hostnames outside exact allowlist", () => assert.throws(() => validateEndpoint("https://sub.api.example.com", ["api.example.com"])));
test("endpoint policy rejects local and IP-literal targets", () => {
  assert.throws(() => validateEndpoint("https://localhost", ["localhost"]));
  assert.throws(() => validateEndpoint("https://localhost.", ["localhost."]));
  assert.throws(() => validateEndpoint("https://printer.local", ["printer.local"]));
  assert.throws(() => validateEndpoint("https://printer.local.", ["printer.local."]));
  assert.throws(() => validateEndpoint("https://service.internal", ["service.internal"]));
  assert.throws(() => validateEndpoint("https://service.localhost", ["service.localhost"]));
  assert.throws(() => validateEndpoint("https://127.0.0.1", ["127.0.0.1"]));
  assert.throws(() => validateEndpoint("https://[::1]", ["::1"]));
});
test("endpoint policy does not accept a hostname that merely contains an allowlisted suffix", () => {
  assert.throws(() => validateEndpoint("https://api.example.com.attacker.test/path", ["api.example.com"]));
});

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let handler: Handler = (_req, res) => { res.writeHead(404).end(); };
const server = createServer((req, res) => handler(req, res));
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("Mock n8n server did not bind to a TCP port");
Object.assign(process.env, {
  NODE_ENV: "test",
  OPENAI_API_KEY: "test-openai-key",
  OPENAI_MODEL: "test-model",
  JWT_SECRET: "test-jwt-secret-that-is-long-enough-for-validation",
  N8N_BASE_URL: `http://127.0.0.1:${address.port}/api/v1/`,
  N8N_API_KEY: "test-n8n-key",
  CUSTOM_API_ALLOWED_HOSTS: "api.example.com",
  POSTGRES_USER: "test", POSTGRES_PASSWORD: "test",
  POSTGRES_APP_USER: "test", POSTGRES_APP_PASSWORD: "test",
  MONGO_ROOT_USER: "test", MONGO_ROOT_PASSWORD: "test",
  MONGO_APP_USER: "test", MONGO_APP_PASSWORD: "test",
  REDIS_PASSWORD: "test",
  N8N_ENCRYPTION_KEY: "test-encryption-key-that-is-long-enough",
});
const { N8nApiError, N8nCompiler } = await import("../src/n8nCompiler.js");
const compiler = new N8nCompiler();

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});


test("deployment markers are stable and scoped to both user and session", () => {
  const first = compiler.deploymentMarker("user-a", "session-a");
  assert.equal(first, compiler.deploymentMarker("user-a", "session-a"));
  assert.match(first, /^[a-f0-9]{20}$/);
  assert.notEqual(first, compiler.deploymentMarker("user-b", "session-a"));
  assert.notEqual(first, compiler.deploymentMarker("user-a", "session-b"));
});

test("deploy sends an approved inactive-by-default two-node workflow to the n8n API", async () => {
  let receivedBody: Record<string, any> | undefined;
  handler = (req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/api/v1/workflows");
    assert.equal(req.headers["x-n8n-api-key"], "test-n8n-key");
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      receivedBody = JSON.parse(raw) as Record<string, any>;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "wf-created", name: receivedBody.name }));
    });
  };
  const workflow = await compiler.deploy({ ...base, approved: true }, "marker123");
  assert.equal(workflow.id, "wf-created");
  assert.match(workflow.name, /\[architect:marker123\]$/);
  assert.equal(receivedBody?.nodes?.length, 2);
  assert.equal(receivedBody?.nodes?.[0]?.type, "n8n-nodes-base.webhook");
  assert.equal(receivedBody?.nodes?.[1]?.type, "n8n-nodes-base.httpRequest");
  assert.equal(receivedBody?.nodes?.[1]?.parameters?.options?.redirect?.redirect?.followRedirects, false);
  assert.deepEqual(receivedBody?.connections?.["Incoming Webhook"]?.main?.[0]?.[0], {
    node: "Send to Approved API", type: "main", index: 0,
  });
});

test("deploy refuses an unapproved draft before calling the n8n API", async () => {
  handler = (_req, res) => { res.writeHead(500).end(); };
  await assert.rejects(() => compiler.deploy(base, "marker123"), /Explicit approval is required/);
});

test("marker lookup follows cursor pagination and only returns exact suffix matches", async () => {
  const urls: string[] = [];
  handler = (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    urls.push(url.pathname + url.search);
    res.writeHead(200, { "content-type": "application/json" });
    if (!url.searchParams.has("cursor")) {
      res.end(JSON.stringify({
        data: [{ id: "wf-other", name: "not a marker [architect:other]" }],
        nextCursor: "cursor-2",
      }));
    } else {
      res.end(JSON.stringify({
        data: [
          { id: "wf-match", name: "Order webhook [architect:marker123]" },
          { id: "wf-prefix", name: "Order webhook [architect:marker123] copy" },
        ],
      }));
    }
  };
  const matches = await compiler.findByDeploymentMarker("marker123");
  assert.deepEqual(matches, [{ id: "wf-match", name: "Order webhook [architect:marker123]" }]);
  assert.equal(urls.length, 2);
  assert.match(urls[1]!, /cursor=cursor-2/);
});

test("workflow details preserve active state and connections returned by n8n", async () => {
  const details = {
    id: "wf-detail", name: "Inactive workflow", active: false,
    nodes: [{ name: "Incoming Webhook", type: "n8n-nodes-base.webhook", parameters: { httpMethod: "POST", path: "test" } }],
    connections: { "Incoming Webhook": { main: [[]] } },
  };
  handler = (_req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(details));
  assert.deepEqual(await compiler.getWorkflowDetails("wf-detail"), details);
});


test("n8n API errors preserve HTTP status for recovery decisions", async () => {
  handler = (_req, res) => res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ message: "not found" }));
  await assert.rejects(
    () => compiler.getWorkflowDetails("wf-missing"),
    (error: unknown) => error instanceof N8nApiError && error.status === 404 && /HTTP 404/.test(error.message),
  );
  handler = (_req, res) => res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ message: "unavailable" }));
  await assert.rejects(
    () => compiler.getWorkflowDetails("wf-unavailable"),
    (error: unknown) => error instanceof N8nApiError && error.status === 503,
  );
});


test("n8n API client refuses redirects rather than forwarding its API key", async () => {
  handler = (_req, res) => res.writeHead(302, { location: "http://127.0.0.1/redirect-target" }).end();
  await assert.rejects(() => compiler.getWorkflowDetails("wf-redirect"));
});

test("marker lookup fails closed when the 5,000-workflow scan limit is reached", async () => {
  let requests = 0;
  handler = (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    assert.equal(url.searchParams.get("limit"), "250");
    requests += 1;
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      data: [],
      nextCursor: `cursor-${requests + 1}`,
    }));
  };
  await assert.rejects(() => compiler.findByDeploymentMarker("marker123"), /5,000-workflow safety limit/);
  assert.equal(requests, 20);
});
