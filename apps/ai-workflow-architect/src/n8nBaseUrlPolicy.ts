export function validateN8nBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("N8N_BASE_URL must be a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("N8N_BASE_URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("N8N_BASE_URL must not contain embedded credentials");
  }
  if (url.search || url.hash) {
    throw new Error("N8N_BASE_URL must not contain a query string or fragment");
  }

  return url;
}
