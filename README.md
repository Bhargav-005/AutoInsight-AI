# AutoInsight AI

AutoInsight AI is an explainable, local-first platform for tabular data analysis, supervised machine learning and evidence-backed local research.

**Current delivery: Phase 8 — local knowledge and evidence reports.** Authenticated users can upload private TXT, selectable-text PDF or DOCX references, index them locally, and select them for a verified research run on an owned immutable dataset version. The seven logical LangGraph roles use allowlisted tools; the user approves the exact plan before execution. Deterministic analytics and target comparisons are stored with evidence and citations. Completed investigations can generate owner-scoped, checksum-verified PDF reports. Phases 1–6 remain available, including immutable cleaning, analytics and supervised ML.

Analytics is deterministic over bounded full versions; category and chart outputs are capped and results state their source and method. Profiles mark high-cardinality distinct counts and large-column medians as estimates. Registration requires a display name, valid email and 12–128 character password. No demo credentials are seeded. Phase 9 quality and release verification is in progress; Phase 10 public access remains deferred.

For normal development, start the infrastructure, migrate, and run the API and frontend as below. Open **Get Started** on the landing page. Visual sample controls are disabled by default; an explicit development-only `VITE_ENABLE_VISUAL_SAMPLES=true` enables labeled fixtures **after real sign-in**, solely for UI regression testing. They never establish authentication or bypass API authorization and are excluded from production builds.

## Workspace and repository

- Permanent project root: `E:\FSI`
- Existing Ollama model storage: `D:\OllamaModels`
- GitHub repository: <https://github.com/Bhargav-005/AutoInsight-AI>
- Development environment: Windows 11, VS Code and PowerShell
- Existing branch: `main`; existing remote: `origin`

The existing `verdikt-postgres` container belongs to another project. Its container, credentials, database, volumes and port 5432 must remain untouched.

## Documentation

- [Architecture and boundaries](docs/architecture.md)
- [Implementation phases 0-10](docs/implementation-phases.md)
- [User-reported Phase 0 benchmarks](docs/phase-0-benchmarks.md)
- [Technology decisions](docs/technology-decisions.md)
- [Windows development and configuration](docs/development-windows.md)
- [Checkpoint A scope and verification](docs/checkpoint-a.md)
- [Phase 1 implementation and verification](docs/checkpoint-b.md)
- [Local storage policy](storage/README.md)

The user's master engineering instructions and subsequent approved corrections take precedence over proposed defaults in the four reference PDFs. The owner-provided PDFs are available locally under `docs/references`; they are not application assets.

## Current repository contents

Root configuration: `.gitignore`, `.editorconfig`, `.gitattributes`, `.env.example`.

Application: `backend/` (FastAPI, settings, health checks and Pytest), `frontend/` (React/Vite, Vitest and Playwright), and `scripts/` (PowerShell setup/start commands). Dependencies are locked in `backend/uv.lock` and `frontend/package-lock.json`.

## Local topology

React/Vite and FastAPI run locally. Dedicated PostgreSQL 16/pgvector and Redis containers support a Linux RQ worker through Docker Desktop/WSL2. The API and worker share `E:\FSI\storage\artifacts`. Database and Redis data use named Docker volumes. The worker reaches the existing Windows Ollama API through Docker Desktop's `host.docker.internal` gateway; Ollama continues using `D:\OllamaModels`.

Public access is deferred to Phase 10 after security testing. The public demo will depend on the laptop and local backend being online.

## Safe inspection commands

```powershell
Set-Location -LiteralPath 'E:\FSI'
git status --short --branch
git remote -v
git diff --check
```

## Run locally

Install the locked dependencies once using Python 3.13.5, uv, Node 24.21.0 and npm 11.19.0:

```powershell
Set-Location -LiteralPath 'E:\FSI'
.\scripts\Setup-Dev.ps1
.\scripts\Start-Infrastructure.ps1
.\scripts\Invoke-Migrations.ps1
```

Start the API and frontend in two separate PowerShell terminals:

```powershell
# Terminal 1
Set-Location -LiteralPath 'E:\FSI'
.\scripts\Start-Api.ps1
```

```powershell
# Terminal 2
Set-Location -LiteralPath 'E:\FSI'
.\scripts\Start-Frontend.ps1
```

Open <http://127.0.0.1:5173>. API documentation: <http://127.0.0.1:8000/api/v1/docs>. Stop each foreground process with Ctrl+C, then run `.\scripts\Stop-Infrastructure.ps1` from `E:\FSI`. Stopping services preserves volumes and artifacts. Setup preserves existing secrets and adds missing `APP_DB_PASSWORD` and `AUTH_CSRF_SECRET` values to the ignored `.env`. Migrations provision the restricted `autoinsight_app` database role.

`GET /api/v1/health/live` returns 200 when the API can respond. `GET /api/v1/health/ready` returns 200 only when database/extension/migration checks, authenticated Redis ping and a recent queue-worker heartbeat pass. It returns 503 for failed or disabled dependencies. The frontend separately handles network, timeout and invalid-response errors.

See [Windows development](docs/development-windows.md) for configuration and test commands.

## Development rules

- Keep secrets and runtime data out of Git; never put secrets in `VITE_` variables.
- Preserve raw data and record all computed findings against dataset versions.
- Enforce authentication and ownership in backend services and workers.
- Require approval for persistent cleaning operations.
- Use only allowlisted analytical tools; no generated Python or arbitrary shell/SQL execution.
- Test each phase and report failures and limitations honestly.
- Do not commit, push, advance to Phase 10 or configure public access without the required user approval.

## Phase 6 ML development

Sync new dependencies with `uv sync --locked --project backend`, apply `scripts\Invoke-Migrations.ps1`, then rebuild only the worker: `docker compose --env-file .env -f infra/compose.yaml up -d --build --no-deps worker`. Restart the API after updating code.

Open a ready dataset in ML Studio, choose a raw or cleaned version and explicit target, select the task and features, confirm independent rows, then start training. Status is queued/running/completed/failed, with no estimated progress percentage. Saved results include the exact version, checksum, split fingerprint, seed, configuration and library versions. Preprocessing is fitted only on training rows. Compare only experiments with the same source, target, task and split. Predictions reload a server-generated, owner-scoped, checksum-verified joblib pipeline; external serialized models are never accepted. Prediction history stores outputs but not raw input values.

Limits: 50–50,000 labeled rows (source at most 50,000), at least 30 train/10 test rows, 30 features, 1,000,000 selected feature cells, 100 categorical values per feature, 2–20 classes with at least five examples per class. Dates, free text, grouped and time-series evaluation are unsupported. Constant-only features and invalid targets are rejected. The single one-CPU worker has a 1 GiB memory limit; training attempts time out after at most 600 seconds. At most four ML jobs are admitted globally/two per user; failed runs can retry up to three attempts. Serialized models are capped at 100 MB. Hard-interrupted job status is reconciled on subsequent experiment reads.

Focused checks: `uv run --project backend pytest backend/tests/test_ml.py`, and from `backend`, `uv run pytest tests/test_ml_api.py -m integration`. From `frontend`, run `npm.cmd run test:e2e -- e2e/phase6.spec.ts --project=desktop`, `npm.cmd run typecheck`, `npm.cmd run lint` and `npm.cmd run build`. Integration tests create isolated synthetic users/datasets and leave them in local storage for persistence verification. Comprehensive regression and performance testing remains Phase 9 work.

## Phase 7 local research

The configured model is `qwen3.5:4b-q4_K_M`. `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_REQUEST_TIMEOUT_SECONDS`, `OLLAMA_TEMPERATURE`, `OLLAMA_MAX_OUTPUT_TOKENS`, `LLM_CONTEXT_TOKENS` and `LLM_THINKING` configure local inference. Planning uses JSON-schema responses and bounded schema/profile metadata, never dataset cell samples; one invalid plan gets one bounded correction attempt. One local inference lock is shared by API and worker through the dedicated Redis instance. A plan may be revised once; approval is bound to the exact validated plan hash and dataset version. Research executes one step at a time with a maximum of 12 steps. Cancellation is honored at step boundaries, and interrupted jobs fail visibly.

Roles: Data Understanding, Data Cleaning, Data Analysis, ML Engineer, Research & Verification, RAG Knowledge and Report & Insights. Phase 7 has no document retrieval: the knowledge role states that this capability starts in Phase 8. ML tools inspect saved completed runs only; research does not start training or apply cleaning operations.

The read-only registry provides `get_dataset_profile`, `get_column_information`, `get_missing_value_summary`, `get_cleaning_suggestions`, `run_descriptive_summary`, `run_grouped_aggregate`, `run_correlation`, `get_category_distribution`, `get_completed_ml_runs`, `get_ml_evaluation`, `get_feature_importance`, `verify_evidence`, `assess_knowledge_need` and `synthesize_evidence`. It does not provide Python, SQL, shell, arbitrary HTTP, mutation or training tools.

Run focused verification from PowerShell:

```powershell
Set-Location -LiteralPath 'E:\FSI\backend'
uv run ruff check app worker migrations tests/test_research.py tests/test_research_api.py
uv run pytest tests/test_research.py -q
uv run pytest tests/test_research_api.py -m integration -q
uv run alembic check
```

```powershell
Set-Location -LiteralPath 'E:\FSI\frontend'
npm.cmd run test:e2e -- e2e/phase7.spec.ts --project=desktop
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```
