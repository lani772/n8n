import type { Pool } from "pg";

export interface WorkflowRecordInput {
  workflowId: string;
  userId: string;
  sessionId: string;
  name: string;
  draftHash: string;
  requirements: unknown;
}

export interface WorkflowRecord {
  workflow_id: string;
  user_id: string;
  session_id: string;
  name: string;
  draft_hash: string;
  status: "created_inactive";
  requirements: unknown;
  created_at: Date;
}

export type DeploymentStatus = "pending" | "created_inactive" | "reconciliation_required";

export class DeploymentReservationConflict extends Error {
  constructor() {
    super("A deployment reservation already exists for this user and session");
    this.name = "DeploymentReservationConflict";
  }
}

type Queryable = Pick<Pool, "query">;

/**
 * Stores application-owned deployment metadata. n8n remains the source of truth
 * for workflow execution and runtime state.
 */
export class WorkflowRepository {
  constructor(private readonly db: Queryable) {}

  async ensureSchema(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS architect_workflows (
        workflow_id text PRIMARY KEY,
        user_id text NOT NULL,
        session_id uuid NOT NULL,
        name text NOT NULL,
        draft_hash char(64) NOT NULL,
        status text NOT NULL CHECK (status IN ('created_inactive')),
        requirements jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, session_id)
      )
    `);
    await this.db.query(
      "CREATE INDEX IF NOT EXISTS architect_workflows_user_created_idx ON architect_workflows (user_id, created_at DESC)",
    );
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS architect_deployments (
        user_id text NOT NULL,
        session_id uuid NOT NULL,
        draft_hash char(64) NOT NULL,
        status text NOT NULL CHECK (status IN ('pending', 'created_inactive', 'reconciliation_required')),
        workflow_id text,
        name text NOT NULL,
        requirements jsonb NOT NULL,
        last_error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, session_id)
      )
    `);
    await this.db.query(
      "CREATE INDEX IF NOT EXISTS architect_deployments_status_updated_idx ON architect_deployments (status, updated_at DESC)",
    );
  }

  /** Persist intent before calling n8n, preventing a Redis TTL from erasing the only retry guard. */
  async reserveDeployment(input: {
    userId: string;
    sessionId: string;
    draftHash: string;
    name: string;
    requirements: unknown;
  }): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO architect_deployments
          (user_id, session_id, draft_hash, status, name, requirements)
         VALUES ($1, $2, $3, 'pending', $4, $5::jsonb)`,
        [input.userId, input.sessionId, input.draftHash, input.name, JSON.stringify(input.requirements)],
      );
    } catch (error) {
      // PostgreSQL's primary key is the durable duplicate-deployment guard.
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        throw new DeploymentReservationConflict();
      }
      throw error;
    }
  }

  async getDeployment(userId: string, sessionId: string): Promise<{
    user_id: string;
    session_id: string;
    draft_hash: string;
    status: DeploymentStatus;
    workflow_id: string | null;
    name: string;
    requirements: unknown;
    last_error: string | null;
  } | undefined> {
    const result = await this.db.query(
      `SELECT user_id, session_id, draft_hash, status, workflow_id, name, requirements, last_error
       FROM architect_deployments WHERE user_id = $1 AND session_id = $2 LIMIT 1`,
      [userId, sessionId],
    );
    return result.rows[0] as {
      user_id: string;
      session_id: string;
      draft_hash: string;
      status: DeploymentStatus;
      workflow_id: string | null;
      name: string;
      requirements: unknown;
      last_error: string | null;
    } | undefined;
  }

  async markDeploymentCreated(userId: string, sessionId: string, workflowId: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE architect_deployments
       SET status = 'created_inactive', workflow_id = $3, last_error = NULL, updated_at = now()
       WHERE user_id = $1 AND session_id = $2 AND status IN ('pending', 'reconciliation_required')`,
      [userId, sessionId, workflowId],
    );
    if (result.rowCount !== 1) {
      throw new Error("Deployment record was not available to mark as created");
    }
  }

  async markDeploymentReconciliationRequired(
    userId: string,
    sessionId: string,
    errorMessage: string,
    workflowId?: string,
  ): Promise<void> {
    await this.db.query(
      `UPDATE architect_deployments
       SET status = 'reconciliation_required',
           workflow_id = COALESCE($3, workflow_id),
           last_error = $4,
           updated_at = now()
       WHERE user_id = $1 AND session_id = $2 AND status <> 'created_inactive'`,
      [userId, sessionId, workflowId ?? null, errorMessage.slice(0, 1000)],
    );
  }

  async recordCreated(input: WorkflowRecordInput): Promise<void> {
    const inserted = await this.db.query(
      `INSERT INTO architect_workflows
        (workflow_id, user_id, session_id, name, draft_hash, status, requirements)
       VALUES ($1, $2, $3, $4, $5, 'created_inactive', $6::jsonb)
       ON CONFLICT (workflow_id) DO NOTHING`,
      [
        input.workflowId,
        input.userId,
        input.sessionId,
        input.name,
        input.draftHash,
        JSON.stringify(input.requirements),
      ],
    );
    if (inserted.rowCount === 1) return;

    const existing = await this.db.query(
      `SELECT user_id, session_id, draft_hash FROM architect_workflows WHERE workflow_id = $1`,
      [input.workflowId],
    );
    const row = existing.rows[0] as { user_id: string; session_id: string; draft_hash: string } | undefined;
    if (!row || row.user_id !== input.userId || row.session_id !== input.sessionId || row.draft_hash.trim() !== input.draftHash) {
      throw new Error("Workflow ID already belongs to different deployment metadata");
    }
  }

  async listForUser(userId: string): Promise<WorkflowRecord[]> {
    const result = await this.db.query<WorkflowRecord>(
      `SELECT workflow_id, user_id, session_id, name, draft_hash, status, requirements, created_at
       FROM architect_workflows
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId],
    );
    return result.rows;
  }
}
