"""Authenticated owner-scoped supervised ML experiments and predictions."""

import hashlib
import io
from datetime import UTC, datetime
from uuid import UUID

import joblib
import sklearn
from fastapi import APIRouter, Depends, Query, Request
from rq.job import Job
from sqlalchemy import func, select, text

from app.api.auth import DB, CurrentUser, Envelope, result
from app.api.phase5 import _owned
from app.core.errors import AppError
from app.core.security import require_csrf
from app.db.models import DatasetProfile, MLRun, Prediction, StoredArtifact
from app.services import ml
from app.services.ml_contracts import (
    CompareRequest,
    MetadataView,
    PredictionView,
    PredictRequest,
    RunView,
    TrainConfig,
)
from app.storage.paths import ArtifactStore
from worker.connection import queue

router = APIRouter(prefix="/api/v1", tags=["machine learning"])
ACTIVE = {"queued", "running"}


def owned_run(db, user_id, run_id, *, lock=False):
    query = select(MLRun).where(MLRun.id == run_id, MLRun.owner_id == user_id)
    run = db.scalar(query.with_for_update() if lock else query)
    if run is None:
        raise AppError(404, "MODEL_NOT_FOUND", "Experiment not found.")
    return run


def reconcile(request, db, run):
    if run.status not in ACTIVE:
        return
    age = (datetime.now(UTC) - (run.started_at or run.created_at)).total_seconds()
    failed = age > (
        request.app.state.settings.max_job_seconds + 120 if run.status == "running" else 3600
    )
    try:
        if run.job_id and request.app.state.redis is not None:
            status = Job.fetch(run.job_id, connection=request.app.state.redis).get_status()
            failed = failed or status in {"failed", "stopped", "canceled"}
    except Exception:
        # Queue outages do not invent success or prematurely terminate durable work.
        pass
    if failed:
        # A concurrent completed transaction must win over this stale status snapshot.
        db.refresh(run, with_for_update=True)
        if run.status in ACTIVE:
            run.status = "failed"
            run.error_message = (
                "Training was interrupted or timed out. You can retry this experiment."
            )
            run.completed_at = datetime.now(UTC)
            db.commit()


def view(run):
    return {
        "id": run.id,
        "dataset_version_id": run.dataset_version_id,
        "task_type": run.task_type,
        "target_column": run.target_column,
        "status": run.status,
        "config": run.config_json,
        "job_id": run.job_id,
        "attempt_count": run.attempt_count,
        "error_message": run.error_message,
        "created_at": run.created_at,
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        "evaluation": run.result_json,
        "model_available": run.status == "completed" and run.model_artifact_id is not None,
    }


def enqueue(request, db, run):
    # Serialize admission across API processes; actual execution is the single Linux worker.
    db.execute(text("SELECT pg_advisory_xact_lock(601006)"))
    total = db.scalar(select(func.count()).select_from(MLRun).where(MLRun.status.in_(ACTIVE)))
    owned = db.scalar(
        select(func.count())
        .select_from(MLRun)
        .where(MLRun.status.in_(ACTIVE), MLRun.owner_id == run.owner_id)
    )
    if total >= 4 or owned >= 2:
        raise AppError(
            429, "TRAINING_BUSY", "Training queue is full. Wait for an active experiment to finish."
        )
    run.status = "queued"
    run.attempt_count += 1
    run.job_id = f"ml-{run.id}-{run.attempt_count}"
    run.started_at = None
    run.completed_at = None
    run.error_message = None
    db.commit()
    try:
        connection = request.app.state.redis
        if connection is None:
            raise RuntimeError("queue unavailable")
        queue(request.app.state.settings, connection).enqueue(
            "worker.ml_jobs.train_model",
            str(run.id),
            run.attempt_count,
            job_id=run.job_id,
            job_timeout=min(600, request.app.state.settings.max_job_seconds),
            ttl=3600,
            result_ttl=3600,
            failure_ttl=86400,
        )
    except Exception:
        run.status = "failed"
        run.error_message = (
            "Training queue is unavailable. Retry this experiment when the worker is ready."
        )
        run.completed_at = datetime.now(UTC)
        db.commit()
    return view(run)


@router.get(
    "/datasets/{dataset_id}/versions/{version_id}/ml", response_model=Envelope[MetadataView]
)
def metadata(request: Request, dataset_id: UUID, version_id: UUID, user: CurrentUser, db: DB):
    _owned(db, user.id, dataset_id, version_id)
    profile = db.scalar(
        select(DatasetProfile).where(DatasetProfile.dataset_version_id == version_id)
    )
    if profile is None:
        raise AppError(409, "PROFILE_UNAVAILABLE", "Wait for the dataset profile to complete.")
    return result(
        request,
        {
            "dataset_id": dataset_id,
            "dataset_version_id": version_id,
            "row_count": profile.row_count,
            "columns": ml.columns_from_profile(profile.profile_json),
            "algorithms": ml.ALGORITHMS,
            "warnings": [
                "Select features available at prediction time. Identifier columns "
                "are excluded by default.",
                "Dates, free text and grouped/time-dependent evaluation are unsupported.",
                "Maximum 30 features, 100 categories per feature, 50,000 rows and "
                "1,000,000 selected feature cells.",
            ],
        },
    )


@router.post(
    "/ml-runs",
    status_code=202,
    dependencies=[Depends(require_csrf)],
    response_model=Envelope[RunView],
)
def create_run(request: Request, payload: TrainConfig, user: CurrentUser, db: DB):
    frame, columns, _ = ml.load_source(
        db, request.app.state.settings, user.id, payload.dataset_version_id, payload.dataset_id
    )
    ml.prepare(frame, columns, payload)
    run = MLRun(
        owner_id=user.id,
        dataset_version_id=payload.dataset_version_id,
        task_type=payload.task_type,
        target_column=payload.target_column,
        status="created",
        config_json=payload.model_dump(mode="json"),
    )
    db.add(run)
    db.flush()
    return result(request, enqueue(request, db, run))


@router.get("/ml-runs", response_model=Envelope[list[RunView]])
def list_runs(
    request: Request,
    user: CurrentUser,
    db: DB,
    dataset_id: UUID,
    limit: int = Query(default=50, ge=1, le=100),
):
    runs = db.scalars(
        select(MLRun)
        .where(MLRun.owner_id == user.id, MLRun.config_json["dataset_id"].astext == str(dataset_id))
        .order_by(MLRun.created_at.desc())
        .limit(limit)
    ).all()
    for run in runs:
        reconcile(request, db, run)
    return result(request, [view(run) for run in runs])


@router.post(
    "/ml-runs/compare", dependencies=[Depends(require_csrf)], response_model=Envelope[list[RunView]]
)
def compare(request: Request, payload: CompareRequest, user: CurrentUser, db: DB):
    if len(set(payload.run_ids)) != len(payload.run_ids):
        raise AppError(422, "INVALID_COMPARISON", "Choose distinct experiments.")
    runs = [owned_run(db, user.id, key) for key in payload.run_ids]
    first = runs[0]
    for run in runs:
        if run.status != "completed" or not run.result_json:
            raise AppError(409, "MODEL_NOT_READY", "Only completed experiments can be compared.")
        if (
            run.dataset_version_id,
            run.target_column,
            run.task_type,
            run.result_json["split_fingerprint"],
            run.result_json["source_checksum"],
        ) != (
            first.dataset_version_id,
            first.target_column,
            first.task_type,
            first.result_json["split_fingerprint"],
            first.result_json["source_checksum"],
        ):
            raise AppError(
                422,
                "INCOMPATIBLE_EXPERIMENTS",
                "Compare the same dataset version, target, task and held-out split.",
            )
    return result(request, [view(run) for run in runs])


@router.get("/ml-runs/{run_id}", response_model=Envelope[RunView])
def get_run(request: Request, run_id: UUID, user: CurrentUser, db: DB):
    run = owned_run(db, user.id, run_id)
    reconcile(request, db, run)
    return result(request, view(run))


@router.post(
    "/ml-runs/{run_id}/retry",
    status_code=202,
    dependencies=[Depends(require_csrf)],
    response_model=Envelope[RunView],
)
def retry(request: Request, run_id: UUID, user: CurrentUser, db: DB):
    run = owned_run(db, user.id, run_id, lock=True)
    if run.status != "failed" or run.model_artifact_id or run.attempt_count >= 3:
        raise AppError(
            409,
            "RETRY_UNAVAILABLE",
            "Only failed experiments without models can retry, up to three attempts.",
        )
    return result(request, enqueue(request, db, run))


def prediction_view(row):
    return {
        "id": row.id,
        "ml_run_id": row.ml_run_id,
        "created_at": row.created_at,
        **row.output_json,
    }


@router.post(
    "/ml-runs/{run_id}/predict",
    dependencies=[Depends(require_csrf)],
    response_model=Envelope[PredictionView],
)
def predict(request: Request, run_id: UUID, payload: PredictRequest, user: CurrentUser, db: DB):
    run = owned_run(db, user.id, run_id)
    if run.status != "completed" or not run.model_artifact_id or not run.result_json:
        raise AppError(
            409, "MODEL_NOT_READY", "Predictions require a successfully completed experiment."
        )
    artifact = db.scalar(
        select(StoredArtifact).where(
            StoredArtifact.id == run.model_artifact_id, StoredArtifact.owner_id == user.id
        )
    )
    if artifact is None or artifact.mime_type != "application/x-autoinsight-model":
        raise AppError(409, "MODEL_UNAVAILABLE", "Trusted model artifact is unavailable.")
    try:
        path = ArtifactStore(request.app.state.settings.file_storage_root).resolve(
            artifact.relative_path
        )
        if (
            path.suffix != ".joblib"
            or path.stat().st_size != artifact.size_bytes
            or artifact.size_bytes > ml.MAX_MODEL_BYTES
        ):
            raise ValueError("size")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != artifact.sha256:
            raise ValueError("checksum")
        if run.result_json["package_versions"]["scikit-learn"] != sklearn.__version__:
            raise ValueError("version")
        # No upload or client path reaches this loader. Deserialize these exact verified bytes.
        pipeline = joblib.load(io.BytesIO(data))
    except Exception:
        raise AppError(
            409,
            "MODEL_UNAVAILABLE",
            "Model integrity or runtime version check failed. Retrain with "
            "the current environment.",
        ) from None
    try:
        output = ml.predict(pipeline, run.result_json["inputs"], payload.values)
    except (ValueError, OverflowError):
        raise AppError(
            422, "INVALID_PREDICTION", "The model cannot predict these feature values."
        ) from None
    row = Prediction(owner_id=user.id, ml_run_id=run.id, input_json=None, output_json=output)
    db.add(row)
    db.commit()
    db.refresh(row)
    return result(request, prediction_view(row))


@router.get("/ml-runs/{run_id}/predictions", response_model=Envelope[list[PredictionView]])
def predictions(request: Request, run_id: UUID, user: CurrentUser, db: DB):
    owned_run(db, user.id, run_id)
    rows = db.scalars(
        select(Prediction)
        .where(Prediction.ml_run_id == run_id, Prediction.owner_id == user.id)
        .order_by(Prediction.created_at.desc())
        .limit(50)
    ).all()
    return result(request, [prediction_view(row) for row in rows])
