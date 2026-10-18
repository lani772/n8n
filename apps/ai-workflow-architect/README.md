# AI Workflow Architect

A TypeScript orchestration service alongside the n8n monorepo. It calls n8n through its public REST API and does not replace or patch n8n's execution engine.

## Repository placement

This project lives under `apps/ai-workflow-architect/` to keep the existing n8n source tree and root workspace configuration unchanged. The target repository is the user's fork `lani772/n8n`; the upstream `n8n-io/n8n` repository is not modified.

## Prerequisites

- Docker Engine and Docker Compose v2
- Node.js 24+ and npm 10+ for local development
- An OpenAI API key

## Quick start

1. `cd apps/ai-workflow-architect`
2. Copy `.env.example` to `.env` and replace every placeholder with a strong secret.
3. Run `docker compose up -d --build`.
4. Complete initial n8n owner setup at `http://localhost:5678`, create a public API key, then add it to `.env` as `N8N_API_KEY` and restart the API: `docker compose up -d --build api`.
5. `curl http://localhost:3000/health/ready`

For local development outside Docker: `npm install`, `npm run typecheck`, `npm test`, `npm run dev`. Set the service URLs to localhost in your local `.env` when not running inside Compose.

## API

- `GET /health/live`: process liveness
- `GET /health/ready`: dependency readiness
- `POST /api/v1/chat/interview`: authenticated multi-turn interview
- `POST /api/v1/chat/:sessionId/deploy`: create an approved workflow as an inactive draft

Authentication expects an HS256 bearer JWT with issuer and audience `ai-workflow-architect`. The JWT signing secret must be shared only with a trusted identity service. This initial scaffold does not include account registration or token issuance.

Example request (replace `$TOKEN` with a valid JWT):

```sh
curl -X POST http://localhost:3000/api/v1/chat/interview \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"message":"When a webhook receives an order, send it to https://api.example.com/orders"}'
```

## Safety boundaries

- Generated workflows are created inactive; activation is not exposed by this initial API.
- The compiler permits only HTTPS custom API endpoints whose exact hostname is in `CUSTOM_API_ALLOWED_HOSTS`.
- Never submit credentials or tokens through chat. Credential mappings are administrator-controlled and default to empty.
- The hostname allowlist is defense in depth, not a complete SSRF defense. Production requires network egress controls, DNS/IP validation, redirect controls and an outbound proxy.
- This scaffold needs integration testing against the exact pinned n8n image before production use. Do not treat JSON validation as proof that a workflow executes successfully.
- PostgreSQL and MongoDB are included as infrastructure foundations; app-specific repositories/migrations and RAG indexing are follow-up work.

## Tests

`npm test` runs isolated Node test-runner tests for requirement validation and endpoint policy. Tests do not require Docker, OpenAI, or a live n8n instance. No runtime integration result is claimed until it is actually run.
