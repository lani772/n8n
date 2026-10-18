import test from "node:test";
import assert from "node:assert/strict";
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
  assert.throws(() => validateEndpoint("https://127.0.0.1", ["127.0.0.1"]));
  assert.throws(() => validateEndpoint("https://[::1]", ["::1"]));
});
