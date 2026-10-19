import express, { type Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { createAuthMiddleware } from "./auth.js";
import { deploymentNextAction } from "./deploymentStatusPolicy.js";
import type { WorkflowRepository } from "./workflowRepository.js";

type DeploymentLookup = Pick<WorkflowRepository, "getDeployment">;

export function createDeploymentStatusRouter(
  repository: DeploymentLookup,
  jwtSecret: string | Uint8Array,
): Router {
  const router = express.Router();
  const auth = createAuthMiddleware(jwtSecret);
  const limiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });

  router.get("/:sessionId/deployment", auth, limiter, async (req, res, next) => {
    try {
      const sid = z.string().uuid().safeParse(req.params.sessionId);
      if (!sid.success) {
        res.status(400).json({ error: "Invalid session ID" });
        return;
      }
      const userId = String(res.locals.userId);
      const deployment = await repository.getDeployment(userId, sid.data);
      if (!deployment) {
        res.status(404).json({ error: "Deployment record not found" });
        return;
      }
      res.json({
        sessionId: deployment.session_id,
        name: deployment.name,
        status: deployment.status,
        workflowId: deployment.workflow_id,
        draftHash: deployment.draft_hash.trim(),
        nextAction: deploymentNextAction(deployment.status),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
