# Phase 1 implementation and verification

## Scope

Continued the existing Checkpoint B scaffolds through the user's authorized full Phase 1 scope: minimal React/TypeScript/Vite status interface, FastAPI with measured liveness/readiness, validated configuration, CORS, lockfiles, dedicated PostgreSQL/pgvector and Redis, Linux RQ worker, shared artifacts, extension migrations, tests and PowerShell scripts. Authentication, dashboards, ingestion, ML, agents and RAG remain unimplemented. The existing filename is retained to preserve documentation links.

## Git inspection discrepancy

The user reported Checkpoint A committed and pushed. The actual local inspection showed an unborn `main` branch (no commits) and twelve staged Checkpoint A files. The implementation preserved that index and the original `origin` URL. It did not fetch, reset, stage, commit or push. Changes to previously staged documentation remain unstaged over the existing staged versions; new scaffold files are untracked until reviewed and staged by the user.

## Dependency versions

| Component | Installed version |
| --- | --- |
| Python / uv | 3.13.5 / 0.10.9 |
| FastAPI / Starlette | 0.143.0 / 1.7.0 |
| Pydantic / pydantic-core / pydantic-settings | 2.14.0 / 2.50.0 / 2.15.0 |
| Uvicorn | 0.54.0 |
| SQLAlchemy / Alembic / psycopg | 2.1.4 / 1.20.0 / 3.3.6 |
| Redis Python / RQ | 7.4.1 / 2.12.0 |
| Linux worker Python | 3.13.16 |
| Pytest / HTTPX / Ruff | 9.1.1 / 0.28.1 / 0.17.0 |
| Node / npm | 24.21.0 / 11.19.0 |
| React / React DOM | 19.3.0 / 19.3.0 |
| TypeScript / Vite / React Vite plugin | 6.0.3 / 8.3.4 / 6.1.2 |
| Vitest / jsdom | 5.0.3 / 30.1.2 |
| Testing Library React / jest-dom | 16.3.3 / 7.0.1 |
| Playwright | 1.64.0 |

The lockfiles capture all transitive dependencies and hashes. Backend version ranges permit resolution within intended major versions, while `uv sync --locked` prevents an unreviewed lockfile update. Frontend direct dependencies are exact, with clean installation through `npm ci`.

No Python 3.13 compatibility issue was encountered in Phase 1: compiled Pydantic and psycopg wheels installed, backend tests execute on Windows 3.13.5, and real worker jobs execute on Linux 3.13.16. This is not evidence for future ML/RAG packages. Standard RQ workers require the Linux container for fork-based execution.

## Health behavior

Liveness returns HTTP 200 as proof of API response. Readiness returns 200 only after database connection, extensions, migration revision, authenticated Redis ping and recent queue-worker heartbeat checks pass. It returns 503 with unhealthy dependencies during an outage, or `not_configured` when infrastructure is disabled. Redis connection retries are disabled so hidden backoff does not delay readiness failure; the real all-services outage returned 503 in approximately four seconds. RQ job retries remain explicit and bounded. The UI distinguishes API connectivity from platform readiness.

## Verification record

Verified on 2026-10-10 after resuming the interrupted implementation:

| Check | Result |
| --- | --- |
| Backend unit suite | 32 passed; one Windows symlink test skipped for OS privilege |
| Backend integration suite | 8 passed |
| Worker behavior | Echo, shared checksum artifact, permanent failure with bounded retry, one-second timeout, transient retry recovery passed |
| Persistence | Existing PostgreSQL cluster identity/migration state, Redis marker and host artifact survived AutoInsight service stop/start; worker processed persisted artifact afterward |
| Live outage | Liveness 200, readiness 503 with actual dependency failures; readiness 200 after recovery |
| Linux artifact safety | Symlink escape rejected inside actual worker container |
| Backend quality | Ruff lint and formatting passed on 30 files |
| Frontend | 6 component tests, ESLint, TypeScript and production build passed |
| Playwright Chromium | 2 desktop/mobile cases passed with disabled infrastructure; 2 passed against actual services; includes keyboard access, no horizontal overflow, disconnection and recovery |
| Visual review | Desktop and mobile screenshots inspected; readable status details, visible focus and no clipped controls |
| Dependencies/configuration | Locked Python synchronization, npm clean install, Compose configuration and PowerShell syntax checks passed |
| Git | Ignore checks passed; existing index and origin preserved; no staging, commit or push |

Docker resources are confined to Compose project `autoinsight`, network `autoinsight_services`, volumes `autoinsight_postgres_data` and `autoinsight_redis_data`, and the artifact bind mount `E:\FSI\storage\artifacts`. PostgreSQL publishes only `127.0.0.1:5433`, Redis only `127.0.0.1:6380`, and the worker publishes no ports. All three were healthy at verification. Verdikt retained its existing container ID, independent network and volume; its services and data were not modified.

## Errors and limitations encountered

- Initial registry and browser downloads failed on sandbox DNS; approved network retries succeeded.
- An inspection command incorrectly piped Git index entries to `Get-FileHash`; a direct `.git/index` hash was taken instead. No files changed in that failed command.
- One `npm ci` verification was launched at the repository root; it correctly rejected the missing root lockfile. Rerunning in `frontend` succeeded.
- The first sandboxed backend test run hit a temporary-directory error and stalled in TestClient. It was interrupted; the full suite passed outside the sandbox using a project-local temporary directory.
- Ruff found a validation-expression style issue and one formatting difference; both were corrected.
- Playwright initially could not launch a forward-slash relative executable path through Windows command handling. Its server configuration now uses quoted absolute executable/application paths.
- Starlette emits a non-fatal deprecation warning for its HTTPX-backed TestClient, recommending HTTPX2. This warning is not hidden; the installed HTTPX path passes all current tests.
- TypeScript 7 was outside TypeScript-ESLint's supported peer range; TypeScript 6.0.3 is locked and all frontend checks pass.
- The initial internal Docker network prevented expected localhost publishing on this Docker Desktop installation; services now use a dedicated bridge with loopback-only published ports. The unused old network was left intact.
- RQ worker identity and sanitized failure handling were corrected before final verification; real failure, timeout and retry checks pass.
- Docker Desktop was unavailable at resume. The user started the engine; no proposed machine-wide runtime repair or reset was performed.
- The new persistence test initially used unsupported `docker compose start --wait` flags. It now uses `up --no-build --no-recreate --detach --wait` to restart existing services without replacing containers. The corrected test passed.
- The initial outage probe took 18.5 seconds because Redis retried internally. Disabling connection retries reduced the measured failure response to about four seconds; the integration test enforces a six-second ceiling.

Phase 1 acceptance: passed for the local development foundation. No final test failures remain. Windows symlink creation was not enabled; equivalent rejection was verified on Linux. Firefox/WebKit, hosted CI, production deployment, sustained load, and later-phase security/ML/agent evaluations were not run. No application services are configured for public use. Containers remain running; browser-test API/frontend processes stop when tests finish. Stop here before Phase 2. Git commits and pushes require user approval.
