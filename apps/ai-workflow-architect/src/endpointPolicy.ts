import { isIP } from "node:net";
export function validateEndpoint(raw: string, allowedHosts: readonly string[]): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Endpoint must be a valid URL"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Endpoint must be HTTPS and contain no embedded credentials");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const allowlist = allowedHosts.map((item) => item.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "")).filter(Boolean);
  if (!allowlist.includes(host)) throw new Error("Endpoint hostname is not allowlisted");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || isIP(host) !== 0) {
    throw new Error("Private, local, and IP-literal endpoints are not permitted");
  }
  return url;
}
