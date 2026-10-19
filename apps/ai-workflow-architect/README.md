# AI Workflow Architect

A TypeScript orchestration service alongside the n8n monorepo. It calls n8n through its public REST API and does not replace or patch n8n's execution engine.

## Quick start

1. Change to `apps/ai-workflow-architect/`.
2. Copy `.env.example` to `.env` and replace placeholders with strong secrets.
3. Run `docker compose up -d --build`.
4. Complete initial n8n owner setup at `http://localhost:5678`, create an API key under Settings > n8n API, set `N8N_API_KEY` in `.env`, and restart the API with `docker compose up -d --build api`.
5. Check `curl http://localhost:3000/health/ready`.

Authentication expects an HS256 bearer JWT with issuer `ai-workflow-architect` and audience `ai-workflow-architect-api`, issued by a trusted identity service. This scaffold does not issue tokens or include account registration.

After the interview, the API returns a `draftHash`. Deploy requires `{"approved":true,"draftHash":"<reviewed hash>" }`, binding approval to the exact reviewed requirements. A Redis lock prevents concurrent submissions, while PostgreSQL records a durable deployment intent in `architect_deployments` **before** the service calls n8n. A repeated reservation for the same user/session returns HTTP `409` with status `deployment_exists`; the API does not start a second n8n create request and directs the caller to reconcile the existing attempt. The row is keyed by authenticated user and session, so it remains a retry guard after Redis expires. States are `pending`, `created_inactive`, and `reconciliation_required`; the record stores the reviewed draft hash, requirements snapshot, optional workflow ID, and a bounded error message. If deployment returns an error after the remote call begins, the service attempts to persist `reconciliation_required` and retains the Redis lock. If PostgreSQL is unavailable during recovery, the log records that the recovery-state update itself failed and the durable row may remain `pending`.

**Manual reconciliation after a failed deployment:** inspect the n8n UI/API for a workflow matching the reviewed name and request time; compare its nodes and endpoint with the reviewed requirements; inspect both `architect_deployments` and `architect_workflows` for the session and workflow ID; do not simply retry the same session. A unique primary key on `architect_deployments(user_id, session_id)` blocks another reservation even after Redis expires. The reconciliation endpoint verifies an already-recorded workflow directly against n8n before confirming it, including its expected ID and exact deployment name; it does not assume that an old database status means the workflow still exists or remains inactive. A 404 from n8n is reported as an HTTP 409 manual-review conflict without silently changing a previously recorded deployment to success; if a marker match disappears between list and detail lookup, the deployment is marked `reconciliation_required`. Other n8n API failures preserve their HTTP status internally for recovery decisions. The n8n API client refuses redirects so the configured API key is not forwarded to a redirect destination. For uncertain deployments, it scans up to 5,000 n8n workflows using cursor pagination. It adopts a match only when exactly one workflow carries the stable marker derived from the authenticated user and session, the fetched workflow ID and exact expected deployment name match, the workflow is explicitly inactive, and it contains exactly the expected webhook and HTTP Request nodes connected directly to each other. It also checks the webhook's POST method and non-empty path, the HTTP method and endpoint, and that redirect following is disabled. Missing active-state data, unexpected nodes, invalid connections, zero matches, multiple matches, or any content mismatch remain unresolved for manual review. The scan limit and n8n API availability are operational constraints, not proof that a missing match was never created.

## Endpoints

- `GET /health/live`
- `GET /health/ready`
- `POST /api/v1/chat/interview`
- `POST /api/v1/chat/:sessionId/deploy`
- `GET /api/v1/chat/:sessionId/deployment` — read the authenticated user's durable deployment status and next recovery action without exposing internal error details
- `POST /api/v1/chat/:sessionId/reconcile` — checks n8n for a workflow carrying the stable deployment marker and repairs local metadata only when exactly one match exists
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
- The CI Compose smoke test starts the pinned n8n image and verifies service readiness, schema creation, and tenant isolation. The workflow create/reconcile path against the real n8n API still needs a configured API key and dedicated integration coverage; unit tests do not prove the generated workflow executes correctly.
- RAG indexing, embeddings, metadata migrations, and a credential mapping admin UI remain future work.

## Development and tests

Use Node.js 24+: `npm install`, `npm run typecheck`, `npm test`, `npm run build`. GitHub Actions runs these checks for the development branch.
