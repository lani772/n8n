import test from "node:test";
import assert from "node:assert/strict";
import { RequirementsSchema } from "../src/types.js";

const base = { name: "Order webhook", trigger: "webhook", action: "http_request", endpoint: "https://api.example.com/orders", method: "POST", approved: false };
test("requirements schema accepts supported webhook-to-HTTP request", () => {
  assert.equal(RequirementsSchema.parse(base).trigger, "webhook");
});
test("requirements schema rejects unsupported trigger", () => {
  assert.throws(() => RequirementsSchema.parse({ ...base, trigger: "schedule" }));
});
test("requirements schema rejects malformed URL", () => {
  assert.throws(() => RequirementsSchema.parse({ ...base, endpoint: "not-a-url" }));
});
test("requirements schema requires explicit valid method", () => {
  assert.throws(() => RequirementsSchema.parse({ ...base, method: "TRACE" }));
});
