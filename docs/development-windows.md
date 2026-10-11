# Windows development and configuration

## Current phase

Phase 5 includes real account sessions, CSV/XLSX upload and profiling, approved immutable cleaning jobs, and deterministic analytics, alongside the existing frontend, infrastructure and worker. ML, agents, RAG and reports are not implemented. Start Docker Desktop before infrastructure commands.

Use Windows 11, VS Code and PowerShell with `E:\FSI` as the permanent workspace. Ollama model storage stays at `D:\OllamaModels`; no project setup step may relocate it.

## Start and stop

```powershell
Set-Location -LiteralPath 'E:\FSI'
.\scripts\Check-Prerequisites.ps1
.\scripts\Setup-Dev.ps1
.\scripts\Start-Infrastructure.ps1
.\scripts\Invoke-Migrations.ps1
```

Run `.\scripts\Start-Api.ps1` and `.\scripts\Start-Frontend.ps1` from `E:\FSI` in separate terminals. Open <http://127.0.0.1:5173>; API docs are at <http://127.0.0.1:8000/api/v1/docs>. Stop those foreground processes with Ctrl+C, then run `.\scripts\Stop-Infrastructure.ps1`. No stop command removes data or touches Verdikt.

Setup uses locked Python dependencies and `npm ci`. It preserves existing settings and appends only missing project-local security secrets. `Invoke-Migrations.ps1` applies forward migrations and provisions the restricted application database role. The API startup script does not auto-reload Python changes; restart it after edits. Vite reloads frontend edits.

## Tests

Use focused Phase 5 checks during development before running broader regression suites:

```powershell
Set-Location -LiteralPath 'E:\FSI\backend'
uv run pytest -q tests/test_profiling.py tests/test_storage.py
uv run pytest -m integration -q tests/test_dataset_api.py
uv run pytest -q tests/test_phase5_services.py
uv run pytest -m integration -q tests/test_phase5_api.py
Set-Location -LiteralPath 'E:\FSI\frontend'
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test -- --run
npm.cmd run test:e2e -- --project=desktop --grep "genuine uploaded dataset"
```

```powershell
Set-Location -LiteralPath 'E:\FSI'
.\scripts\Test-Phase1.ps1 -Integration -Browser
```

Integration tests intentionally stop and restart only AutoInsight containers to verify persistence and 503 outage behavior. They preserve all existing data, retain small generated artifact samples, and give the Redis persistence marker a ten-minute expiry. Run them when no other AutoInsight work is in progress.

Playwright needs its local Chromium download once:

```powershell
Set-Location -LiteralPath 'E:\FSI\frontend'
$env:PLAYWRIGHT_BROWSERS_PATH = 'E:\FSI\.cache\ms-playwright'
.\node_modules\.bin\playwright.cmd install chromium
npm.cmd run test:e2e
```

Browser tests start their own API/frontend on ports 8011/5175 and stop them afterward. The suite now requires migrated AutoInsight PostgreSQL, Redis and the worker, and exercises real registration and sessions. Backend unit tests still cover disabled infrastructure. Browser tests use uniquely named `phase3-e2e-*` synthetic accounts and two synthetic metadata rows per run; these test records are retained, never mixed with actual user records. Run browser tests after the infrastructure suite finishes: its persistence test temporarily restarts the services. Screenshots go to ignored `frontend/test-results`.

## Safe current commands

```powershell
Set-Location -LiteralPath 'E:\FSI'
git status --short --branch
git branch --show-current
git remote -v
git diff --check
git check-ignore -v -- .env backend/.venv/pyvenv.cfg frontend/node_modules/example/index.js storage/postgres/PG_VERSION storage/artifacts/example.csv
git check-attr text eol -- README.md .env.example scripts/example.ps1
```

`git diff --check` checks tracked changes; it does not validate untracked file contents. The Checkpoint A verification also checks all new text files directly. `git log` will report no commits until the user makes or authorizes the first commit.

## Configuration contract

`.env.example` is a sanitized template. Setup creates `E:\FSI\.env` without overwriting existing values, enables infrastructure, and generates independent secrets. With infrastructure enabled, secrets and the dedicated database/user are validated. Without infrastructure enabled, readiness explicitly reports `not_configured`.

| Group | Meaning |
| --- | --- |
| `PROJECT_ROOT`, `FILE_STORAGE_ROOT` | Windows workspace and shared artifact directory |
| `WORKER_FILE_STORAGE_ROOT` | Container-local path for the same artifact directory |
| `API_*`, `FRONTEND_*` | Localhost-only development bindings |
| `API_PROXY_TARGET` | Vite loopback proxy target; defaults to `http://127.0.0.1:8000`. Browser URLs remain `/api/v1`; old `VITE_API_BASE_URL` values are unused. |
| `APP_DB_PASSWORD`, `AUTH_CSRF_SECRET`, `SESSION_HOURS` | Restricted runtime DB password, persistent CSRF signing key and session lifetime |
| `VITE_ENABLE_VISUAL_SAMPLES` | Optional development-only fixtures after real login; unset/false by default |
| `CORS_ORIGINS` | Exact local frontend origins; no wildcard with credentials |
| `COMPOSE_PROJECT_NAME` | Independent `autoinsight` project |
| `POSTGRES_*`, `REDIS_*` | Dedicated infrastructure endpoints and credentials |
| `DATABASE_URL`, `REDIS_URL` | Future host process URLs |
| `WORKER_DATABASE_URL`, `WORKER_REDIS_URL` | Future service-DNS URLs for the Linux worker |
| `RQ_*` | Project queue and JSON serialization contract |
| `OLLAMA_*` | Existing model/service details; model-directory value is documentary unless explicitly configured on the server |
| `LLM_*`, `MAX_*` | Later-phase resource limits, except `MAX_JOB_SECONDS`, which sets the Phase 1 queue timeout |
| `RAG_EMBEDDING_MODEL` | Reserved for Phase 8, intentionally blank |

The backend constructs an escaped SQLAlchemy URL and authenticated Redis connection from component settings. The legacy URL keys in the template remain reserved and are not consumed. Containers use `postgres:5432` and `redis:6379`; Windows uses the selected localhost host ports. No secret may appear in frontend build variables or logs. The API uses the restricted `autoinsight_app` role; migrations retain the dedicated AutoInsight owner account. Authentication rate limits are 5 registration and 10 login attempts per minute by default. Browser tests use an isolated key namespace and higher test-only limits.

The upload limit is defined in bytes: 25,000,000 (25 decimal MB). Profiling jobs have a 180-second timeout and run in the worker's 1 GiB, one-CPU container (shared with bounded Phase 6 ML jobs). Row and column caps are 100,000 and 100. The initial general job timeout of 900 seconds is a configurable engineering default, not a benchmark result.

## Git and line endings

Keep the existing `.git`, `main` branch and `origin` URL. Do not run `git init`, replace remotes or change global Git settings. `.gitattributes` normalizes text to LF and Windows batch files to CRLF; PowerShell files use LF. `.editorconfig` specifies UTF-8, final newlines, space indentation and whitespace policy.

The ignore policy blocks secrets, local configuration, dependency directories, runtime storage, tabular datasets, trained models and generated reports. Uploaded source artifacts and synthetic integration records remain in local storage/DB for persistence verification; test accounts use unique `phase4-*` emails. Templates and future lockfiles remain trackable. If a future synthetic test fixture needs an exception, add a narrow reviewed exception; do not force-add real data or secrets. Ignore rules do not remove files already tracked, so review staged changes before every commit.

## Infrastructure boundaries

The start script checks port conflicts and uses a dedicated `autoinsight` Compose project and bridge network. Only PostgreSQL 5433 and Redis 6380 are published, bound to `127.0.0.1`. Worker has no published ports. Named volumes `autoinsight_postgres_data` and `autoinsight_redis_data` live inside Docker Desktop's existing disk. Artifacts remain under `E:\FSI\storage\artifacts`. Do not change Verdikt or global Docker storage to resolve an AutoInsight setup failure.

PowerShell scripts resolve paths relative to their own location, check command exit codes, use `npm.cmd` and avoid machine-wide execution-policy changes. If local policy disallows scripts, use `uv sync --locked --project backend`, `npm.cmd ci` inside `frontend`, the explicit Compose command from `infra/compose.yaml`, and `python -m app` inside the backend virtual environment; do not weaken machine policy automatically.
