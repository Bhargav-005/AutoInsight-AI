# Local project storage

Phase 1 creates the shared artifact directory and small integration-test artifacts. Dataset ingestion and model/report generation are not implemented.

Host artifact storage remains under `E:\FSI\storage`. Git ignores everything below this directory except this README. Per the updated storage decision, PostgreSQL and Redis use isolated named volumes in Docker Desktop's existing managed disk.

| Location | Purpose |
| --- | --- |
| `autoinsight_postgres_data` (Docker volume) | Dedicated PostgreSQL 16 data |
| `autoinsight_redis_data` (Docker volume) | Dedicated Redis AOF/persistence data |
| `E:\FSI\storage\artifacts` | Shared API/worker artifact root |

Later artifact categories include uploads, immutable derived versions, trained sklearn models, chart exports, reports and scoped source documents. Use generated identifiers, relative references, checksums and backend-controlled access. The worker mount is `/app/storage/artifacts`; it must never interpret a supplied absolute host path as authorization.

Existing Ollama model storage remains at `D:\OllamaModels` and is not part of this directory. Docker engine image layers are managed by Docker Desktop; do not relocate global Docker storage or touch Verdikt volumes.

Integration tests verify API/worker artifact checksums and PostgreSQL, Redis and artifact persistence across a stop/start of only AutoInsight services. Routine service shutdown preserves data. Any destructive cleanup needs a separately reviewed target and applicable user approval.
