"""Build PDFs only from persisted owner-scoped research evidence."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import (
    AuditEvent,
    Dataset,
    DatasetDocument,
    DatasetProfile,
    DatasetVersion,
    EvidenceItem,
    Report,
    ResearchRun,
    StoredArtifact,
)
from app.db.session import create_db_engine
from app.services.comparisons import comparison_presentation
from app.services.reporting import render_research_report
from app.storage.paths import ArtifactStore


def _column_name(profile, column_id):
    return next(
        (item.get("name") for item in profile.get("columns", []) if item.get("id") == column_id),
        column_id,
    )


def _fail(report_id: str, owner_id: str, message: str):
    engine = create_db_engine(Settings(), runtime=True)
    try:
        with Session(engine) as db, db.begin():
            report = db.scalar(
                select(Report)
                .where(
                    Report.id == UUID(report_id),
                    Report.owner_id == UUID(owner_id),
                    Report.status.in_(("queued", "running")),
                )
                .with_for_update()
            )
            if report is not None:
                report.status = "failed"
                report.error_message = message
                db.add(
                    AuditEvent(
                        actor_id=report.owner_id,
                        event_type="research_report_failed",
                        entity_type="report",
                        entity_id=report.id,
                        meta_json={},
                    )
                )
    finally:
        engine.dispose()


def generate_report(report_id: str, owner_id: str) -> dict:
    settings = Settings()
    engine = create_db_engine(settings, runtime=True)
    try:
        with Session(engine) as db, db.begin():
            report = db.scalar(
                select(Report)
                .where(Report.id == UUID(report_id), Report.owner_id == UUID(owner_id))
                .with_for_update()
            )
            if report is None:
                return {"status": "missing"}
            if report.status == "completed":
                return {"status": "completed"}
            if report.status != "queued":
                return {"status": "stale"}
            run = db.scalar(
                select(ResearchRun).where(
                    ResearchRun.id == report.research_run_id,
                    ResearchRun.owner_id == report.owner_id,
                    ResearchRun.status == "completed",
                )
            )
            version = (
                db.scalar(
                    select(DatasetVersion).where(
                        DatasetVersion.id == run.dataset_version_id,
                        DatasetVersion.owner_id == report.owner_id,
                    )
                )
                if run
                else None
            )
            dataset = (
                db.scalar(
                    select(Dataset).where(
                        Dataset.id == version.dataset_id,
                        Dataset.owner_id == report.owner_id,
                    )
                )
                if version
                else None
            )
            if run is None or version is None or dataset is None:
                report.status = "failed"
                report.error_message = "The completed research sources are unavailable."
                return {"status": "failed"}
            report.status = "running"
            run_id = run.id
            profile = db.scalar(
                select(DatasetProfile).where(DatasetProfile.dataset_version_id == version.id)
            )
            profile_json = profile.profile_json if profile else {}
            evidence = db.scalars(
                select(EvidenceItem)
                .where(
                    EvidenceItem.run_id == run.id,
                    EvidenceItem.owner_id == report.owner_id,
                )
                .order_by(EvidenceItem.id)
            ).all()
            evidence_records = [
                {
                    "id": str(item.id),
                    "evidence_type": item.evidence_type,
                    "payload": item.payload_json,
                }
                for item in evidence
            ]
            question, dataset_name, version_no, version_id = (
                run.goal,
                dataset.display_name,
                version.version_no,
                str(version.id),
            )
            run_warnings = (run.plan_json or {}).get("warnings", [])
            approved_document_ids = (run.plan_json or {}).get("plan", {}).get("document_ids", [])
    except Exception:
        _fail(report_id, owner_id, "The report source records could not be loaded safely.")
        return {"status": "failed"}
    finally:
        engine.dispose()

    verified = [item for item in evidence_records if item["payload"].get("verified") is True]
    synthesis = next(
        (
            item["payload"].get("result", {})
            for item in evidence_records
            if item["evidence_type"] == "synthesize_evidence"
        ),
        {},
    )
    verified_ids = {item["id"] for item in verified}
    synthesis = comparison_presentation(
        synthesis,
        [{**item, "verified": True} for item in verified],
        profile_json,
        question,
        approved_document_ids,
    )
    comparisons = synthesis.get("comparisons", [])
    findings = [
        item for item in synthesis.get("findings", []) if item.get("evidence_id") in verified_ids
    ]
    document_findings = list(synthesis.get("document_findings", [])) + [
        {"claim": item["claim"], "citations": [dict(citation) for citation in item["citations"]]}
        for item in comparisons
    ]
    document_ids = {
        citation.get("document_id")
        for finding in document_findings
        for citation in finding.get("citations", [])
        if citation.get("document_id")
    }
    engine = create_db_engine(settings, runtime=True)
    try:
        with Session(engine) as db:
            documents = (
                db.scalars(
                    select(DatasetDocument).where(
                        DatasetDocument.owner_id == UUID(owner_id),
                        DatasetDocument.id.in_([UUID(value) for value in document_ids]),
                    )
                ).all()
                if document_ids
                else []
            )
            by_id = {str(item.id): item for item in documents}
    finally:
        engine.dispose()
    for finding in document_findings:
        for citation in finding.get("citations", []):
            source = by_id.get(citation.get("document_id"))
            if source is None:
                citation["source_available"] = False
            else:
                citation["source_filename"] = source.source_filename
                citation["source_available"] = True

    methods = []
    tables = []
    for item in verified:
        payload = item["payload"]
        result_data = payload.get("result", {})
        if payload.get("tool_name") == "run_grouped_aggregate":
            operation = result_data.get("operation")
            grouping = result_data.get("grouping", [])
            selected = result_data.get("selected_columns", [])
            metric = result_data.get("metric") or next(
                (column for column in reversed(selected) if column not in grouping), None
            )
            operation_labels = {
                "mean": "average",
                "sum": "total",
                "count": "count",
                "min": "minimum",
                "max": "maximum",
                "median": "median",
            }
            group_names = ", ".join(_column_name(profile_json, column) for column in grouping)
            methods.append(
                f"Grouped by {group_names}; calculated "
                f"{operation_labels.get(operation, operation)}"
                f"{f' for {_column_name(profile_json, metric)}' if metric else ''}."
            )
            rows = result_data.get("rows", [])
            if rows:
                columns = grouping + ["value"]
                tables.append(
                    {
                        "title": "Verified grouped results",
                        "columns": [
                            _column_name(profile_json, column) if column != "value" else "Result"
                            for column in columns
                        ],
                        "rows": [[row.get(column) for column in columns] for row in rows[:20]],
                    }
                )
        elif payload.get("tool_name") in {
            "run_descriptive_summary",
            "run_correlation",
            "get_missing_value_summary",
        }:
            methods.append(f"Executed {payload.get('tool_name')} using the approved plan.")
    methodology = " ".join(dict.fromkeys(methods))
    limitations = list(synthesis.get("limitations", []))
    limitations.extend(run_warnings if isinstance(run_warnings, list) else [])
    report_data = {
        "generated_at": datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC"),
        "question": question,
        "dataset_name": dataset_name,
        "dataset_version": version_no,
        "interpretation": synthesis.get("interpretation", ""),
        "findings": findings,
        "comparisons": comparisons,
        "document_findings": document_findings,
        "methodology": methodology,
        "tables": tables,
        "limitations": list(dict.fromkeys(limitations)),
    }
    source_manifest = {
        "research_run_id": str(run_id),
        "dataset_version_id": version_id,
        "verified_evidence_ids": sorted(verified_ids),
        "comparisons": comparisons,
        "document_citations": [
            {
                "document_id": citation["document_id"],
                "chunk_id": citation["chunk_id"],
                "evidence_id": citation["evidence_id"],
                "source_sha256": citation.get("source_sha256"),
                "page_number": citation.get("page_number"),
                "source_available": citation.get("source_available", False),
            }
            for finding in document_findings
            for citation in finding.get("citations", [])
        ],
    }
    stored = None
    try:
        pdf = render_research_report(report_data)
        stored = ArtifactStore(settings.file_storage_root).write(pdf, "pdf")
        engine = create_db_engine(settings, runtime=True)
        try:
            with Session(engine) as db, db.begin():
                report = db.scalar(
                    select(Report)
                    .where(
                        Report.id == UUID(report_id),
                        Report.owner_id == UUID(owner_id),
                        Report.status == "running",
                    )
                    .with_for_update()
                )
                if report is None:
                    raise RuntimeError("Report job is no longer current")
                artifact = StoredArtifact(
                    owner_id=report.owner_id,
                    relative_path=stored["reference"],
                    mime_type="application/pdf",
                    size_bytes=len(pdf),
                    sha256=stored["sha256"],
                )
                db.add(artifact)
                db.flush()
                report.artifact_id = artifact.id
                report.source_json = source_manifest
                report.status = "completed"
                report.error_message = None
                db.add(
                    AuditEvent(
                        actor_id=report.owner_id,
                        event_type="research_report_completed",
                        entity_type="report",
                        entity_id=report.id,
                        meta_json={"size_bytes": len(pdf)},
                    )
                )
        finally:
            engine.dispose()
        return {"status": "completed", "report_id": report_id}
    except Exception:
        if stored:
            try:
                ArtifactStore(settings.file_storage_root).delete(stored["reference"])
            except OSError:
                pass
        _fail(
            report_id, owner_id, "Report generation failed safely. Generate a new report to retry."
        )
        return {"status": "failed"}


def report_failure(job, connection, exc_type, exc_value, traceback):
    if not job or len(job.args or ()) < 2:
        return
    _fail(
        job.args[0], job.args[1], "Report generation stopped unexpectedly. Generate a new report."
    )
