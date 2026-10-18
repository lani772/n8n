import { jwtVerify, type JWTPayload } from "jose";

const ISSUER = "ai-workflow-architect";
const AUDIENCE = "ai-workflow-architect-api";

export async function verifyAccessToken(token: string, secret: string | Uint8Array): Promise<JWTPayload & { sub: string }> {
  const key = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
  const { payload } = await jwtVerify(token, key, {
    algorithms: ["HS256"],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (typeof payload.sub !== "string" || payload.sub.trim().length === 0) {
    throw new Error("Invalid identity claim");
  }
  return payload as JWTPayload & { sub: string };
}
