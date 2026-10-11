# AutoInsight AI

AutoInsight AI is an explainable, local-first platform for tabular data analysis and supervised machine learning. The planned workflow connects dataset profiling, approved cleaning, deterministic analytics, controlled ML experiments, evidence-backed AI research and downloadable reports.

**Current delivery: Phase 2 - frontend interfaces.** The responsive shell includes authentication forms, dashboard, datasets, Cleaning Studio, seven-role research workspace, analytics, ML Studio, and reports/history. The original measured API status is preserved at `/status`. Authentication and data execution remain in later backend phases; all workspace screens explicitly identify themselves as frontend previews.

For frontend-only exploration, run `npm.cmd ci` and `npm.cmd run dev` in `E:\FSI\frontend`, open <http://127.0.0.1:5173>, and select **Open frontend preview**. **Explore sample workspace** loads labeled synthetic fixtures in development only. Samples are excluded from production bundles; no credentials, uploads or jobs are submitted by preview controls. Run `npm.cmd run test:e2e` for desktop/mobile journeys and the 320/375/768/1024/1440-pixel viewport checks. Chromium must be installed as described in the Windows development guide.

Phase 2 verification (2026-10-11): TypeScript, ESLint, 31 component tests and the production build passed. Playwright passed 13 cases; one duplicate mobile viewport-matrix case is intentionally skipped because the full matrix runs in the desktop project. Automated accessibility checks found no violations on the tested core pages. Desktop, tablet and mobile screenshots were visually reviewed. Chromium was tested; broader browser and manual screen-reader testing remain future verification work.

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

The user's master engineering instructions and subsequent approved corrections take precedence over proposed defaults in the four reference PDFs. The PDFs are referenced in the documentation; they have not been copied into the repository.

## Current repository contents

Root configuration: `.gitignore`, `.editorconfig`, `.gitattributes`, `.env.example`.

Application: `backend/` (FastAPI, settings, health checks and Pytest), `frontend/` (React/Vite, Vitest and Playwright), and `scripts/` (PowerShell setup/start commands). Dependencies are locked in `backend/uv.lock` and `frontend/package-lock.json`.

## Local topology

React/Vite and FastAPI run locally. Dedicated PostgreSQL 16/pgvector and Redis containers support a Linux RQ worker through Docker Desktop/WSL2. The API and worker share `E:\FSI\storage\artifacts`. Database and Redis data use named Docker volumes. Later phases introduce deterministic data/ML tools, LangGraph and the existing local Ollama model.

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

Open <http://127.0.0.1:5173>. API documentation: <http://127.0.0.1:8000/api/v1/docs>. Stop each foreground process with Ctrl+C, then run `.\scripts\Stop-Infrastructure.ps1` from `E:\FSI`. Stopping services preserves volumes and artifacts. Setup preserves an existing `.env`; on first setup it creates independent local secrets.

`GET /api/v1/health/live` returns 200 when the API can respond. `GET /api/v1/health/ready` returns 200 only when database/extension/migration checks, authenticated Redis ping and a recent queue-worker heartbeat pass. It returns 503 for failed or disabled dependencies. The frontend separately handles network, timeout and invalid-response errors.

See [Windows development](docs/development-windows.md) for configuration and test commands.

## Development rules

- Keep secrets and runtime data out of Git; never put secrets in `VITE_` variables.
- Preserve raw data and record all computed findings against dataset versions.
- Enforce authentication and ownership in backend services and workers.
- Require approval for persistent cleaning operations.
- Use only allowlisted analytical tools; no generated Python or arbitrary shell/SQL execution.
- Test each phase and report failures and limitations honestly.
- Do not commit, push, advance to Phase 3 or configure public access without the required user approval.
