"""Owner-scoped persisted research reports and PDF downloads."""

import hashlib
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict
from rq import Callback
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import DB, CurrentUser, Envelope, result
from app.core.errors import AppError
from app.core.security import require_csrf
from app.db.models import AuditEvent, Dataset, DatasetVersion, Report, ResearchRun, StoredArtifact
from app.services.job_recovery import abandoned_job
from app.storage.paths import ArtifactStore
from worker.connection import queue

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])


class ReportCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    research_run_id: UUID


class ReportView(BaseModel):
    id: UUID
    research_run_id: UUID
    status: str
    error_message: str | None
    created_at: datetime
    question: str
    dataset_name: str


def _report_view(db: Session, report: Report) -> ReportView:
    run = db.scalar(
        select(ResearchRun).where(
            ResearchRun.id == report.research_run_id,
            ResearchRun.owner_id == report.owner_id,
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
    return ReportView(
        id=report.id,
        research_run_id=report.research_run_id,
        status=report.status,
        error_message=report.error_message,
        created_at=report.created_at,
        question=run.goal if run else "Research is unavailable.",
        dataset_name=dataset.display_name if dataset else "Dataset is unavailable",
    )


def _recover_report(request, db, report):
    if report.status not in {"queued", "running"} or not abandoned_job(
        report.job_id,
        report.created_at,
        request.app.state.settings,
        request.app.state.redis,
    ):
        return
    current = db.scalar(
        select(Report)
        .where(
            Report.id == report.id,
            Report.owner_id == report.owner_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if current.status in {"queued", "running"} and abandoned_job(
        current.job_id,
        current.created_at,
        request.app.state.settings,
        request.app.state.redis,
    ):
        current.status = "failed"
        current.error_message = "Report generation was interrupted. Generate a new report."
        db.add(
            AuditEvent(
                actor_id=current.owner_id,
                event_type="report_job_abandoned",
                entity_type="report",
                entity_id=current.id,
                meta_json={},
            )
        )
    db.commit()


def _queue_report(request: Request, db: Session, report: Report):
    try:
        if request.app.state.redis is None:
            raise RuntimeError("queue unavailable")
        queue(request.app.state.settings, request.app.state.redis).enqueue(
            "worker.report_jobs.generate_report",
            str(report.id),
            str(report.owner_id),
            job_id=report.job_id,
            on_failure=Callback("worker.report_jobs.report_failure"),
            job_timeout=request.app.state.settings.max_job_seconds,
            result_ttl=3600,
            failure_ttl=86400,
        )
    except Exception:
        report.status = "failed"
        report.error_message = (
            "The report worker queue is unavailable. Try generating a new report."
        )
        db.commit()


@router.post(
    "",
    status_code=202,
    dependencies=[Depends(require_csrf)],
    response_model=Envelope[ReportView],
)
def create_report(request: Request, payload: ReportCreate, user: CurrentUser, db: DB):
    run = db.scalar(
        select(ResearchRun)
        .where(
            ResearchRun.id == payload.research_run_id,
            ResearchRun.owner_id == user.id,
        )
        .with_for_update()
    )
    if run is None:
        raise AppError(404, "RESEARCH_NOT_FOUND", "Research run not found.")
    if run.status != "completed":
        raise AppError(409, "RESEARCH_NOT_COMPLETE", "Generate a report after research completes.")
    existing = db.scalar(
        select(Report)
        .where(
            Report.owner_id == user.id,
            Report.research_run_id == run.id,
            Report.status.in_(("queued", "running")),
        )
        .order_by(Report.created_at.desc())
        .limit(1)
    )
    if existing is not None:
        return result(request, _report_view(db, existing))
    report = Report(
        owner_id=user.id,
        research_run_id=run.id,
        artifact_id=None,
        status="queued",
        error_message=None,
        job_id=None,
        source_json={},
    )
    db.add(report)
    db.flush()
    report.job_id = f"report-{report.id}"
    db.add(
        AuditEvent(
            actor_id=user.id,
            event_type="research_report_queued",
            entity_type="report",
            entity_id=report.id,
            meta_json={"research_run_id": str(run.id)},
        )
    )
    db.commit()
    db.refresh(report)
    _queue_report(request, db, report)
    db.refresh(report)
    return result(request, _report_view(db, report))


@router.get("", response_model=Envelope[list[ReportView]])
def list_reports(request: Request, user: CurrentUser, db: DB):
    reports = db.scalars(
        select(Report)
        .where(Report.owner_id == user.id)
        .order_by(Report.created_at.desc(), Report.id)
        .limit(100)
    ).all()
    for report in reports:
        _recover_report(request, db, report)
    return result(request, [_report_view(db, report) for report in reports])


@router.get("/{report_id}", response_model=Envelope[ReportView])
def get_report(request: Request, report_id: UUID, user: CurrentUser, db: DB):
    report = db.scalar(select(Report).where(Report.id == report_id, Report.owner_id == user.id))
    if report is None:
        raise AppError(404, "REPORT_NOT_FOUND", "Report not found.")
    _recover_report(request, db, report)
    return result(request, _report_view(db, report))


@router.get("/{report_id}/download")
def download_report(request: Request, report_id: UUID, user: CurrentUser, db: DB):
    report = db.scalar(
        select(Report).where(
            Report.id == report_id,
            Report.owner_id == user.id,
            Report.status == "completed",
        )
    )
    if report is None or report.artifact_id is None:
        raise AppError(404, "REPORT_NOT_FOUND", "Completed report not found.")
    artifact = db.scalar(
        select(StoredArtifact).where(
            StoredArtifact.id == report.artifact_id,
            StoredArtifact.owner_id == user.id,
        )
    )
    if artifact is None or artifact.mime_type != "application/pdf":
        raise AppError(404, "REPORT_NOT_FOUND", "Completed report not found.")
    try:
        path = ArtifactStore(request.app.state.settings.file_storage_root).resolve(
            artifact.relative_path
        )
        if (
            path.stat().st_size != artifact.size_bytes
            or path.stat().st_size > request.app.state.settings.max_document_bytes
        ):
            raise ValueError("size mismatch")
        with path.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != artifact.sha256:
            raise ValueError("checksum mismatch")
    except OSError:
        raise AppError(404, "REPORT_NOT_FOUND", "Completed report not found.") from None
    except ValueError:
        raise AppError(
            409, "REPORT_UNAVAILABLE", "The saved report failed integrity verification."
        ) from None
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=f"autoinsight-report-{str(report.id)[:8]}.pdf",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )
