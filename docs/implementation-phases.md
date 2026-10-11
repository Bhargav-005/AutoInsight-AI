# Implementation phases 0-10

The master instructions replace the implementation PDF's earlier 0-6 numbering. Work proceeds through eleven phases, with acceptance checks and user approval before advancing. A phase is not complete merely because a checkpoint or scaffold is complete.

| Phase | Scope | Acceptance gate |
| --- | --- | --- |
| 0 - Feasibility and architecture | Local model/hardware validation and architectural decisions | Owner-reported model benchmarks accepted for starting Phase 1; broader measurements remain scheduled later |
| 1 - Repository and infrastructure | Configuration, minimal React/Vite and FastAPI scaffolds, private PostgreSQL/Redis, worker connectivity, storage foundations, migrations setup, tests and developer scripts | Reproducible locked installs; lint/build/tests; service health, persistence and real worker smoke checks; Verdikt untouched |
| 2 - Frontend UI foundation | Eight interface areas, approved route conventions, accessible shell, reusable controls and honest UI states | Navigation and keyboard checks; responsive layout; loading/error/empty states; no fabricated results |
| 3 - Authentication and database | Authentication/session lifecycle, ownership and required relational entities | Register/login/logout/restore and expiration; migration tests; cross-user access and invalid ownership links rejected |
| 4 - Dataset upload and profiling | CSV/XLSX validation, immutable raw artifacts, checksums, preview, schema and deterministic profiles | Invalid/oversized inputs rejected; profiles match independent reference calculations; resource limits enforced |
| 5 - Cleaning and analytics | Proposed transforms, preview/approval/rejection, immutable lineage, aggregates, filters, correlations, charts and supported exports | New versions only after approval; raw checksum unchanged; computed chart values and evidence agree |
| 6 - Machine learning | Classification/regression, confirmed target/task, safe splits, dummy baselines, candidates, actual metrics and validated predictions | Leakage/repeatability tests; two classification datasets and at least one regression dataset; stored configuration, version and artifact provenance |
| 7 - Multi-agent Research Mode | Seven typed roles, local Ollama, allowlisted tools, LangGraph, plan approval, one bounded revision, RQ execution and evidence | Real local plan generation; approval and ownership checks; 12-step limit; visible failures/cancellation; verified evidence-linked claims |
| 8 - RAG and reporting | Curated/user-owned document retrieval, citations, verification, PDF generation and history | Scope isolation; source-grounded claims or abstention; reports reconstructible from actual stored evidence |
| 9 - Integration, security and performance | Complete journeys, unsafe inputs, authorization, resilience, measurements and offline verification | At least three varied unseen datasets including classification/regression; no known cross-user exposure; failures and measured resource results documented |
| 10 - Hybrid deployment and final delivery | Hosted static frontend, protected HTTPS API tunnel, runbooks and academic demonstration | Security gates pass; services/artifacts stay private; disconnected state works; local offline demo and final delivery are reproducible |

## Current phase

Phases 1–7 are implemented. The foundation and verification records remain in [Checkpoint A](checkpoint-a.md) and [Checkpoint B](checkpoint-b.md). Phases 2–6 provide the authenticated UI, dataset ingestion, immutable cleaning, deterministic analytics and supervised ML. Phase 7 connects the AI Research workspace to locally generated plans, explicit approval, LangGraph/RQ execution and persisted evidence. Phase 8 is the next unstarted phase.

Development fixtures remain explicitly labeled and excluded from production builds. Document ingestion, vector retrieval, citations, PDF reports, exhaustive security/performance testing and public deployment remain deferred to Phases 8–10.

## Cross-phase release rules

- Every feature has relevant automated checks and a reproducible manual verification path.
- Numerical claims and evaluation metrics come from actual computations, not placeholder values.
- The final release demonstrates an inspectable, reproducible research trace and at least three varied unseen datasets.
- Tests must report failures as well as passes; acceptance cannot be inferred from unexecuted commands.
- No destructive migration, commit, push or public deployment is performed without the applicable user approval.
