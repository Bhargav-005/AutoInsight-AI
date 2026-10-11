# Architecture

Status: Phase 5 adds allowlisted cleaning plans, immutable cleaned versions, server-side previews, retry-safe RQ execution, version comparison and deterministic owner-scoped analytics. Phase 4 upload/profiling, Phase 3 authentication and the approved frontend/landing page are preserved. ML, agents, RAG and reporting remain later work.

## Authority and workspace

Functionality is grounded in `AutoInsight_AI_PRD.pdf`, `AutoInsight_AI_TRD.pdf`, `AutoInsight_AI_Database_Schema.pdf`, and `AutoInsight_AI_Implementation_Phases.pdf`. The user's master instructions and subsequent corrections override earlier proposals, including phase numbering, hybrid deployment and workspace location.

All project source, configuration, scripts and local project data belong under `E:\FSI`. Existing Ollama models remain at `D:\OllamaModels`. The owner has placed reference PDFs in `docs/references`; model files remain external.

## Modular monolith with background processing

```text
Browser -> React frontend -> FastAPI
                              |-- PostgreSQL 16 + pgvector
                              |-- local artifact storage
                              `-- Redis -> RQ worker
                                             `-- LangGraph coordination
                                                   |-- deterministic tools
                                                   `-- shared Ollama model
```

FastAPI is the authority for authentication, resource ownership, approved operations and artifact access. Workers recheck authorization and resource state before execution. Long operations are queued and report truthful progress and failures.

PostgreSQL stores relational metadata and evidence provenance. Files live in artifact storage with generated identifiers, checksums and safe relative references. Redis transports queued work; later application job records provide durable history and idempotency.

## Development infrastructure

Compose project: `autoinsight`, with independent network, credentials and services. PostgreSQL uses `pgvector/pgvector:pg16`, Redis uses `redis:7.4-alpine`, and the worker uses Python 3.13 on Linux. Base images are pinned by digest in `infra/compose.yaml` and `infra/worker.Dockerfile`; Python packages are installed from the frozen lockfile.

| Component | Host endpoint | Container endpoint / data |
| --- | --- | --- |
| Frontend | `127.0.0.1:5173` | Runs on Windows |
| FastAPI | `127.0.0.1:8000` | Runs on Windows |
| PostgreSQL | `127.0.0.1:5433`, if available | `postgres:5432`; `autoinsight_postgres_data` -> `/var/lib/postgresql/data` |
| Redis | `127.0.0.1:6380`, if available | `redis:6379`; `autoinsight_redis_data` -> `/data` |
| RQ worker | No published port | Linux container; shared artifact mount |
| Ollama | `127.0.0.1:11434` | Existing host service, connected in a later phase |

The user's updated storage decision uses persistent Docker named volumes for PostgreSQL and Redis. These live in Docker Desktop's existing managed disk, outside the repository; source and host artifacts remain under `E:\FSI`. Do not move Docker Desktop's global disk or other projects' data. Services use the dedicated `autoinsight_services` bridge; only database and Redis ports are published, on localhost. The earlier unused `autoinsight_private` network may remain and is not needed by the current stack.

The worker uses service DNS and internal ports. It shares only `E:\FSI\storage\artifacts`, mounted at `/app/storage/artifacts`. Generated relative references resolve independently beneath each process's configured root, with checksums, traversal and symlink rejection. The Docker socket and database directories are not mounted into the worker. RQ uses JSON serialization, a configurable timeout, bounded per-job retry policies and sanitized failure categories. Readiness checks database extensions and migration revision, authenticated Redis ping and a recent worker heartbeat; liveness does not depend on those services.

The existing `verdikt-postgres` container on port 5432 is outside this project. Never inspect its private records, reuse its credentials, attach its volumes or modify its configuration as part of this project.

## Seven specialist roles

1. Data Understanding Agent
2. Data Cleaning Agent
3. Data Analysis Agent
4. ML Engineer Agent
5. Research & Verification Agent
6. RAG Knowledge Agent
7. Report & Insights Agent

LangGraph is coordination infrastructure, not an eighth role. All roles share one Ollama model through a controlled adapter. Each role will have typed input/output contracts, an allowlisted tool set, decision boundaries, approval rules, error handling and evidence requirements.

Initial limits: one LLM request and one ML training job at a time; 4096-token context; thinking disabled for simple routing; 12 tool steps; at most one replan; configurable job timeout initially 900 seconds. Upload defaults are 25,000,000 bytes, 100,000 rows and 100 columns. These are proposed engineering limits, not demonstrated throughput.

## Data, ML and evidence boundaries

Raw uploads remain immutable. Approved cleaning produces a new version linked to its parent, plan, approval and artifact. Reject unsupported inputs instead of silently sampling. Dataset cells, filenames, prompts and retrieved text are untrusted data.

Statistics and charts come from validated computations. Each numerical finding links to a dataset version and evidence record. ML splits precede fitted preprocessing; pipelines include dummy baselines and actual held-out metrics. Cleaning provenance must prevent full-dataset fitted transforms from contaminating evaluation. External serialized models are never automatically loaded.

RAG provides methodology and data definitions, not numerical computation. Scope documents before retrieval. Reports distinguish observations, model metrics, LLM interpretation, retrieved references and limitations.

## Relational contract and planned amendments

Preserve: `users`, `datasets`, `dataset_versions`, `dataset_profiles`, `cleaning_plans`, `research_runs`, `agent_steps`, `evidence_items`, `ml_runs`, `model_metrics`, `predictions`, `reports`, `stored_artifacts`, `dataset_documents`, `document_chunks`, `audit_events`.

Before their implementation, specify durable `jobs`, lifecycle constraints, explicit cleaning-plan lineage, evidence outside research runs, report source manifests, candidate experiment grouping, curated/private document visibility and ordered deletion. Each fitted estimator has its own ML run and shares an experiment/split identifier with its comparison group. Chart evidence and stored artifacts suffice initially; a separate chart table is not required.

Ownership must hold across parent/child links as well as endpoints. All schema changes use Alembic. The immutable Phase 1 extension migration is followed by `0002_domain_auth`, adding the 16 reference tables and `sessions`. Destructive migrations require explicit warning and approval.

## Interfaces and APIs

Preserve `/login`, `/register`, `/dashboard`, `/datasets/:id`, `/datasets/:id/clean`, `/research/:id`, `/analysis/:id`, `/models/:id`, and `/history`.

Preserve the TRD's `/api/v1` contract with typed schemas, consistent error envelopes and OpenAPI. Long-running calls return HTTP 202 with a run/job identifier. Add missing lifecycle, history, job, session, analytics and document endpoints in the relevant phases. Finalize workspace ID semantics before UI implementation.

## Hybrid demonstration

Phase 10 publishes a static frontend and exposes only the local API through an HTTPS outbound tunnel or protected gateway. Authentication, strict CORS, applicable CSRF protection, rate limits and request limits are mandatory. Database, Redis, Ollama and artifact storage remain private. Public features show a disconnected state when the laptop/backend is unavailable; there is no independent 24/7 availability promise.

A separately runnable local frontend supports the offline final demonstration. No tunnel or hosting configuration belongs to Phase 1.

## Phase 3 authentication and schema decisions

The current user instructions replace the PDFs' older JWT proposal with opaque cookie sessions. Argon2id uses 64 MiB, three passes and four lanes (argon2-cffi). Passwords are validated at 12–128 Unicode characters without truncation. Session tokens contain 256 random bits; only SHA-256 hashes are stored in PostgreSQL. Sessions expire after 24 hours (configurable to 1–168 hours), are checked on every protected request, and are revoked on logout or session replacement. The browser stores no bearer tokens in localStorage/sessionStorage.

Cookies are HttpOnly, host-only, SameSite=Lax and scoped to `/api/v1`. `APP_ENV=production` requires HTTPS origins and uses Secure-prefixed Secure cookies; local development uses HTTP loopback cookies. Vite proxies same-origin `/api/v1` calls to the loopback API. Deployment, HTTPS termination and remote origins remain Phase 10 work; do not expose this development server publicly.

All authentication POSTs require JSON, an exact allowed Origin and a CSRF proof derived with HMAC-SHA256 from an HttpOnly random seed and the current session. GET `/auth/csrf` returns only the proof, never session secrets. Auth request bodies are capped at 8 KiB, including chunked bodies. Redis atomically limits registration by client IP (5/minute), and login by IP and normalized-email hash (10/minute); only dedicated expiring `autoinsight:auth:*` keys are used. Forwarding headers are ignored by the local startup command. Authentication fails closed when required storage is unavailable. API responses are not cached; audit rows record registration/login/failure/logout/revocation without passwords, tokens or submitted email addresses.

The API connects as `autoinsight_app`, not the PostgreSQL owner. It has SELECT access, INSERT/UPDATE on users/sessions and INSERT-only audit permission; no DDL or future-domain write permission. Alembic and local test fixtures use the migration account. PostgreSQL RLS is not enabled: application ownership predicates are mandatory, with composite foreign keys additionally rejecting cross-owner domain links.

Schema additions beyond the PDF are display name/account-active fields, sessions, and owner keys used by composite constraints. Parent versions must belong to the same dataset; artifacts and cleaning-plan outputs must belong to the same owner. Cleaning plan lifecycle, attempt count, result version and sanitized error state are persisted. Restricted cross-links require ordered deletion in a future file-cleanup workflow; no account/data deletion API exists. Document chunks retain a dimensionless pgvector column constrained to NULL until Phase 8 selects an embedding model and migrates its exact dimension. ML grouping and evidence outside research runs remain future decisions.

Public routes are `/`, `/login`, `/register` and `/status`; workspace routes require a validated session. The frontend restores sessions on entry/reload, rechecks on focus and every minute, and clears private state on a protected 401 or logout (also notifying other tabs). An unavailable API never becomes an authenticated or empty-account state. Registration creates a session and opens the intended internal workspace destination. Duplicate registration returns 409 as requested; login failures are generic. No email verification, password recovery, administrator interface or seeded credentials are provided.

API additions: POST `/api/v1/auth/register`, `/auth/login`, `/auth/logout`; GET `/api/v1/auth/csrf`, `/auth/me` and `/dashboard/overview`. Phase 4 adds authenticated dataset upload/list/status/version/profile/preview and profile retry. Phase 5 adds profile-derived cleaning suggestions, cleaning plan create/get/preview/approve/retry, version comparison, analytics summary, grouped aggregation, correlation and chart data. State-changing requests use the existing session and CSRF proof. Every resource lookup is owner-scoped. `/health/live` and `/health/ready` retain their Phase 1 contracts; readiness requires the current migration revision.

## Phase 4 dataset ingestion and profiling

Uploads are streamed to a temporary file under the configured artifact root with a hard 25,000,000-byte cap. The server validates the extension, CSV UTF-8/header structure or XLSX ZIP structure, limits workbook expansion, rejects formulas, and uses generated UUID artifact names. It finalizes a new artifact path without overwriting an existing object, records SHA-256 metadata and a raw version 1, then queues profiling. CSV parsing is chunked; XLSX uses openpyxl read-only mode. A multi-sheet workbook requires an explicit visible sheet choice and sheets are never merged. The worker has one CPU, a 512 MB container limit and a 180-second profile job timeout; datasets are capped at 100,000 rows and 100 columns.

Profiles count rows, missing cells and exact duplicate rows; infer whole-column types; retain up to five representative values; and calculate finite numeric min/max/mean and median. Distinct counts are exact through 2,048 values per column and use a labeled HyperLogLog estimate above that bound. Numeric medians use a deterministic 8,192-value reservoir above that bound and are labeled approximate. These bounded estimates are described in the persisted profile. Source artifacts remain unchanged; no download, deletion or export route exists yet. Application storage references stay server-side, and the worker rechecks the saved checksum before profiling.

## Phase 5 cleaning and analytics

Cleaning uses an explicit allowlist: remove duplicate rows, drop rows with missing selected values, fill missing values by constant/mode/mean/median, trim whitespace, replace text and cast to numeric with error or coercion behavior. Preview calculates before/after samples and exact quality counts without persisting a derived version. Apply requires explicit approval, runs in RQ, rechecks ownership and source checksum, and creates a new CSV artifact, checksum, child version and profile in one transaction. Failed jobs create no completed version; retries use a new attempt ID and completed plans cannot be re-enqueued.

Analytics runs directly over the selected owner version without generated SQL. It reports exact full-version row, null, distinct and numeric statistics, grouped count/sum/mean/min/max/median, Pearson correlations and bounded bar/line/scatter/histogram/category data. High-cardinality categories, group results, chart points and correlation columns are capped with warnings. Numeric overflow and insufficient correlation data are reported rather than serialized as invalid values. Profiles may use labeled estimates at larger thresholds; analytics uses the full bounded dataset version.
