import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  JWT_SECRET: z.string().min(32),
  N8N_BASE_URL: z.string().url(),
  N8N_API_KEY: z.string().min(1),
  CUSTOM_API_ALLOWED_HOSTS: z.string().default(""),
  INTERVIEW_TTL_SECONDS: z.coerce.number().int().min(60).default(3600),
  MAX_CHAT_MESSAGE_LENGTH: z.coerce.number().int().min(1).max(20000).default(8000),
  POSTGRES_USER: z.string().min(1), POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_APP_DATABASE: z.string().default("architect"),
  POSTGRES_APP_USER: z.string().min(1), POSTGRES_APP_PASSWORD: z.string().min(1),
  MONGO_ROOT_USER: z.string().min(1), MONGO_ROOT_PASSWORD: z.string().min(1),
  MONGO_APP_DATABASE: z.string().default("architect"),
  MONGO_APP_USER: z.string().min(1), MONGO_APP_PASSWORD: z.string().min(1),
  REDIS_PASSWORD: z.string().min(1), N8N_ENCRYPTION_KEY: z.string().min(32),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration", parsed.error.flatten().fieldErrors);
  throw new Error("Startup blocked by invalid environment configuration");
}
const e = parsed.data;
export const config = Object.freeze({
  ...e,
  customApiAllowedHosts: e.CUSTOM_API_ALLOWED_HOSTS.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean),
  redisUrl: `redis://:${encodeURIComponent(e.REDIS_PASSWORD)}@redis:6379`,
  mongoUri: `mongodb://${encodeURIComponent(e.MONGO_ROOT_USER)}:${encodeURIComponent(e.MONGO_ROOT_PASSWORD)}@mongo:27017/${encodeURIComponent(e.MONGO_APP_DATABASE)}?authSource=admin`,
  postgresAppUrl: `postgresql://${encodeURIComponent(e.POSTGRES_APP_USER)}:${encodeURIComponent(e.POSTGRES_APP_PASSWORD)}@postgres:5432/${encodeURIComponent(e.POSTGRES_APP_DATABASE)}`,
});
