# Technology decisions

These decisions record the approved stack. Dependencies for Phases 1–7 are installed and locked; later-phase packages remain planned.

| Concern | Decision | Delivery boundary |
| --- | --- | --- |
| Architecture | Modular monolith and dedicated background worker | Foundation in Phase 1 |
| Frontend | React, TypeScript, Vite | Minimal scaffold in Phase 1 |
| UI | Tailwind CSS, shadcn/ui, React Router; Recharts; TanStack Table where needed | Phase 2 onward |
| Backend | Python, FastAPI, Pydantic | Minimal scaffold in Phase 1 |
| Persistence | PostgreSQL 16, pgvector, SQLAlchemy 2, Alembic; UUID identifiers | Infrastructure in Phase 1; domain schema from Phase 3 |
| Jobs | Redis and Linux RQ worker through Docker Desktop/WSL2; JSON serialization | Connectivity in Phase 1 |
| Data | Pandas, NumPy, DuckDB with allowlisted operations | Phases 4-5 |
| ML | scikit-learn Pipeline/ColumnTransformer; supervised classification/regression | Phase 6 |
| Local LLM | Existing Ollama; `qwen3.5:4b-q4_K_M`; JSON-schema plans; one shared inference lock | Owner benchmark and real local structured-plan test passed in Phase 7 |
| Orchestration | Typed LangGraph planning/execution graphs; seven logical roles; shared model | Implemented in Phase 7; API/worker share PostgreSQL, Redis and artifacts |
| RAG | sentence-transformers and owner-scoped pgvector retrieval | Phase 8 |
| Reports | ReportLab and CSV exports; static chart rendering selected when needed | Phase 8 |
| Tests | Pytest, Vitest, Playwright; security and agent evaluations | Infrastructure in Phase 1; features tested as delivered |
| Public demo | Static frontend and protected HTTPS route to local API | Phase 10 only |

## Runtime and dependency strategy

Earlier read-only environment inspection observed Python 3.13.5, Node 24.21.0, npm 11.19.0, Git 2.49.0.windows.1, Docker 29.1.3, Compose 2.40.3 and Ollama client 0.40.2. These are observed environment versions, not dependency pins or fresh Checkpoint A compatibility tests.

Phase 1 successfully installed and tested API dependencies on Windows Python 3.13.5, including compiled Pydantic and psycopg wheels. `.python-version` records 3.13.5; the pinned Linux worker image runs Python 3.13.16. RQ runs on Linux because its standard worker forks job processes. No Python downgrade was needed. Future scientific/ML packages are not verified; test them in their own phases. Do not replace global tooling automatically.

Use `uv.lock` for Python and `package-lock.json` for npm. Locked Python synchronization and an offline npm clean install were verified. Package manifests and lockfiles are ready for review but are not committed automatically. PostgreSQL, Redis and the worker base image are pinned by digest. Exact installed versions are recorded in [the Phase 1 verification record](checkpoint-b.md). TypeScript 6.0.3 satisfies the installed TypeScript-ESLint peer range (below 6.1); the initial TypeScript 7 selection was corrected without forcing incompatible peers.

Compatibility references: [FastAPI package metadata](https://pypi.org/project/fastapi/), [Vite runtime requirements](https://vite.dev/guide/). Actual local installation, tests and builds are the acceptance evidence; package metadata alone is insufficient.

## Decisions awaiting their implementation phase

- Authentication transport, refresh-session revocation and CSRF behavior: Phase 3.
- CSV encodings, worksheet selection and decompression limits: Phase 4.
- Supported estimators, split strategies and rejection rules: Phase 6.
- Durable graph checkpoints and re-planning recovery after worker loss: later hardening; persisted runs fail visibly after interrupted RQ jobs.
- Embedding model and exact vector dimension; static report charts: Phase 8.
- Eligible hosting provider and protected gateway: Phase 10.

Any change to approved scope or consequential infrastructure requires review. Existing Verdikt resources and Ollama model storage are not migration targets.
