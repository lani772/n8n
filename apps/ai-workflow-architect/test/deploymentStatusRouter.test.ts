import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { SignJWT } from "jose";
import { createDeploymentStatusRouter } from "../src/deploymentStatusRouter.js";
import type { DeploymentStatus } from "../src/workflowRepository.js";

const secret = "a-test-secret-that-is-long-enough-for-hs256";
const sessionId = "a3a3d56d-8a76-49c7-87a8-3a60e56f66cc";

type Deployment = {
  user_id: string;
  session_id: string;
  draft_hash: string;
  status: DeploymentStatus;
  workflow_id: string | null;
  name: string;
  requirements: unknown;
  last_error: string | null;
};

async function token(subject = "user-a"): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("ai-workflow-architect")
    .setAudience("ai-workflow-architect-api")
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(new TextEncoder().encode(secret));
}

async function startServer(repository: {
  getDeployment(userId: string, sessionId: string): Promise<Deployment | undefined>;
}) {
  const app = express();
  app.use("/api/v1/chat", createDeploymentStatusRouter(repository, secret));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/api/v1/chat/${sessionId}/deployment`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function sampleDeployment(status: DeploymentStatus): Deployment {
  return {
    user_id: "user-a",
    session_id: sessionId,
    draft_hash: "a".repeat(64),
    status,
    workflow_id: status === "created_inactive" ? "wf-123" : null,
    name: "Test workflow",
    requirements: { endpoint: "https://api.example.com" },
    last_error: null,
  };
}

test("deployment status endpoint rejects missing and invalid bearer tokens", async () => {
  const server = await startServer({ async getDeployment() { throw new Error("repository must not be called"); } });
  try {
    const missing = await fetch(server.url);
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { error: "Authentication required" });

    const invalid = await fetch(server.url, { headers: { authorization: "Bearer not-a-jwt" } });
    assert.equal(invalid.status, 401);
    assert.deepEqual(await invalid.json(), { error: "Invalid or expired token" });
  } finally {
    await server.close();
  }
});

test("deployment status endpoint validates session IDs before querying storage", async () => {
  let calls = 0;
  const app = express();
  app.use("/api/v1/chat", createDeploymentStatusRouter({
    async getDeployment() { calls += 1; return undefined; },
  }, secret));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/chat/not-a-uuid/deployment`, {
      headers: { authorization: `Bearer ${await token()}` },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid session ID" });
    assert.equal(calls, 0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("deployment status endpoint returns 404 when the user has no matching record", async () => {
  const calls: Array<[string, string]> = [];
  const server = await startServer({
    async getDeployment(userId, sid) { calls.push([userId, sid]); return undefined; },
  });
  try {
    const response = await fetch(server.url, { headers: { authorization: `Bearer ${await token()}` } });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Deployment record not found" });
    assert.deepEqual(calls, [["user-a", sessionId]]);
  } finally {
    await server.close();
  }
});

test("deployment status endpoint scopes lookup to the identity in the verified token", async () => {
  const calls: Array<[string, string]> = [];
  const server = await startServer({
    async getDeployment(userId, sid) {
      calls.push([userId, sid]);
      return userId === "user-a" ? sampleDeployment("created_inactive") : undefined;
    },
  });
  try {
    const response = await fetch(server.url, { headers: { authorization: `Bearer ${await token("user-b")}` } });
    assert.equal(response.status, 404);
    assert.deepEqual(calls, [["user-b", sessionId]]);
  } finally {
    await server.close();
  }
});

test("deployment status endpoint returns safe status fields and the completed action", async () => {
  const server = await startServer({ async getDeployment() { return sampleDeployment("created_inactive"); } });
  try {
    const response = await fetch(server.url, { headers: { authorization: `Bearer ${await token()}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      sessionId,
      name: "Test workflow",
      status: "created_inactive",
      workflowId: "wf-123",
      draftHash: "a".repeat(64),
      nextAction: "workflow_created_inactive",
    });
  } finally {
    await server.close();
  }
});

test("pending deployment status recommends reconciliation before retry", async () => {
  const server = await startServer({ async getDeployment() { return sampleDeployment("pending"); } });
  try {
    const response = await fetch(server.url, { headers: { authorization: `Bearer ${await token()}` } });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { nextAction: string }).nextAction, "reconcile_before_retry");
  } finally {
    await server.close();
  }
});

test("uncertain deployment status recommends reconciliation before retry", async () => {
  const server = await startServer({ async getDeployment() { return sampleDeployment("reconciliation_required"); } });
  try {
    const response = await fetch(server.url, { headers: { authorization: `Bearer ${await token()}` } });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { nextAction: string }).nextAction, "reconcile_before_retry");
  } finally {
    await server.close();
  }
});
