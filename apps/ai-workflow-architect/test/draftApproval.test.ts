import test from "node:test";
import assert from "node:assert/strict";
import { hashDraft, isDraftApprovalValid } from "../src/draftApproval.js";

const draft = {
  name: "Order webhook",
  trigger: "webhook",
  action: "http_request",
  endpoint: "https://api.example.com/orders",
  method: "POST",
  approved: false,
  description: "",
};

test("draft hash is a 64-character SHA-256 hex digest", () => {
  assert.match(hashDraft(draft), /^[a-f0-9]{64}$/);
});

test("approval accepts the exact stored draft hash", () => {
  const hash = hashDraft(draft);
  assert.equal(isDraftApprovalValid(draft, hash, hash), true);
});

test("approval rejects a submitted hash from another draft", () => {
  assert.equal(isDraftApprovalValid(draft, hashDraft(draft), "a".repeat(64)), false);
});

test("approval rejects requirements changed after the draft was reviewed", () => {
  const reviewedHash = hashDraft(draft);
  const changedDraft = { ...draft, endpoint: "https://api.example.com/other" };
  assert.equal(isDraftApprovalValid(changedDraft, reviewedHash, reviewedHash), false);
});

test("approval rejects missing stored hash", () => {
  assert.equal(isDraftApprovalValid(draft, undefined, hashDraft(draft)), false);
});
