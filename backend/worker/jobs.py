"""Bounded, idempotent RQ jobs for Phase 4 dataset profiling."""

import hashlib
import os
import tempfile
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import CleaningPlan, Dataset, DatasetProfile, DatasetVersion, StoredArtifact
from app.db.session import create_db_engine
from app.services.cleaning import apply_operations, read_frame, write_cleaned_csv
from app.services.profiling import DatasetFileError, profile_file
from app.storage.paths import ArtifactStore


def _checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def apply_cleaning_plan(plan_id: str, attempt: int) -> dict:
    """Create one immutable cleaned version for an approved plan attempt."""
    settings = Settings()
    engine = create_db_engine(settings, runtime=True)
    root = Path(settings.file_storage_root)
    temporary = None
    finalized = None
    try:
        with Session(engine) as db, db.begin():
            plan = db.scalar(
                select(CleaningPlan).where(CleaningPlan.id == UUID(plan_id)).with_for_update()
            )
            if plan is None:
                return {"status": "missing"}
            if plan.state == "completed":
                return {"status": "completed", "version_id": str(plan.result_version_id)}
            if (
                plan.state != "queued"
                or plan.attempt_count != attempt
                or plan.approved_by != plan.owner_id
            ):
                return {"status": "stale"}
            version = db.scalar(
                select(DatasetVersion).where(
                    DatasetVersion.id == plan.dataset_version_id,
                    DatasetVersion.owner_id == plan.owner_id,
                )
            )
            dataset = (
                db.scalar(
                    select(Dataset).where(
                        Dataset.id == version.dataset_id,
                        Dataset.owner_id == plan.owner_id,
                    )
                )
                if version
                else None
            )
            artifact = (
                db.scalar(
                    select(StoredArtifact).where(
                        StoredArtifact.id == version.artifact_id,
                        StoredArtifact.owner_id == plan.owner_id,
                    )
                )
                if version
                else None
            )
            if dataset is None or version is None or artifact is None:
                plan.state = "failed"
                plan.error_message = "The selected source version is unavailable."
                return {"status": "failed"}
            plan.state = "running"
            plan.error_message = None
            plan_data = list(plan.operations_json)
            owner_id = plan.owner_id
            source_dataset_id = dataset.id
            source_version_id = version.id
            source_version_no = version.version_no
            source_reference = artifact.relative_path
            source_checksum = artifact.sha256
            source_mime = artifact.mime_type
            selected_sheet = dataset.selected_sheet if version.version_no == 1 else None
        store = ArtifactStore(root)
        source_path = store.resolve(source_reference)
        if _checksum(source_path) != source_checksum:
            raise RuntimeError("The source version failed integrity verification.")
        source_format = "xlsx" if source_mime.endswith("spreadsheetml.sheet") else "csv"
        frame, headers = read_frame(
            source_path,
            source_format,
            selected_sheet,
            settings.max_dataset_columns,
            settings.max_dataset_rows,
        )
        if len(frame) > settings.max_dataset_rows:
            raise RuntimeError("The source version exceeds the processing row limit.")
        cleaned, _ = apply_operations(frame, plan_data)
        reference = f"{uuid4().hex}.csv"
        final_path = store.resolve(reference)
        with tempfile.NamedTemporaryFile(
            mode="wb", prefix=".clean-", suffix=".csv.part", dir=root, delete=False
        ) as stream:
            temporary = Path(stream.name)
        write_cleaned_csv(temporary, cleaned, headers)
        size = temporary.stat().st_size
        if size > settings.max_upload_bytes:
            raise RuntimeError("The cleaned version exceeds the artifact size limit.")
        checksum = _checksum(temporary)
        profile = profile_file(
            temporary, "csv", None, settings.max_dataset_rows, settings.max_dataset_columns
        )
        os.link(temporary, final_path)
        finalized = final_path
        temporary.unlink()
        temporary = None
        with Session(engine) as db, db.begin():
            dataset = db.scalar(
                select(Dataset)
                .where(
                    Dataset.id == source_dataset_id,
                    Dataset.owner_id == owner_id,
                )
                .with_for_update()
            )
            plan = db.scalar(
                select(CleaningPlan)
                .where(
                    CleaningPlan.id == UUID(plan_id),
                    CleaningPlan.owner_id == owner_id,
                )
                .with_for_update()
            )
            if dataset is None or plan is None:
                raise RuntimeError("The approved plan is no longer available.")
            if plan.state == "completed":
                return {"status": "completed", "version_id": str(plan.result_version_id)}
            if plan.state != "running" or plan.attempt_count != attempt:
                raise RuntimeError("The approved cleaning attempt is no longer current.")
            next_version = (
                db.scalar(
                    select(func.max(DatasetVersion.version_no)).where(
                        DatasetVersion.dataset_id == source_dataset_id,
                        DatasetVersion.owner_id == owner_id,
                    )
                )
                or source_version_no
            ) + 1
            new_artifact = StoredArtifact(
                owner_id=owner_id,
                relative_path=reference,
                mime_type="text/csv",
                size_bytes=size,
                sha256=checksum,
            )
            db.add(new_artifact)
            db.flush()
            result_version = DatasetVersion(
                owner_id=owner_id,
                dataset_id=source_dataset_id,
                parent_version_id=source_version_id,
                artifact_id=new_artifact.id,
                version_no=next_version,
                kind="cleaned",
            )
            db.add(result_version)
            db.flush()
            db.add(
                DatasetProfile(
                    dataset_version_id=result_version.id,
                    row_count=profile["row_count"],
                    column_count=profile["column_count"],
                    profile_json=profile,
                )
            )
            plan.result_version_id = result_version.id
            plan.state = "completed"
            plan.error_message = None
            result_id = result_version.id
        finalized = None
        return {"status": "completed", "version_id": str(result_id)}
    except Exception:
        if finalized:
            finalized.unlink(missing_ok=True)
        try:
            with Session(engine) as db, db.begin():
                plan = db.scalar(
                    select(CleaningPlan).where(CleaningPlan.id == UUID(plan_id)).with_for_update()
                )
                if plan is not None and plan.state != "completed" and plan.attempt_count == attempt:
                    plan.state = "failed"
                    plan.error_message = "Cleaning failed safely. Review the plan and retry."
        except Exception:
            pass
        raise RuntimeError("Cleaning failed safely") from None
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)
        engine.dispose()


def profile_dataset(dataset_id: str) -> dict:
    settings = Settings()
    engine = create_db_engine(settings, runtime=True)
    root = Path(settings.file_storage_root)
    try:
        with Session(engine) as db, db.begin():
            dataset = db.scalar(
                select(Dataset).where(Dataset.id == UUID(dataset_id)).with_for_update()
            )
            if dataset is None:
                return {"status": "missing"}
            version = db.scalar(
                select(DatasetVersion).where(
                    DatasetVersion.dataset_id == dataset.id,
                    DatasetVersion.owner_id == dataset.owner_id,
                    DatasetVersion.version_no == 1,
                    DatasetVersion.kind == "raw",
                )
            )
            artifact = (
                db.scalar(
                    select(StoredArtifact).where(
                        StoredArtifact.id == version.artifact_id,
                        StoredArtifact.owner_id == dataset.owner_id,
                    )
                )
                if version
                else None
            )
            existing = (
                db.scalar(
                    select(DatasetProfile).where(DatasetProfile.dataset_version_id == version.id)
                )
                if version
                else None
            )
            if version is None or artifact is None:
                dataset.status = "failed"
                dataset.processing_error = "The original dataset artifact is unavailable."
                return {"status": "failed"}
            if dataset.status == "ready" and existing is not None:
                return {"status": "ready", "row_count": existing.row_count}
            if dataset.status == "processing":
                return {"status": "already_processing"}
            dataset.status = "processing"
            dataset.processing_error = None
            reference = artifact.relative_path
            checksum = artifact.sha256
            source_format = dataset.source_format
            selected_sheet = dataset.selected_sheet
            version_id = version.id

        path = ArtifactStore(root).resolve(reference)
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            while block := stream.read(1024 * 1024):
                digest.update(block)
        if digest.hexdigest() != checksum:
            raise DatasetFileError(
                "ARTIFACT_CHECKSUM_MISMATCH", "The immutable source checksum did not match."
            )
        profile = profile_file(
            path,
            source_format,
            selected_sheet,
            settings.max_dataset_rows,
            settings.max_dataset_columns,
        )
        with Session(engine) as db, db.begin():
            dataset = db.scalar(
                select(Dataset).where(Dataset.id == UUID(dataset_id)).with_for_update()
            )
            if dataset is None:
                return {"status": "missing"}
            existing = db.scalar(
                select(DatasetProfile).where(DatasetProfile.dataset_version_id == version_id)
            )
            if existing is None:
                db.add(
                    DatasetProfile(
                        dataset_version_id=version_id,
                        row_count=profile["row_count"],
                        column_count=profile["column_count"],
                        profile_json=profile,
                    )
                )
            else:
                existing.row_count = profile["row_count"]
                existing.column_count = profile["column_count"]
                existing.profile_json = profile
            dataset.status = "ready"
            dataset.selected_sheet = profile.get("selected_sheet")
            dataset.processing_error = None
        return {
            "status": "ready",
            "row_count": profile["row_count"],
            "column_count": profile["column_count"],
        }
    except Exception as exc:
        safe_message = (
            str(exc)
            if isinstance(exc, DatasetFileError)
            else "Dataset profiling failed. Check the file and retry."
        )
        try:
            with Session(engine) as db, db.begin():
                dataset = db.scalar(
                    select(Dataset).where(Dataset.id == UUID(dataset_id)).with_for_update()
                )
                if dataset is not None and dataset.status != "ready":
                    dataset.status = "failed"
                    dataset.processing_error = safe_message[:300]
        except Exception:
            pass
        raise RuntimeError("Dataset profiling failed safely") from None
    finally:
        engine.dispose()
