import test from "node:test";
import assert from "node:assert/strict";
import { WorkflowRepository } from "../src/workflowRepository.js";

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
  assert.match(calls[0]!.sql, /ON CONFLICT \(workflow_id\) DO NOTHING/);
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
