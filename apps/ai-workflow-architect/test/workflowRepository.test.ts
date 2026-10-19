import test from "node:test";
import assert from "node:assert/strict";
import { DeploymentReservationConflict, WorkflowRepository } from "../src/workflowRepository.js";

test("workflow repository scopes list queries to the authenticated user", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const fakeDb = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return { rows: [{ workflow_id: "wf-1", user_id: "user-a" }] };
    },
  };
  const repository = new WorkflowRepository(fakeDb as never);
  const records = await repository.listForUser("user-a");

  assert.equal(records.length, 1);
  assert.match(calls[0]!.sql, /WHERE user_id = \$1/);
  assert.deepEqual(calls[0]!.values, ["user-a"]);
  assert.match(calls[0]!.sql, /LIMIT 100/);
});

test("workflow repository stores deployment values using SQL parameters", async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const fakeDb = {
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values });
      return { rows: [] };
    },
  };
  const repository = new WorkflowRepository(fakeDb as never);
  const requirements = { endpoint: "https://api.example.com", method: "POST" };
  await repository.recordCreated({
    workflowId: "wf-1",
    userId: "user-a",
    sessionId: "a3a3d56d-8a76-49c7-87a8-3a60e56f66cc",
    name: "Example workflow",
    draftHash: "a".repeat(64),
    requirements,
  });

  assert.match(calls[0]!.sql, /INSERT INTO architect_workflows/);
  assert.match(calls[0]!.sql, /\$1, \$2, \$3, \$4, \$5/);
  assert.equal(calls[0]!.values?.[1], "user-a");
  assert.equal(calls[0]!.values?.[5], JSON.stringify(requirements));
  assert.doesNotMatch(calls[0]!.sql, /ON CONFLICT/);
});

test("workflow repository creates an application-owned table and index", async () => {
  const statements: string[] = [];
  const fakeDb = {
    async query(sql: string) {
      statements.push(sql);
      return { rows: [] };
    },
  };
  await new WorkflowRepository(fakeDb as never).ensureSchema();

  assert.match(statements[0]!, /CREATE TABLE IF NOT EXISTS architect_workflows/);
  assert.match(statements[0]!, /UNIQUE \(user_id, session_id\)/);
  assert.match(statements[1]!, /CREATE INDEX IF NOT EXISTS architect_workflows_user_created_idx/);
});


test("deployment intent is persisted before remote deployment", async () => {
  let call: { sql: string; values?: unknown[] } | undefined;
  const fakeDb = {
    async query(sql: string, values?: unknown[]) {
      call = { sql, values };
      return { rows: [], rowCount: 1 };
    },
  };
  const repository = new WorkflowRepository(fakeDb as never);
  await repository.reserveDeployment({
    userId: "user-a",
    sessionId: "a3a3d56d-8a76-49c7-87a8-3a60e56f66cc",
    draftHash: "b".repeat(64),
    name: "Example workflow",
    requirements: { endpoint: "https://api.example.com" },
  });

  assert.match(call!.sql, /INSERT INTO architect_deployments/);
  assert.match(call!.sql, /'pending'/);
  assert.deepEqual(call!.values?.slice(0, 4), [
    "user-a",
    "a3a3d56d-8a76-49c7-87a8-3a60e56f66cc",
    "b".repeat(64),
    "Example workflow",
  ]);
});

test("deployment state can be marked for reconciliation with the remote workflow ID", async () => {
  let call: { sql: string; values?: unknown[] } | undefined;
  const fakeDb = {
    async query(sql: string, values?: unknown[]) {
      call = { sql, values };
      return { rows: [], rowCount: 1 };
    },
  };
  const repository = new WorkflowRepository(fakeDb as never);
  await repository.markDeploymentReconciliationRequired(
    "user-a",
    "a3a3d56d-8a76-49c7-87a8-3a60e56f66cc",
    "database write failed",
    "wf-123",
  );

  assert.match(call!.sql, /status = 'reconciliation_required'/);
  assert.match(call!.sql, /workflow_id = COALESCE\(\$3, workflow_id\)/);
  assert.deepEqual(call!.values, [
    "user-a",
    "a3a3d56d-8a76-49c7-87a8-3a60e56f66cc",
    "wf-123",
    "database write failed",
  ]);
});

test("deployment schema records durable status and recovery metadata", async () => {
  const statements: string[] = [];
  const fakeDb = {
    async query(sql: string) {
      statements.push(sql);
      return { rows: [], rowCount: 0 };
    },
  };
  await new WorkflowRepository(fakeDb as never).ensureSchema();

  assert.match(statements[2]!, /CREATE TABLE IF NOT EXISTS architect_deployments/);
  assert.match(statements[2]!, /'pending', 'created_inactive', 'reconciliation_required'/);
  assert.match(statements[2]!, /PRIMARY KEY \(user_id, session_id\)/);
  assert.match(statements[3]!, /architect_deployments_status_updated_idx/);
});


test("duplicate deployment reservation becomes a typed conflict", async () => {
  let calls = 0;
  const fakeDb = {
    async query() {
      calls += 1;
      const error = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
      throw error;
    },
  };
  const repository = new WorkflowRepository(fakeDb as never);
  await assert.rejects(
    () => repository.reserveDeployment({
      userId: "user-a",
      sessionId: "a3a3d56d-8a76-49c7-87a8-3a60e56f66cc",
      draftHash: "b".repeat(64),
      name: "Example workflow",
      requirements: { endpoint: "https://api.example.com" },
    }),
    DeploymentReservationConflict,
  );
  assert.equal(calls, 1, "duplicate reservation should stop before any remote deployment call");
});

test("non-duplicate database errors are not misclassified as conflicts", async () => {
  const fakeDb = {
    async query() {
      throw Object.assign(new Error("database unavailable"), { code: "08006" });
    },
  };
  const repository = new WorkflowRepository(fakeDb as never);
  await assert.rejects(
    () => repository.reserveDeployment({
      userId: "user-a",
      sessionId: "a3a3d56d-8a76-49c7-87a8-3a60e56f66cc",
      draftHash: "b".repeat(64),
      name: "Example workflow",
      requirements: { endpoint: "https://api.example.com" },
    }),
    (error: unknown) => error instanceof Error && error.message === "database unavailable",
  );
});
