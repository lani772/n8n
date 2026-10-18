import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { verifyAccessToken } from "../src/auth.js";

const secret = "a-secure-test-secret-with-at-least-32-characters";
const key = new TextEncoder().encode(secret);
const issuer = "ai-workflow-architect";
const audience = "ai-workflow-architect-api";

async function token(options: { subject?: string; issuer?: string; audience?: string; algorithm?: "HS256" | "HS384"; expired?: boolean } = {}) {
  const builder = new SignJWT({ role: "user" })
    .setProtectedHeader({ alg: options.algorithm ?? "HS256" })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setIssuedAt();
  if (options.subject !== undefined) builder.setSubject(options.subject);
  if (options.expired) builder.setExpirationTime(2);
  else builder.setExpirationTime("2m");
  return builder.sign(key);
}

test("JWT verifier accepts a correctly signed access token and returns its subject", async () => {
  const payload = await verifyAccessToken(await token({ subject: "user-123" }), secret);
  assert.equal(payload.sub, "user-123");
});

test("JWT verifier rejects a token signed with another secret", async () => {
  await assert.rejects(async () => verifyAccessToken(await token({ subject: "user-123" }), "another-test-secret-that-is-also-long-enough"));
});

test("JWT verifier rejects the wrong issuer or audience", async () => {
  await assert.rejects(() => verifyAccessToken(await token({ subject: "user-123", issuer: "untrusted-issuer" }), secret));
  await assert.rejects(() => verifyAccessToken(await token({ subject: "user-123", audience: "other-api" }), secret));
});

test("JWT verifier rejects missing subject, expired token, and disallowed algorithm", async () => {
  await assert.rejects(() => verifyAccessToken(await token(), secret), /identity claim/);
  await assert.rejects(() => verifyAccessToken(await token({ subject: "user-123", expired: true }), secret));
  await assert.rejects(() => verifyAccessToken(await token({ subject: "user-123", algorithm: "HS384" }), secret));
});
