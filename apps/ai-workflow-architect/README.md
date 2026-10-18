# AI Workflow Architect

A TypeScript orchestration service alongside the n8n monorepo. It calls n8n through its public REST API and does not replace or patch n8n's execution engine.

## Quick start

1. Change to `apps/ai-workflow-architect/`.
2. Copy `.env.example` to `.env` and replace placeholders with strong secrets.
3. Run `docker compose up -d --build`.
4. Complete initial n8n owner setup at `http://localhost:5678`, create an API key under Settings > n8n API, set `N8N_API_KEY` in `.env`, and restart the API with `docker compose up -d --build api`.
5. Check `curl http://localhost:3000/health/ready`.

Authentication expects an HS256 bearer JWT with issuer `ai-workflow-architect` and audience `ai-workflow-architect-api`, issued by a trusted identity service. This scaffold does not issue tokens or include account registration.

After the interview, the API returns a `draftHash`. Deploy requires `{"approved":true,"draftHash":"<reviewed hash>" }`, binding approval to the exact reviewed requirements. A Redis lock prevents concurrent/repeated submissions. If deployment returns an error after the lock is acquired, the lock is deliberately retained because the service cannot always know whether n8n accepted the create request before the connection failed. This favors preventing duplicates over automatic retries.

**Manual reconciliation after a failed deployment:** inspect the n8n UI/API for a workflow matching the reviewed name and the request time; compare its nodes and endpoint with the reviewed requirements; inspect the application `architect_workflows` table for the session and workflow ID; do not simply retry the same session while its lock exists. If n8n created the workflow but PostgreSQL did not record it, manually record/reconcile the metadata using an audited operator procedure before enabling retries. This scaffold does not yet provide an automated reconciliation endpoint or safe lock-release operation.

## Endpoints

- `GET /health/live`
- `GET /health/ready`
- `POST /api/v1/chat/interview`
- `POST /api/v1/chat/:sessionId/deploy`
- `GET /api/v1/workflows` — list deployments belonging to the authenticated user

## Application data ownership

- PostgreSQL stores deployment metadata in `architect_workflows`, including the authenticated user ID, interview session ID, reviewed draft hash, requirements snapshot, n8n workflow ID, and creation timestamp.
- `GET /api/v1/workflows` filters by the verified JWT subject; clients cannot provide a different user ID to change the scope.
- n8n remains the source of truth for workflow execution state. The application table is a metadata index, not a replacement for n8n execution records.
- The service creates the application table and index at startup using the restricted application database role. For production, move this DDL into versioned migrations.

## Safety and limitations

- Workflows are created inactive; activation is not exposed.
- Endpoint policy requires HTTPS, an exact host allowlist, and rejects local names and IP literals. This is not a complete SSRF defense; production still needs DNS/IP validation and network egress restrictions or an outbound proxy.
- Never send credentials in chat. Credential mappings default to empty and require administrator provisioning.
- PostgreSQL and Mongo app users are created only when their data volumes are initialized for the first time. Existing volumes need manual provisioning.
- Integration testing against the exact n8n image is still required. Unit tests do not prove the generated workflow executes correctly.
- RAG indexing, embeddings, metadata migrations, and a credential mapping admin UI remain future work.

## Development and tests

Use Node.js 24+: `npm install`, `npm run typecheck`, `npm test`, `npm run build`. GitHub Actions runs these checks for the development branch.
