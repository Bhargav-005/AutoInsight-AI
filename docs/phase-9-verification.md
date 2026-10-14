# Phase 9 verification record

Baseline: `97f232e` on `main`, 14 October 2026. Tracked tree initially clean. The unrelated untracked root file was left untouched. No commit, push or Phase 10 work is authorized.

## Risk inventory and acceptance criteria

| Area | Existing coverage | Priority / gaps to investigate | Acceptance evidence |
| --- | --- | --- | --- |
| Authentication | auth, security, errors, frontend auth | High: expiry, CSRF, rate limits, runtime grants | Negative requests denied; passwords/tokens absent from errors |
| Ownership | dataset, Phase 5, ML, research, knowledge, reports API tests | High: nested and cross-owner references, citations, downloads | Guessed foreign IDs cannot read or mutate resources |
| Files | storage, profiling, local knowledge | High: archive expansion, invalid formats, integrity and extraction bounds | Bounded parsing and generated paths; corruption rejected |
| Data engine | profiling, Phase 5 services/API | High: missing groups, text counts, independent arithmetic | Defined null/count semantics; source immutable; reference values match |
| ML | ML unit/API and Phase 6 browser | High: leakage, reproducibility, independent metrics | Train-only preprocessing; seeded repeatability; owner-only predictions |
| Research | research, recovery, API and Phase 7 browser | High: tool allowlist, approval hash, unsupported claims, cancellation | Bounded approved execution; honest supported findings and limitations |
| Knowledge | local knowledge, knowledge API | High: owner scope, provenance, injection, model dimensions | Only authorized compatible chunks; no fabricated document claims |
| Comparisons | comparisons, Research component, Phase 8 browser | High: multiline target, ambiguity, metric/unit/scope mismatch | Persisted 8,500/10,000 comparison agrees with UI and PDF |
| PDF | local knowledge, reports API, Phase 8 browser | Medium: wrapping, long tables, Unicode, meaningful conclusion | Text and rendered-page inspection; authorized checksum download |
| Jobs/database | infrastructure, recovery, migrations, API jobs | High: abandoned document/report jobs, duplicate dispatch, real outages | No live job falsely failed; bounded recovery; schema matches migrations |
| Frontend | component/routes and browser suites | Medium: state refresh, errors, keyboard, mobile | Type/lint/build; representative authenticated desktop/mobile checks |
| Performance | prior Phase 0 measurements only | Medium: current bounded data/ML/RAG/report timings | Record measured sizes/runtime/resources; no invented throughput |

The four approved reference PDFs were inspected. Their proposed defaults are subordinate to the approved implementation: opaque server sessions with CSRF rather than JWT, separate loopback PostgreSQL/Redis ports, Python 3.13, deterministic Pandas analytics, Ollama embeddings with validated 384 dimensions, and read-only research tools with separate approval-gated cleaning/ML. Seven roles remain logical roles using one model. Reference PDF deletion/full offline packaging and report chart ambitions are not assumed implemented merely because listed in the proposal.

## Findings, changes and evidence

| Severity | Confirmed defect | Change and evidence |
| --- | --- | --- |
| High | Readiness still required schema revision `0005_ml_engine`; the live Phase 8 database at `0007_local_knowledge_and_reports` always returned 503. | Updated the readiness revision check. Real readiness and stop/restart/outage integration checks passed after waiting for the worker heartbeat. |
| High | `count(metric)` coerced text columns to numeric and counted zero; numeric groups containing only missing values were reported as overflow. | Count now uses original non-null values; empty numeric groups produce null. Text, missing group, mean/sum/min/max and overflow regressions pass. |
| High | Embedding validation accepted booleans, NaN, infinity and zero vectors. | Reject invalid or zero vectors before storing/using them; focused tests pass. |
| High | Document claim validation used bag-of-words/number overlap, which accepted swapped numbers, negation and unsupported paraphrases. | Only complete retrieved lines/sentences are accepted and presented as quotations; cited document IDs must be in the approved scope, and verification rejects out-of-scope passages. Prompt-injection, number-swap, attribution and scope tests pass. This conservative rule may omit valid paraphrases. |
| High | Multipart body limits were applied only to selected JSON routes and after form parsing did not protect uploads. | POST bodies are bounded before parsing; dataset/document requests use their configured file limit plus multipart overhead. Oversized JSON and multipart regression cases pass. |
| High | PDF chunks could cross pages while retaining only the first page's citation location. | Page-bound PDF chunks now stop at page boundaries; focused extraction/chunk tests pass. |
| Medium | Interrupted document/report jobs could remain queued/running indefinitely. Duplicate report requests could enqueue concurrent reports. | Read paths reconcile only expired jobs with a missing/terminal/stale RQ record, while preserving mapped active workers and unknown Redis states. Owner-scoped row locks recheck state. Repeated report creation reuses a pending report. Unit and real integration recovery/isolation checks pass. |
| Medium | Comparison reports repeated their comparison in the document-citation section and stranded the conclusion on a mostly empty second page. | Avoided repeating the claim in the citation appendix and removed an empty limitations filler section. The final authenticated report is one page; all sections, source IDs, filename, chunk, passage and conclusion were inspected after rendering. |
| Medium | The auth integration test scanned audit rows created by other users and assumed anonymous login failures had an account actor. | Test now scopes user events and separately counts the intentionally unattributed failures. Readiness tests wait for the documented heartbeat. These were test isolation/timing defects, not auth failures. |

No database migration was needed. The seven logical roles, LangGraph/RQ flow, plan-hash approval, tool allowlists, immutable dataset versions, owner scoping and persisted evidence model remain in place. Comparison arithmetic remains deterministic. Historical evidence rows are not rewritten. Cross-owner report/document reads and actions return not-found; citation synthesis and retrieval verify approved document scope.

## Final validation

- Backend default suite: **145 passed, 1 skipped, 35 deselected**. The skipped case requires Windows symlink privileges. The 35 deselected cases are marked integration.
- Integration suite: **35 distinct integration cases passed** across the consolidated run plus focused reruns of the 3 initially failing cases. Those failures were the auth test's global audit scan and readiness heartbeat/schema assumptions; all 3 passed after correction. The first full integration attempt therefore ended **32 passed, 3 failed**; it is not represented as a clean first pass.
- Backend Ruff: `uv run ruff check app worker migrations tests` passed.
- Migration drift: `uv run alembic check` reported no new upgrade operations; current DB is `0007_local_knowledge_and_reports`.
- Python lock: `uv lock --check` resolved the locked 89 packages without changes.
- Frontend Vitest: **45 passed** in 4 files. TypeScript typecheck, ESLint and production build all passed (2,577 modules built).
- Authenticated Playwright Phase 8 research-to-PDF: **desktop and mobile passed**; the final report-layout edit was rechecked in a final desktop run. It verified dataset/document indexing, exact-plan approval, actual 8,500 vs. target 10,000, the 1,500 shortfall, 15% below target, 85% achievement, both evidence IDs, persisted comparison on reopen, PDF download and matching executive summary/findings/conclusion.
- PDF visual check: final downloaded report rendered as **one page**, with conclusion and citation appendix visible, no clipped text, and footer/page number present.
- Bounded single-run timings on this workstation: 50,000-row profile 0.221 s; 50,000-row four-group mean 0.004 s; 50,000-row three-column correlation 0.054 s; one cleaning operation on 50,000 rows 0.018 s; 200-row Ridge training 0.074 s (40 held-out rows); 8 embedding texts 0.405 s; one 43-byte TXT document indexed into 1 chunk in 1.658 s; one scoped vector search 1.797 s including query embedding; representative one-page PDF render 0.011 s. The CPU-only local planning POST took 47.4 s in the authenticated E2E run. These are individual observations, not repeatability/load or peak-memory benchmarks.

## Remaining limitations and release verdict

No Critical or High code defect found in the reviewed paths remains open. Phase 9 is **conditionally verified for the tested local scope**, not a general release certification. The repository's broader proposed acceptance gate calls for three varied unseen end-to-end datasets, classification and regression runs through the UI, and a fully disconnected offline demo; this pass verified both ML tasks in deterministic unit tests but did not execute that whole release demo. No peak RAM/VRAM or sustained/concurrent throughput test was collected. The browser run covered the Phase 8 research-to-report flow at desktop and mobile sizes; it was not an exhaustive manual accessibility audit of every route. Malicious PDF/DOCX fuzzing and very large workbooks were not exhaustively fuzzed. Scanned PDFs still require OCR and remain unsupported. Document deletion is currently index removal (which invalidates retrieval), not erasure of the uploaded source artifact. Reports do not yet render charts. These proposed features/verification gaps should be considered before claiming the full PRD release gate is met.

The user-provided Phase 9 reference PDFs are academic proposals; approved implementation choices take precedence. In particular the app uses opaque database sessions/CSRF rather than JWT, loopback PostgreSQL and Redis ports, one worker, local Ollama embeddings, a 384-dimensional vector schema, and separate approval-gated cleaning/ML workflows. Full offline packaging, OCR, physical source deletion, RLS and report charts are not claimed as implemented.

## Changed files and working-tree state

Backend changes: `app/api/documents.py`, `app/api/reports.py`, `app/main.py`, `app/services/analytics.py`, `app/services/documents.py`, `app/services/embeddings.py`, `app/services/job_recovery.py`, `app/services/readiness.py`, `app/services/reporting.py`, `app/services/research.py`, `worker/document_jobs.py`, `worker/report_jobs.py`.

Regression tests: `tests/test_auth.py`, `tests/test_infrastructure.py`, `tests/test_job_recovery.py`, `tests/test_knowledge_api.py`, `tests/test_local_knowledge.py`, `tests/test_ml.py`, `tests/test_phase5_services.py`, `tests/test_reports_api.py`, `tests/test_security.py`.

Project docs: `README.md`, this verification record. No frontend source, migration, dependency or lockfile changed. No commit or push was made. The unrelated untracked root Phase 1 file was left untouched. Authenticated integration/E2E tests leave dedicated test accounts, datasets, reports and artifacts in local test storage; those records were not deleted. Only AutoInsight's Postgres/Redis/worker services were started/rebuilt for testing; no unrelated Docker resource or volume was touched.

## PowerShell startup and manual smoke retest

From `E:\FSI`, start the project services and apply migrations:

```powershell
Set-Location -LiteralPath 'E:\FSI'
.\scripts\Start-Infrastructure.ps1
.\scripts\Invoke-Migrations.ps1
```

Open two PowerShell terminals and run:

```powershell
Set-Location -LiteralPath 'E:\FSI'
.\scripts\Start-Api.ps1
```

```powershell
Set-Location -LiteralPath 'E:\FSI'
.\scripts\Start-Frontend.ps1
```

Browse to `http://127.0.0.1:5173`. Register two test accounts. Upload a CSV as account A and verify its profile/version. Upload a small selectable-text TXT reference containing a target, wait for `indexed`, and start a research question that requests a grouped average versus that target. Review the exact plan and approve it; verify the persisted actual, target, difference, percentages, target status, dataset evidence ID and document filename/chunk/evidence citation. Reopen the completed run and confirm the result is unchanged. Generate/download the PDF; confirm the executive summary, verified finding, conclusion and citations match the Research UI. As account B, try A's dataset/document/report IDs and confirm they return not-found. Also try an oversized upload and an ambiguous or mismatched target; the upload must be rejected, and the comparison must explain its limitation. Stop foreground processes with Ctrl+C; `.\scripts\Stop-Infrastructure.ps1` stops only AutoInsight services and preserves database volumes/artifacts.
