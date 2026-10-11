"""Bounded, idempotent RQ jobs for Phase 4 dataset profiling."""

import hashlib
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import Dataset, DatasetProfile, DatasetVersion, StoredArtifact
from app.db.session import create_db_engine
from app.services.profiling import DatasetFileError, profile_file
from app.storage.paths import ArtifactStore


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
