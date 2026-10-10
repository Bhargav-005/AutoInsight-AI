# Architecture

Status: Phase 1 implements local frontend/API scaffolds, isolated infrastructure, migrations and shared artifact storage. Authentication and domain workflows below remain planned for later phases.

## Authority and workspace

Functionality is grounded in `AutoInsight_AI_PRD.pdf`, `AutoInsight_AI_TRD.pdf`, `AutoInsight_AI_Database_Schema.pdf`, and `AutoInsight_AI_Implementation_Phases.pdf`. The user's master instructions and subsequent corrections override earlier proposals, including phase numbering, hybrid deployment and workspace location.

All project source, configuration, scripts and local project data belong under `E:\FSI`. Existing Ollama models remain at `D:\OllamaModels`. The original PDF files and model files are not copied into the repository.

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

Ownership must hold across parent/child links as well as endpoints. All schema changes use Alembic. The Phase 1 migration scope is setup and required extensions, not domain tables. Destructive migrations require explicit warning and approval.

## Interfaces and APIs

Preserve `/login`, `/register`, `/dashboard`, `/datasets/:id`, `/datasets/:id/clean`, `/research/:id`, `/analysis/:id`, `/models/:id`, and `/history`.

Preserve the TRD's `/api/v1` contract with typed schemas, consistent error envelopes and OpenAPI. Long-running calls return HTTP 202 with a run/job identifier. Add missing lifecycle, history, job, session, analytics and document endpoints in the relevant phases. Finalize workspace ID semantics before UI implementation.

## Hybrid demonstration

Phase 10 publishes a static frontend and exposes only the local API through an HTTPS outbound tunnel or protected gateway. Authentication, strict CORS, applicable CSRF protection, rate limits and request limits are mandatory. Database, Redis, Ollama and artifact storage remain private. Public features show a disconnected state when the laptop/backend is unavailable; there is no independent 24/7 availability promise.

A separately runnable local frontend supports the offline final demonstration. No tunnel or hosting configuration belongs to Phase 1.
