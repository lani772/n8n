import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { Redis } from "ioredis";
import { MongoClient } from "mongodb";
import pg from "pg";
import { jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { InterviewService, type ChatMessage } from "./interview.js";
import { N8nCompiler } from "./n8nCompiler.js";
import { RequirementsSchema } from "./types.js";

const app = express();
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, enableReadyCheck: true });
const mongo = new MongoClient(config.mongoUri);
const pool = new pg.Pool({ connectionString: config.postgresAppUrl, max: 10, connectionTimeoutMillis: 5000 });
const interviewer = new InterviewService();
const compiler = new N8nCompiler();
const jwtSecret = new TextEncoder().encode(config.JWT_SECRET);
app.disable("x-powered-by"); app.use(helmet()); app.use(express.json({ limit: "64kb" }));

function auth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  void (async () => {
    try {
      const match = req.header("authorization")?.match(/^Bearer\s+(.+)$/i);
      if (!match) { res.status(401).json({ error: "Authentication required" }); return; }
      const { payload } = await jwtVerify(match[1]!, jwtSecret, { algorithms: ["HS256"], issuer: "ai-workflow-architect", audience: "ai-workflow-architect-api" });
      if (typeof payload.sub !== "string" || !payload.sub) { res.status(401).json({ error: "Invalid identity claim" }); return; }
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
    const state: { messages: ChatMessage[]; complete: boolean; requirements: unknown | null } = raw ? JSON.parse(raw) as { messages: ChatMessage[]; complete: boolean; requirements: unknown | null } : { messages: [], complete: false, requirements: null };
    if (state.complete) { res.status(409).json({ error: "Interview complete", sessionId, requirements: state.requirements }); return; }
    const decision = await interviewer.nextTurn(state.messages, body.data.message);
    state.messages.push({ role: "user", content: body.data.message }, { role: "assistant", content: decision.reply });
    state.messages = state.messages.slice(-40);
    if (decision.complete && decision.requirements) {
      const candidate = { ...decision.requirements, approved: false };
      const valid = RequirementsSchema.safeParse(candidate);
      if (valid.success) { state.complete = true; state.requirements = valid.data; }
    }
    await redis.set(key, JSON.stringify(state), "EX", config.INTERVIEW_TTL_SECONDS);
    res.json({ sessionId, reply: decision.reply, complete: state.complete, requirements: state.requirements, nextStep: state.complete ? "Review and approve before deployment." : "Answer the next question." });
  } catch (error) { next(error); }
});
app.post("/api/v1/chat/:sessionId/deploy", auth, limiter, async (req, res, next) => {
  try {
    const sid = z.string().uuid().safeParse(req.params.sessionId);
    if (!sid.success) { res.status(400).json({ error: "Invalid session ID" }); return; }
    const approval = z.object({ approved: z.literal(true) }).safeParse(req.body);
    if (!approval.success) { res.status(400).json({ error: "Explicit approval required" }); return; }
    const userId = String(res.locals.userId);
    const key = `interview:${userId}:${sid.data}`;
    const raw = await redis.get(key);
    if (!raw) { res.status(404).json({ error: "Interview not found or expired" }); return; }
    const state = JSON.parse(raw) as { complete: boolean; requirements: unknown };
    if (!state.complete || !state.requirements) { res.status(409).json({ error: "Interview is not complete" }); return; }
    const requirements = RequirementsSchema.parse({ ...state.requirements as Record<string, unknown>, approved: true });
    const workflow = await compiler.deploy(requirements);
    res.status(201).json({ workflow, status: "created_inactive" });
  } catch (error) { next(error); }
});
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled request error", error);
  if (!res.headersSent) res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
});
async function main(): Promise<void> {
  await Promise.all([redis.ping(), mongo.connect(), pool.query("SELECT 1")]);
  const server = app.listen(config.PORT, "0.0.0.0", () => console.info(`AI Workflow Architect listening on ${config.PORT}`));
  const shutdown = () => server.close(() => { void Promise.allSettled([redis.quit(), mongo.close(), pool.end()]).then(() => process.exit(0)); });
  process.once("SIGTERM", shutdown); process.once("SIGINT", shutdown);
}
main().catch((error: unknown) => { console.error("Startup failed", error); process.exit(1); });
