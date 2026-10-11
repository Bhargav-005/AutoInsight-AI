"""Idempotent bounded ML job; only application-generated artifacts are persisted."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError
from app.db.models import MLRun, ModelMetric, StoredArtifact, User
from app.db.session import create_db_engine
from app.services import ml
from app.services.ml_contracts import Evaluation, TrainConfig
from app.storage.paths import ArtifactStore


def mark_failed(
    run_id, attempt, message="Training failed safely. Review the configuration before retrying."
):
    engine = create_db_engine(Settings(), runtime=True)
    try:
        with Session(engine) as db, db.begin():
            run = db.scalar(select(MLRun).where(MLRun.id == UUID(run_id)).with_for_update())
            if run and run.attempt_count == attempt and run.status in {"queued", "running"}:
                run.status = "failed"
                run.error_message = message
                run.completed_at = datetime.now(UTC)
    finally:
        engine.dispose()


def train_model(run_id: str, attempt: int):
    settings = Settings()
    engine = create_db_engine(settings, runtime=True)
    reference = None
    try:
        with Session(engine) as db, db.begin():
            run = db.scalar(select(MLRun).where(MLRun.id == UUID(run_id)).with_for_update())
            if run is None or run.attempt_count != attempt or run.status != "queued":
                return {"status": "stale_or_completed"}
            if not db.scalar(
                select(User.id).where(User.id == run.owner_id, User.is_active.is_(True))
            ):
                raise RuntimeError("owner unavailable")
            run.status = "running"
            run.started_at = datetime.now(UTC)
            owner_id = run.owner_id
            config = TrainConfig.model_validate(run.config_json)
        with Session(engine) as db:
            frame, columns, checksum = ml.load_source(
                db, settings, owner_id, config.dataset_version_id, config.dataset_id
            )
        pipeline, evaluation = ml.train(frame, columns, config, checksum)
        evaluation = Evaluation.model_validate(evaluation).model_dump(mode="json")
        data = ml.serialize(pipeline)
        store = ArtifactStore(settings.file_storage_root)
        saved = store.write(data, "joblib")
        reference = saved["reference"]
        with Session(engine) as db, db.begin():
            run = db.scalar(
                select(MLRun)
                .where(MLRun.id == UUID(run_id), MLRun.owner_id == owner_id)
                .with_for_update()
            )
            if run is None or run.status != "running" or run.attempt_count != attempt:
                raise RuntimeError("stale attempt")
            artifact = StoredArtifact(
                owner_id=owner_id,
                relative_path=reference,
                mime_type="application/x-autoinsight-model",
                size_bytes=len(data),
                sha256=saved["sha256"],
            )
            db.add(artifact)
            db.flush()
            run.model_artifact_id = artifact.id
            run.result_json = evaluation
            for split, values in (
                ("test", evaluation["metrics"]),
                ("baseline", evaluation["baseline"]),
            ):
                for name, value in values.items():
                    if value is not None:
                        db.add(
                            ModelMetric(
                                ml_run_id=run.id,
                                dataset_split=split,
                                metric_name=name,
                                metric_value=value,
                                metadata_json={
                                    "split_fingerprint": evaluation["split_fingerprint"]
                                },
                            )
                        )
            run.status = "completed"
            run.completed_at = datetime.now(UTC)
            run.error_message = None
        reference = None
        return {"status": "completed", "run_id": run_id}
    except Exception as exc:
        if reference:
            ArtifactStore(settings.file_storage_root).delete(reference)
        mark_failed(
            run_id,
            attempt,
            exc.message
            if isinstance(exc, AppError)
            else "Training failed safely. Review the configuration before retrying.",
        )
        raise RuntimeError("ML training failed safely") from None
    finally:
        engine.dispose()
