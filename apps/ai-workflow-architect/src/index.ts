import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { Redis } from "ioredis";
import { MongoClient } from "mongodb";
import pg from "pg";
import { verifyAccessToken } from "./auth.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { InterviewService, type ChatMessage } from "./interview.js";
import { N8nCompiler } from "./n8nCompiler.js";
import { WorkflowRepository } from "./workflowRepository.js";
import { RequirementsSchema } from "./types.js";
import { hashDraft, isDraftApprovalValid } from "./draftApproval.js";

const app = express();
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, enableReadyCheck: true });
const mongo = new MongoClient(config.mongoUri);
const pool = new pg.Pool({ connectionString: config.postgresAppUrl, max: 10, connectionTimeoutMillis: 5000 });
const interviewer = new InterviewService();
const compiler = new N8nCompiler();
const workflowRepository = new WorkflowRepository(pool);
const SessionSchema = z.object({ messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).max(40), complete: z.boolean(), requirements: z.unknown().nullable(), draftHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), deployed: z.boolean().default(false) });
type SessionState = z.infer<typeof SessionSchema>;
app.disable("x-powered-by"); app.use(helmet()); app.use(express.json({ limit: "64kb" }));

function auth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  void (async () => {
    try {
      const match = req.header("authorization")?.match(/^Bearer\s+(.+)$/i);
      if (!match) { res.status(401).json({ error: "Authentication required" }); return; }
      const payload = await verifyAccessToken(match[1]!, config.JWT_SECRET);
      res.locals.userId = payload.sub; next();
    } catch { res.status(401).json({ error: "Invalid or expired token" }); }
  })();
}
const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
app.get("/health/ready", async (_req, res) => {
  try { await Promise.all([redis.ping(), mongo.db(config.MONGO_APP_DATABASE).command({ ping: 1 }), pool.query("SELECT 1")]); res.json({ status: "ready" }); }
  catch { res.status(503).json({ status: "not_ready" }); }
});
app.post("/api/v1/chat/interview", auth, limiter, async (req, res, next) => {
  try {
    const body = z.object({ sessionId: z.string().uuid().optional(), message: z.string().trim().min(1).max(config.MAX_CHAT_MESSAGE_LENGTH) }).safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "Invalid request", details: body.error.flatten() }); return; }
    const userId = String(res.locals.userId);
    const sessionId = body.data.sessionId ?? randomUUID();
    const key = `interview:${userId}:${sessionId}`;
    const raw = await redis.get(key);
    const parsed = raw ? SessionSchema.safeParse(JSON.parse(raw)) : { success: true as const, data: { messages: [], complete: false, requirements: null, deployed: false } as SessionState };
    if (!parsed.success) { res.status(500).json({ error: "Stored interview state is invalid" }); return; }
    const state = parsed.data;
    if (state.complete) { res.status(409).json({ error: "Interview complete", sessionId, requirements: state.requirements, draftHash: state.draftHash }); return; }
    const decision = await interviewer.nextTurn(state.messages, body.data.message);
    state.messages.push({ role: "user", content: body.data.message }, { role: "assistant", content: decision.reply });
    state.messages = state.messages.slice(-40);
    if (decision.complete && decision.requirements) {
      const candidate = { ...decision.requirements, approved: false };
      const valid = RequirementsSchema.safeParse(candidate);
      if (valid.success) { state.complete = true; state.requirements = valid.data; state.draftHash = hashDraft(valid.data); }
    }
    await redis.set(key, JSON.stringify(state), "EX", config.INTERVIEW_TTL_SECONDS);
    res.json({ sessionId, reply: decision.reply, complete: state.complete, requirements: state.requirements, draftHash: state.draftHash, nextStep: state.complete ? "Review this exact draft and approve using its draftHash before deployment." : "Answer the next question." });
  } catch (error) { next(error); }
});
app.post("/api/v1/chat/:sessionId/reconcile", auth, limiter, async (req, res, next) => {
  try {
    const sid = z.string().uuid().safeParse(req.params.sessionId);
    if (!sid.success) { res.status(400).json({ error: "Invalid session ID" }); return; }
    const userId = String(res.locals.userId);
    const deployment = await workflowRepository.getDeployment(userId, sid.data);
    if (!deployment) { res.status(404).json({ error: "Deployment record not found" }); return; }
    if (deployment.status === "created_inactive" && deployment.workflow_id) {
      res.json({ status: "created_inactive", workflowId: deployment.workflow_id, reconciled: false });
      return;
    }
    const marker = compiler.deploymentMarker(userId, sid.data);
    const matches = await compiler.findByDeploymentMarker(marker);
    if (matches.length !== 1) {
      res.status(409).json({
        error: matches.length === 0
          ? "No matching workflow found in the scanned n8n workflows; deployment remains unresolved"
          : "Multiple matching workflows found; manual review required",
        status: deployment.status,
      });
      return;
    }
    const workflow = matches[0]!;
    const details = await compiler.getWorkflowDetails(workflow.id);
    const requirements = RequirementsSchema.safeParse(deployment.requirements);
    const trigger = details.nodes?.find((node) => node.type === "n8n-nodes-base.webhook");
    const action = details.nodes?.find((node) => node.type === "n8n-nodes-base.httpRequest");
    const expectedEndpoint = requirements.success ? compiler.validateEndpoint(requirements.data.endpoint).toString() : undefined;
    if (
      !requirements.success ||
      details.name !== workflow.name ||
      !trigger ||
      !action ||
      action.parameters?.url !== expectedEndpoint ||
      action.parameters?.method !== requirements.data.method
    ) {
      await workflowRepository.markDeploymentReconciliationRequired(
        userId,
        sid.data,
        "Marked workflow did not match the approved trigger/action/endpoint; manual review required",
        workflow.id,
      );
      res.status(409).json({ error: "Matching marker found, but workflow content did not match the approved draft; manual review required" });
      return;
    }
    await workflowRepository.recordCreated({
      workflowId: workflow.id,
      userId,
      sessionId: sid.data,
      name: deployment.name,
      draftHash: deployment.draft_hash.trim(),
      requirements: deployment.requirements,
    });
    await workflowRepository.markDeploymentCreated(userId, sid.data, workflow.id);
    const sessionKey = `interview:${userId}:${sid.data}`;
    const rawSession = await redis.get(sessionKey);
    if (rawSession) {
      const parsedSession = SessionSchema.safeParse(JSON.parse(rawSession));
      if (parsedSession.success) {
        parsedSession.data.deployed = true;
        await redis.set(sessionKey, JSON.stringify(parsedSession.data), "EX", config.INTERVIEW_TTL_SECONDS);
      }
    }
    await redis.set(`deploy:${userId}:${sid.data}`, `deployed:${workflow.id}`, "EX", config.INTERVIEW_TTL_SECONDS);
    res.json({ status: "created_inactive", workflowId: workflow.id, reconciled: true });
  } catch (error) { next(error); }
});

app.get("/api/v1/workflows", auth, limiter, async (_req, res, next) => {
  try {
    const records = await workflowRepository.listForUser(String(res.locals.userId));
    res.json({ workflows: records });
  } catch (error) { next(error); }
});
app.post("/api/v1/chat/:sessionId/deploy", auth, limiter, async (req, res, next) => {
  try {
    const sid = z.string().uuid().safeParse(req.params.sessionId);
    if (!sid.success) { res.status(400).json({ error: "Invalid session ID" }); return; }
    const approval = z.object({ approved: z.literal(true), draftHash: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(req.body);
    if (!approval.success) { res.status(400).json({ error: "Explicit approval and the reviewed draftHash are required" }); return; }
    const userId = String(res.locals.userId);
    const key = `interview:${userId}:${sid.data}`;
    const raw = await redis.get(key);
    if (!raw) { res.status(404).json({ error: "Interview not found or expired" }); return; }
    const parsed = SessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) { res.status(500).json({ error: "Stored interview state is invalid" }); return; }
    const state = parsed.data;
    if (!state.complete || !state.requirements || !state.draftHash) { res.status(409).json({ error: "Interview is not complete" }); return; }
    if (state.deployed) { res.status(409).json({ error: "This approved draft has already been deployed" }); return; }
    if (!isDraftApprovalValid(state.requirements, state.draftHash, approval.data.draftHash)) { res.status(409).json({ error: "Draft changed; review and approve the current draft again" }); return; }
    const lockKey = `deploy:${userId}:${sid.data}`;
    const locked = await redis.set(lockKey, "in-progress", "EX", config.INTERVIEW_TTL_SECONDS, "NX");
    if (locked !== "OK") { res.status(409).json({ error: "Deployment is already in progress or was already submitted" }); return; }
    const requirements = RequirementsSchema.parse({ ...state.requirements as Record<string, unknown>, approved: true });
    try {
      await workflowRepository.reserveDeployment({
        userId,
        sessionId: sid.data,
        draftHash: state.draftHash,
        name: requirements.name,
        requirements,
      });
    } catch (error) {
      // The remote n8n call has not started, so releasing this short-lived lock is safe.
      await redis.del(lockKey);
      throw error;
    }

    let workflowId: string | undefined;
    try {
      const marker = compiler.deploymentMarker(userId, sid.data);
      const workflow = await compiler.deploy(requirements, marker);
      workflowId = workflow.id;
      await workflowRepository.recordCreated({ workflowId: workflow.id, userId, sessionId: sid.data, name: requirements.name, draftHash: state.draftHash, requirements });
      await workflowRepository.markDeploymentCreated(userId, sid.data, workflow.id);
      state.deployed = true;
      await redis.set(key, JSON.stringify(state), "EX", config.INTERVIEW_TTL_SECONDS);
      await redis.set(lockKey, `deployed:${workflow.id}`, "EX", config.INTERVIEW_TTL_SECONDS);
      res.status(201).json({ workflow, status: "created_inactive", draftHash: state.draftHash });
    } catch (error) {
      // Persist uncertain outcomes so a Redis TTL cannot erase the only recovery signal.
      try {
        await workflowRepository.markDeploymentReconciliationRequired(
          userId,
          sid.data,
          error instanceof Error ? error.message : "Unknown deployment failure",
          workflowId,
        );
      } catch (repositoryError) {
        console.error("Could not persist deployment reconciliation state", repositoryError);
      }
      try {
        await redis.set(lockKey, "reconciliation-required", "EX", config.INTERVIEW_TTL_SECONDS);
      } catch (lockError) {
        console.error("Could not mark deployment for reconciliation", lockError);
      }
      throw error;
    }
  } catch (error) { next(error); }
});
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled request error", error);
  if (!res.headersSent) res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
});
async function main(): Promise<void> {
  await Promise.all([redis.ping(), mongo.connect(), pool.query("SELECT 1")]);
  await workflowRepository.ensureSchema();
  const server = app.listen(config.PORT, "0.0.0.0", () => console.info(`AI Workflow Architect listening on ${config.PORT}`));
  const shutdown = () => server.close(() => { void Promise.allSettled([redis.quit(), mongo.close(), pool.end()]).then(() => process.exit(0)); });
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
}
main().catch((error: unknown) => { console.error("Startup failed", error); process.exit(1); });
