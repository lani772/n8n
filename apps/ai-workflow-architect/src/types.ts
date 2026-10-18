import { z } from "zod";

export const RequirementsSchema = z.object({
  name: z.string().trim().min(3).max(100),
  trigger: z.literal("webhook"),
  action: z.literal("http_request"),
  endpoint: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  credentialKey: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
  approved: z.boolean().default(false),
  description: z.string().max(2000).default(""),
});
export type Requirements = z.infer<typeof RequirementsSchema>;
export interface N8nNode {
  parameters: Record<string, unknown>; id: string; name: string; type: string;
  typeVersion: number; position: [number, number];
  credentials?: Record<string, { id: string; name: string }>;
  webhookId?: string;
}
export interface N8nWorkflowPayload {
  name: string; nodes: N8nNode[]; connections: Record<string, unknown>;
  settings: Record<string, unknown>;
}
