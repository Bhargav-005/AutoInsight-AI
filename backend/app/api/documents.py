"""Authenticated upload, indexing lifecycle and removal for private reference documents."""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from pydantic import BaseModel, ConfigDict
from rq import Callback
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import DB, CurrentUser, Envelope, result
from app.core.errors import AppError
from app.core.security import require_csrf, require_upload_csrf
from app.db.models import AuditEvent, Dataset, DatasetDocument, DocumentChunk, StoredArtifact
from app.services.documents import (
    DocumentProcessingError,
    safe_source_filename,
    validate_document_upload,
)
from app.services.job_recovery import abandoned_job
from app.storage.paths import ArtifactStore
from worker.connection import queue

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])


class DocumentView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    source_filename: str
    file_type: str
    status: str
    page_count: int | None
    chunk_count: int
    processing_error: str | None
    embedding_model: str | None
    embedding_dimensions: int | None
    created_at: datetime
    size_bytes: int


def _view(db: Session, document: DatasetDocument) -> DocumentView:
    artifact = db.scalar(
        select(StoredArtifact).where(
            StoredArtifact.id == document.source_artifact_id,
            StoredArtifact.owner_id == document.owner_id,
        )
    )
    return DocumentView(
        id=document.id,
        title=document.title,
        source_filename=document.source_filename,
        file_type=document.file_type,
        status=document.status,
        page_count=document.page_count,
        chunk_count=document.chunk_count,
        processing_error=document.processing_error,
        embedding_model=document.embedding_model,
        embedding_dimensions=document.embedding_dimensions,
        created_at=document.created_at,
        size_bytes=artifact.size_bytes if artifact else 0,
    )


def _queue_index(request: Request, db: Session, document: DatasetDocument):
    settings = request.app.state.settings
    try:
        if request.app.state.redis is None:
            raise RuntimeError("queue unavailable")
        queue(settings, request.app.state.redis).enqueue(
            "worker.document_jobs.index_document",
            str(document.id),
            str(document.owner_id),
            document.attempt_count,
            job_id=document.job_id,
            on_failure=Callback("worker.document_jobs.document_failure"),
            job_timeout=settings.max_job_seconds,
            result_ttl=3600,
            failure_ttl=86400,
        )
    except Exception:
        document.status = "failed"
        document.processing_error = "The document worker queue is unavailable. Retry indexing."
        db.commit()


@router.get("", response_model=Envelope[list[DocumentView]])
def list_documents(request: Request, user: CurrentUser, db: DB):
    documents = db.scalars(
        select(DatasetDocument)
        .where(DatasetDocument.owner_id == user.id)
        .order_by(DatasetDocument.created_at.desc(), DatasetDocument.id)
        .limit(100)
    ).all()
    for document in documents:
        _recover_document(request, db, document)
    return result(request, [_view(db, document) for document in documents])


def _recover_document(request, db, document):
    if document.status not in {"queued", "processing"}:
        return
    if not abandoned_job(
        document.job_id,
        document.processing_started_at or document.created_at,
        request.app.state.settings,
        request.app.state.redis,
    ):
        return
    # Lock and re-check after inspecting RQ: completion/reindex may have raced this read.
    current = db.scalar(
        select(DatasetDocument)
        .where(
            DatasetDocument.id == document.id,
            DatasetDocument.owner_id == document.owner_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if current.status in {"queued", "processing"} and abandoned_job(
        current.job_id,
        current.processing_started_at or current.created_at,
        request.app.state.settings,
        request.app.state.redis,
    ):
        current.status = "failed"
        current.processing_error = "Document indexing was interrupted. Retry indexing."
        current.processing_started_at = None
        db.add(
            AuditEvent(
                actor_id=current.owner_id,
                event_type="document_job_abandoned",
                entity_type="dataset_document",
                entity_id=current.id,
                meta_json={},
            )
        )
    db.commit()


@router.post(
    "",
    status_code=201,
    dependencies=[Depends(require_upload_csrf)],
    response_model=Envelope[DocumentView],
)
async def upload_document(
    request: Request,
    user: CurrentUser,
    db: DB,
    file: Annotated[UploadFile, File()],
    dataset_id: Annotated[UUID | None, Form()] = None,
):
    settings = request.app.state.settings
    raw = await file.read(settings.max_document_bytes + 1)
    await file.close()
    try:
        filename = safe_source_filename(file.filename)
        file_type = validate_document_upload(raw, filename, settings)
    except DocumentProcessingError as exc:
        raise AppError(422, "INVALID_DOCUMENT", str(exc)) from None
    if (
        dataset_id is not None
        and db.scalar(
            select(Dataset.id).where(Dataset.id == dataset_id, Dataset.owner_id == user.id)
        )
        is None
    ):
        raise AppError(404, "DATASET_NOT_FOUND", "Dataset not found.")

    store = ArtifactStore(settings.file_storage_root)
    suffix = filename.rsplit(".", maxsplit=1)[-1].casefold()
    stored = store.write(raw, suffix)
    artifact = StoredArtifact(
        owner_id=user.id,
        relative_path=stored["reference"],
        mime_type=file_type,
        size_bytes=len(raw),
        sha256=stored["sha256"],
    )
    db.add(artifact)
    db.flush()
    document = DatasetDocument(
        owner_id=user.id,
        dataset_id=dataset_id,
        title=filename[:255],
        source_filename=filename,
        file_type=file_type,
        status="queued",
        page_count=None,
        chunk_count=0,
        source_artifact_id=artifact.id,
        job_id=None,
        attempt_count=1,
        processing_started_at=None,
    )
    db.add(document)
    try:
        db.flush()
        document.job_id = f"document-index-{document.id}-{document.attempt_count}"
        db.add(
            AuditEvent(
                actor_id=user.id,
                event_type="reference_document_uploaded",
                entity_type="dataset_document",
                entity_id=document.id,
                meta_json={"file_type": file_type, "size_bytes": len(raw)},
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        store.delete(stored["reference"])
        raise AppError(
            503, "DOCUMENT_SAVE_FAILED", "The document could not be saved safely."
        ) from None
    db.refresh(document)
    _queue_index(request, db, document)
    db.refresh(document)
    return result(request, _view(db, document))


@router.post("/{document_id}/reindex", dependencies=[Depends(require_csrf)])
def reindex_document(request: Request, document_id: UUID, user: CurrentUser, db: DB):
    document = db.scalar(
        select(DatasetDocument)
        .where(DatasetDocument.id == document_id, DatasetDocument.owner_id == user.id)
        .with_for_update()
    )
    if document is None:
        raise AppError(404, "DOCUMENT_NOT_FOUND", "Document not found.")
    if document.status not in {"failed", "removed"}:
        raise AppError(
            409, "DOCUMENT_NOT_REINDEXABLE", "Only failed or removed documents can be indexed."
        )
    document.attempt_count += 1
    document.status = "queued"
    document.processing_error = None
    document.processing_started_at = datetime.now(UTC)
    document.job_id = f"document-index-{document.id}-{document.attempt_count}"
    db.add(
        AuditEvent(
            actor_id=user.id,
            event_type="reference_document_reindex_queued",
            entity_type="dataset_document",
            entity_id=document.id,
            meta_json={"attempt": document.attempt_count},
        )
    )
    db.commit()
    _queue_index(request, db, document)
    db.refresh(document)
    return result(request, _view(db, document))


@router.post("/{document_id}/remove", dependencies=[Depends(require_csrf)])
def remove_document_from_index(request: Request, document_id: UUID, user: CurrentUser, db: DB):
    document = db.scalar(
        select(DatasetDocument)
        .where(DatasetDocument.id == document_id, DatasetDocument.owner_id == user.id)
        .with_for_update()
    )
    if document is None:
        raise AppError(404, "DOCUMENT_NOT_FOUND", "Document not found.")
    if document.status in {"queued", "processing"}:
        raise AppError(
            409, "DOCUMENT_BUSY", "Wait until document processing finishes before removal."
        )
    db.query(DocumentChunk).filter(DocumentChunk.document_id == document.id).delete(
        synchronize_session=False
    )
    document.status = "removed"
    document.chunk_count = 0
    document.embedding_model = None
    document.embedding_dimensions = None
    document.processing_error = None
    db.add(
        AuditEvent(
            actor_id=user.id,
            event_type="reference_document_removed_from_index",
            entity_type="dataset_document",
            entity_id=document.id,
            meta_json={},
        )
    )
    db.commit()
    db.refresh(document)
    return result(request, _view(db, document))
