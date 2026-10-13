"""Authenticated, approval-gated local research runs."""

from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from redis.exceptions import RedisError
from rq import Callback, Worker
from rq.exceptions import NoSuchJobError
from rq.job import Job
from rq.registry import (
    CanceledJobRegistry,
    DeferredJobRegistry,
    FailedJobRegistry,
    FinishedJobRegistry,
    ScheduledJobRegistry,
    StartedJobRegistry,
)
from rq.serializers import JSONSerializer
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.auth import DB, CurrentUser, Envelope, result
from app.core.errors import AppError
from app.core.security import require_csrf
from app.db.models import (
    AgentStep,
    AuditEvent,
    DatasetDocument,
    DatasetProfile,
    DatasetVersion,
    EvidenceItem,
    ResearchRun,
)
from app.services.comparisons import comparison_presentation
from app.services.research import (
    build_planning_graph,
    dataset_context,
    findings_from_verified,
    plan_digest,
)
from worker.connection import queue

router = APIRouter(prefix="/api/v1/research", tags=["research"])
RESEARCH_START_ADVISORY_LOCK = 7_160_071


class ResearchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dataset_id: UUID
    dataset_version_id: UUID
    question: str = Field(min_length=8, max_length=1000)
    document_ids: list[UUID] = Field(default_factory=list, max_length=20)

    @field_validator("question")
    @classmethod
    def normalize_question(cls, value):
        value = value.strip()
        if not 8 <= len(value) <= 1000:
            raise ValueError("The research question must contain 8 to 1000 characters.")
        return value

    @field_validator("document_ids")
    @classmethod
    def unique_documents(cls, value):
        if len(value) != len(set(value)):
            raise ValueError("A reference document can be selected only once.")
        return value


class ResearchAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirm: bool


class RevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    feedback: str = Field(min_length=3, max_length=500)

    @field_validator("feedback")
    @classmethod
    def normalize_feedback(cls, value):
        value = value.strip()
        if not 3 <= len(value) <= 500:
            raise ValueError("Revision feedback must contain 3 to 500 characters.")
        return value


class ResearchStepView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    step_index: int
    agent_role: str
    tool_name: str | None
    status: str
    input_summary: dict[str, Any]
    output_summary: dict[str, Any]
    started_at: datetime
    ended_at: datetime | None


class EvidenceView(BaseModel):
    id: UUID
    step_id: UUID | None
    evidence_type: str
    payload: dict[str, Any]


class ResearchView(BaseModel):
    id: UUID
    dataset_id: UUID
    dataset_version_id: UUID
    question: str
    status: str
    plan: dict[str, Any]
    approval: dict[str, Any]
    revision_count: int
    steps: list[ResearchStepView]
    evidence: list[EvidenceView]
    created_at: datetime
    failure: str | None = None
    cancellation_requested: bool = False


def _owned_run(db: Session, owner_id: UUID, run_id: UUID) -> ResearchRun:
    run = db.scalar(
        select(ResearchRun).where(ResearchRun.id == run_id, ResearchRun.owner_id == owner_id)
    )
    if run is None:
        raise AppError(404, "RESEARCH_NOT_FOUND", "Research run not found.")
    return run


def _view(db: Session, run: ResearchRun) -> ResearchView:
    version = db.scalar(
        select(DatasetVersion).where(
            DatasetVersion.id == run.dataset_version_id,
            DatasetVersion.owner_id == run.owner_id,
        )
    )
    if version is None:
        raise AppError(404, "RESEARCH_NOT_FOUND", "Research run not found.")
    steps = db.scalars(
        select(AgentStep)
        .where(AgentStep.research_run_id == run.id, AgentStep.owner_id == run.owner_id)
        .order_by(AgentStep.step_index)
    ).all()
    evidence = db.scalars(
        select(EvidenceItem)
        .where(EvidenceItem.run_id == run.id, EvidenceItem.owner_id == run.owner_id)
        .order_by(EvidenceItem.id)
    ).all()
    profile = db.scalar(
        select(DatasetProfile).where(DatasetProfile.dataset_version_id == version.id)
    )
    profile_json = profile.profile_json if profile is not None else None
    evidence_views = [
        EvidenceView(
            id=item.id,
            step_id=item.step_id,
            evidence_type=item.evidence_type,
            payload=item.payload_json,
        )
        for item in evidence
    ]
    # Older completed runs keep their original evidence payloads. Refresh only the API
    # presentation of the synthesis from those same verified records and this version's
    # persisted schema, leaving the evidence rows untouched.
    verified_evidence = [
        {
            "id": str(item.id),
            "payload": item.payload_json,
            "verified": item.payload_json.get("verified") is True,
        }
        for item in evidence
    ]
    refreshed_findings = findings_from_verified(verified_evidence, profile_json)
    for evidence_view in evidence_views:
        if evidence_view.evidence_type != "synthesize_evidence":
            continue
        payload = dict(evidence_view.payload)
        synthesis = payload.get("result")
        if isinstance(synthesis, dict):
            synthesis = comparison_presentation(
                synthesis,
                verified_evidence,
                profile_json or {},
                run.goal,
                (run.plan_json or {}).get("plan", {}).get("document_ids", []),
            )
            payload["result"] = {
                **synthesis,
                "findings": refreshed_findings or synthesis.get("findings", []),
            }
            evidence_view.payload = payload
    data = run.plan_json or {}
    return ResearchView(
        id=run.id,
        dataset_id=version.dataset_id,
        dataset_version_id=version.id,
        question=run.goal,
        status=run.status,
        plan=data.get("plan", {}),
        approval=data.get("approval", {"status": "pending"}),
        revision_count=int(data.get("revision_count", 0)),
        steps=steps,
        evidence=evidence_views,
        created_at=run.created_at,
        failure=data.get("failure"),
        cancellation_requested=bool(data.get("cancellation_requested")),
    )


def _rq_job_state(run: ResearchRun, settings, redis) -> str:
    """Inspect the mapped RQ job and worker before deciding a DB run is abandoned."""
    if redis is None:
        return "unavailable"
    q = queue(settings, redis)
    job_id = (run.plan_json or {}).get("job_id") or f"research-{run.id}"
    try:
        queued_ids = set(q.job_ids)
        worker_job_ids = {
            worker.get_current_job_id()
            for worker in Worker.all(connection=redis)
            if worker.get_state() == "busy" and worker.get_current_job_id()
        }
        registry_ids = {
            registry_type.__name__: set(
                registry_type(name=q.name, connection=redis, queue=q).get_job_ids()
            )
            for registry_type in (
                StartedJobRegistry,
                DeferredJobRegistry,
                ScheduledJobRegistry,
                FailedJobRegistry,
                FinishedJobRegistry,
                CanceledJobRegistry,
            )
        }
        if job_id in worker_job_ids:
            return "active_worker"
        if job_id in queued_ids:
            return "queued"
        if job_id in registry_ids["DeferredJobRegistry"]:
            return "deferred"
        if job_id in registry_ids["ScheduledJobRegistry"]:
            return "scheduled"
        if job_id in registry_ids["StartedJobRegistry"]:
            return "orphaned_started"
        if job_id in registry_ids["FailedJobRegistry"]:
            return "failed"
        if job_id in registry_ids["CanceledJobRegistry"]:
            return "cancelled"
        if job_id in registry_ids["FinishedJobRegistry"]:
            return "finished"
        try:
            job = Job.fetch(job_id, connection=redis, serializer=JSONSerializer)
        except NoSuchJobError:
            return "missing"
        status = job.get_status(refresh=True)
        value = status.value if status is not None else "unknown"
        if value == "queued" and job_id in queued_ids:
            return "queued"
        if value == "started" and job_id in worker_job_ids:
            return "active_worker"
        return value
    except (RedisError, OSError, TimeoutError):
        return "unavailable"


def reconcile_stale_research_runs(db: Session, settings, redis) -> int:
    """Fail only over-age runs whose RQ state proves they are no longer executing."""
    runs = db.scalars(
        select(ResearchRun)
        .where(ResearchRun.status.in_(["queued", "running"]))
        .with_for_update(skip_locked=True)
    ).all()
    now = datetime.now(UTC)
    stale_after = timedelta(seconds=settings.max_job_seconds + 60)
    changed = 0
    live_states = {"active_worker", "queued", "deferred", "scheduled"}
    for run in runs:
        data = run.plan_json or {}
        timestamp = data.get("queued_at")
        try:
            since = (
                datetime.fromisoformat(timestamp) if isinstance(timestamp, str) else run.created_at
            )
            if since.tzinfo is None:
                since = since.replace(tzinfo=UTC)
        except ValueError:
            since = run.created_at
        if now - since < stale_after:
            continue
        rq_state = _rq_job_state(run, settings, redis)
        if rq_state == "unavailable" or rq_state == "unknown":
            raise AppError(
                503,
                "RESEARCH_STATE_UNAVAILABLE",
                "Could not verify the research worker state; no active run was changed.",
            )
        if rq_state in live_states:
            continue
        run.status = "failed"
        run.plan_json = {
            **data,
            "failure": "The research run exceeded its worker time limit without a live RQ job.",
            "failure_code": "RESEARCH_JOB_ABANDONED",
            "stale_reconciled_at": now.isoformat(),
            "stale_rq_state": rq_state,
        }
        db.add(
            AuditEvent(
                actor_id=run.owner_id,
                event_type="research_run_stale_reconciled",
                entity_type="research_run",
                entity_id=run.id,
                meta_json={"previous_status": "queued_or_running", "rq_state": rq_state},
            )
        )
        changed += 1
    return changed


def _propose_plan(settings, run, user, dataset_id, revision_feedback=None, document_ids=None):
    state = build_planning_graph(settings).invoke(
        {
            "run_id": str(run.id),
            "owner_id": str(user.id),
            "dataset_id": str(dataset_id),
            "dataset_version_id": str(run.dataset_version_id),
            "question": run.goal,
            "revision_feedback": revision_feedback,
            "knowledge_document_ids": [str(value) for value in (document_ids or [])],
            "profile": {},
            "ml_runs": [],
            "plan": {},
            "status": "planning",
            "failure": "",
        },
        config={"recursion_limit": 12},
    )
    if state.get("failure"):
        raise AppError(503, "RESEARCH_PLANNING_FAILED", state["failure"])
    return state["plan"]


@router.post(
    "", status_code=201, dependencies=[Depends(require_csrf)], response_model=Envelope[ResearchView]
)
def create_research(request: Request, payload: ResearchCreate, user: CurrentUser, db: DB):
    settings = request.app.state.settings
    version = db.scalar(
        select(DatasetVersion).where(
            DatasetVersion.id == payload.dataset_version_id,
            DatasetVersion.dataset_id == payload.dataset_id,
            DatasetVersion.owner_id == user.id,
        )
    )
    if version is None:
        raise AppError(404, "VERSION_NOT_FOUND", "Dataset version not found.")
    dataset, version, _ = dataset_context(db, user.id, version.id)
    if payload.document_ids:
        selected_documents = db.scalars(
            select(DatasetDocument).where(
                DatasetDocument.owner_id == user.id,
                DatasetDocument.id.in_(payload.document_ids),
                DatasetDocument.status == "indexed",
                DatasetDocument.embedding_model == settings.rag_embedding_model,
                DatasetDocument.embedding_dimensions == settings.rag_embedding_dimensions,
            )
        ).all()
        if len(selected_documents) != len(payload.document_ids):
            raise AppError(
                422,
                "DOCUMENTS_NOT_READY",
                "Choose only documents that are indexed and available to your account.",
            )
    run = ResearchRun(
        owner_id=user.id,
        dataset_version_id=version.id,
        goal=payload.question.strip(),
        status="draft",
        max_steps=settings.max_research_steps,
        plan_json={
            "planning_started_at": datetime.now(UTC).isoformat(),
            "document_ids": [str(value) for value in payload.document_ids],
        },
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    try:
        plan_json = _propose_plan(
            settings, run, user, dataset.id, document_ids=payload.document_ids
        )
        run.plan_json = {
            "plan": plan_json,
            "plan_hash": plan_digest(plan_json),
            "planning_completed_at": datetime.now(UTC).isoformat(),
            "approval": {"status": "pending"},
        }
        run.status = "awaiting_approval"
    except AppError as exc:
        run.status = "failed"
        run.plan_json = {
            **run.plan_json,
            "failure": exc.message,
            "failure_code": exc.code,
            "planning_completed_at": datetime.now(UTC).isoformat(),
        }
    db.commit()
    db.refresh(run)
    return result(request, _view(db, run))


@router.get("", response_model=Envelope[list[ResearchView]])
def list_research(request: Request, user: CurrentUser, db: DB):
    runs = db.scalars(
        select(ResearchRun)
        .where(ResearchRun.owner_id == user.id)
        .order_by(ResearchRun.created_at.desc())
        .limit(50)
    ).all()
    return result(request, [_view(db, run) for run in runs])


@router.get("/{run_id}", response_model=Envelope[ResearchView])
def get_research(request: Request, run_id: UUID, user: CurrentUser, db: DB):
    return result(request, _view(db, _owned_run(db, user.id, run_id)))


@router.post(
    "/{run_id}/approve", dependencies=[Depends(require_csrf)], response_model=Envelope[ResearchView]
)
def approve_research(
    request: Request, run_id: UUID, action: ResearchAction, user: CurrentUser, db: DB
):
    run = db.scalar(
        select(ResearchRun)
        .where(ResearchRun.id == run_id, ResearchRun.owner_id == user.id)
        .with_for_update()
    )
    if run is None:
        raise AppError(404, "RESEARCH_NOT_FOUND", "Research run not found.")
    if run.status != "awaiting_approval":
        raise AppError(409, "PLAN_NOT_APPROVABLE", "Only an awaiting plan can be approved.")
    if not action.confirm:
        raise AppError(422, "APPROVAL_REQUIRED", "Explicit plan approval is required.")
    _, version, _ = dataset_context(db, user.id, run.dataset_version_id)
    plan = run.plan_json.get("plan", {})
    digest = plan_digest(plan)
    if digest != run.plan_json.get("plan_hash"):
        raise AppError(409, "PLAN_CHANGED", "The proposed plan changed; request a new plan.")
    run.plan_json = {
        **run.plan_json,
        "approved_plan_hash": digest,
        "approval": {
            "status": "approved",
            "approved_at": datetime.now(UTC).isoformat(),
            "approved_by": str(user.id),
        },
        "approved_dataset_version_id": str(version.id),
    }
    db.add(
        AuditEvent(
            actor_id=user.id,
            event_type="research_plan_approved",
            entity_type="research_run",
            entity_id=run.id,
            meta_json={"plan_hash": digest, "dataset_version_id": str(version.id)},
        )
    )
    db.commit()
    db.refresh(run)
    return result(request, _view(db, run))


@router.post(
    "/{run_id}/reject", dependencies=[Depends(require_csrf)], response_model=Envelope[ResearchView]
)
def reject_research(
    request: Request, run_id: UUID, action: ResearchAction, user: CurrentUser, db: DB
):
    run = db.scalar(
        select(ResearchRun)
        .where(ResearchRun.id == run_id, ResearchRun.owner_id == user.id)
        .with_for_update()
    )
    if run is None:
        raise AppError(404, "RESEARCH_NOT_FOUND", "Research run not found.")
    if run.status != "awaiting_approval":
        raise AppError(409, "PLAN_NOT_REJECTABLE", "Only an awaiting plan can be rejected.")
    if not action.confirm:
        raise AppError(422, "REJECTION_REQUIRED", "Explicit plan rejection is required.")
    run.status = "rejected"
    run.plan_json = {
        **run.plan_json,
        "approval": {
            "status": "rejected",
            "rejected_at": datetime.now(UTC).isoformat(),
            "rejected_by": str(user.id),
        },
    }
    db.add(
        AuditEvent(
            actor_id=user.id,
            event_type="research_plan_rejected",
            entity_type="research_run",
            entity_id=run.id,
            meta_json={"plan_hash": run.plan_json.get("plan_hash")},
        )
    )
    db.commit()
    db.refresh(run)
    return result(request, _view(db, run))


@router.post(
    "/{run_id}/revise",
    dependencies=[Depends(require_csrf)],
    response_model=Envelope[ResearchView],
)
def revise_research(
    request: Request,
    run_id: UUID,
    revision: RevisionRequest,
    user: CurrentUser,
    db: DB,
):
    run = db.scalar(
        select(ResearchRun)
        .where(ResearchRun.id == run_id, ResearchRun.owner_id == user.id)
        .with_for_update()
    )
    if run is None:
        raise AppError(404, "RESEARCH_NOT_FOUND", "Research run not found.")
    if (
        run.status != "awaiting_approval"
        or run.plan_json.get("approval", {}).get("status") != "pending"
    ):
        raise AppError(
            409, "PLAN_NOT_REVISABLE", "Only a proposed, unapproved plan can be revised."
        )
    if int(run.plan_json.get("revision_count", 0)) >= 1:
        raise AppError(
            409, "REVISION_LIMIT_REACHED", "This plan has used its one allowed revision."
        )
    dataset, version, _ = dataset_context(db, user.id, run.dataset_version_id)
    prior_plan = run.plan_json.get("plan", {})
    run.plan_json = {
        **run.plan_json,
        "revision_count": 1,
        "plan_history": [prior_plan],
        "revision_feedback": revision.feedback.strip(),
        "revision_started_at": datetime.now(UTC).isoformat(),
    }
    run.status = "draft"
    db.commit()
    try:
        plan_json = _propose_plan(
            request.app.state.settings,
            run,
            user,
            dataset.id,
            revision.feedback.strip(),
            document_ids=[UUID(value) for value in prior_plan.get("document_ids", [])],
        )
        run.plan_json = {
            **run.plan_json,
            "plan": plan_json,
            "plan_hash": plan_digest(plan_json),
            "approval": {"status": "pending"},
            "revision_completed_at": datetime.now(UTC).isoformat(),
        }
        run.status = "awaiting_approval"
        db.add(
            AuditEvent(
                actor_id=user.id,
                event_type="research_plan_revised",
                entity_type="research_run",
                entity_id=run.id,
                meta_json={"dataset_version_id": str(version.id)},
            )
        )
    except AppError as exc:
        run.status = "failed"
        run.plan_json = {
            **run.plan_json,
            "failure": exc.message,
            "failure_code": exc.code,
            "revision_completed_at": datetime.now(UTC).isoformat(),
        }
    db.commit()
    db.refresh(run)
    return result(request, _view(db, run))


@router.post(
    "/{run_id}/start", dependencies=[Depends(require_csrf)], response_model=Envelope[ResearchView]
)
def start_research(request: Request, run_id: UUID, user: CurrentUser, db: DB):
    run = db.scalar(
        select(ResearchRun)
        .where(ResearchRun.id == run_id, ResearchRun.owner_id == user.id)
        .with_for_update()
    )
    if run is None:
        raise AppError(404, "RESEARCH_NOT_FOUND", "Research run not found.")
    if run.status in {"queued", "running", "completed"}:
        return result(request, _view(db, run))
    plan = run.plan_json.get("plan", {})
    digest = plan_digest(plan)
    if run.status != "awaiting_approval" or run.plan_json.get("approved_plan_hash") != digest:
        raise AppError(409, "PLAN_APPROVAL_REQUIRED", "Approve this exact plan before starting it.")
    if run.plan_json.get("approved_dataset_version_id") != str(run.dataset_version_id):
        raise AppError(409, "VERSION_CHANGED", "The approved dataset version changed.")
    dataset_context(db, user.id, run.dataset_version_id)
    settings = request.app.state.settings
    db.execute(select(func.pg_advisory_xact_lock(RESEARCH_START_ADVISORY_LOCK)))
    reconcile_stale_research_runs(db, settings, request.app.state.redis)
    active = db.scalar(
        select(ResearchRun.id).where(ResearchRun.status.in_(["queued", "running"])).limit(1)
    )
    if active is not None:
        raise AppError(429, "RESEARCH_BUSY", "A local research investigation is already running.")
    job_id = f"research-{run.id}"
    run.status = "queued"
    run.plan_json = {
        **run.plan_json,
        "job_id": job_id,
        "queued_at": datetime.now(UTC).isoformat(),
        "cancellation_requested": False,
    }
    db.add(
        AuditEvent(
            actor_id=user.id,
            event_type="research_run_queued",
            entity_type="research_run",
            entity_id=run.id,
            meta_json={"plan_hash": digest},
        )
    )
    db.commit()
    try:
        queue(settings, request.app.state.redis).enqueue(
            "worker.research_jobs.run_research_job",
            str(run.id),
            str(user.id),
            digest,
            job_id=job_id,
            on_failure=Callback("worker.research_jobs.research_failure"),
            job_timeout=settings.max_job_seconds,
            result_ttl=3600,
            failure_ttl=86400,
        )
    except Exception:
        run.status = "failed"
        run.plan_json = {**run.plan_json, "failure": "The research queue is unavailable."}
        db.commit()
        raise AppError(503, "QUEUE_UNAVAILABLE", "The research queue is unavailable.") from None
    db.refresh(run)
    return result(request, _view(db, run))


@router.post(
    "/{run_id}/cancel", dependencies=[Depends(require_csrf)], response_model=Envelope[ResearchView]
)
def cancel_research(request: Request, run_id: UUID, user: CurrentUser, db: DB):
    run = db.scalar(
        select(ResearchRun)
        .where(ResearchRun.id == run_id, ResearchRun.owner_id == user.id)
        .with_for_update()
    )
    if run is None:
        raise AppError(404, "RESEARCH_NOT_FOUND", "Research run not found.")
    if run.status in {"completed", "failed", "cancelled", "rejected"}:
        return result(request, _view(db, run))
    if run.status in {"draft", "awaiting_approval"}:
        run.status = "cancelled"
        run.plan_json = {**run.plan_json, "cancelled_at": datetime.now(UTC).isoformat()}
    elif run.status == "queued":
        job_id = run.plan_json.get("job_id")
        try:
            job = (
                queue(request.app.state.settings, request.app.state.redis).fetch_job(job_id)
                if job_id
                else None
            )
            if job:
                job.cancel()
        except NoSuchJobError:
            pass
        run.status = "cancelled"
        run.plan_json = {**run.plan_json, "cancelled_at": datetime.now(UTC).isoformat()}
    else:
        run.plan_json = {
            **run.plan_json,
            "cancellation_requested": True,
            "cancellation_requested_at": datetime.now(UTC).isoformat(),
        }
    db.add(
        AuditEvent(
            actor_id=user.id,
            event_type="research_run_cancel_requested",
            entity_type="research_run",
            entity_id=run.id,
            meta_json={"status": run.status},
        )
    )
    db.commit()
    db.refresh(run)
    return result(request, _view(db, run))
