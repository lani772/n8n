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
  }

  async recordCreated(input: WorkflowRecordInput): Promise<void> {
    await this.db.query(
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
