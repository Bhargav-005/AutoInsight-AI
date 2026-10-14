"""Idempotent background extraction, embedding and vector persistence."""

import hashlib
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError
from app.db.models import AuditEvent, DatasetDocument, DocumentChunk, StoredArtifact
from app.db.session import create_db_engine
from app.services.documents import DocumentProcessingError, chunk_segments, extract_document
from app.services.embeddings import embed_texts
from app.storage.paths import ArtifactStore


def _set_failed(document_id: str, owner_id: str, attempt: int, message: str):
    engine = create_db_engine(Settings(), runtime=True)
    try:
        with Session(engine) as db, db.begin():
            document = db.scalar(
                select(DatasetDocument)
                .where(
                    DatasetDocument.id == UUID(document_id),
                    DatasetDocument.owner_id == UUID(owner_id),
                    DatasetDocument.attempt_count == attempt,
                    DatasetDocument.status.in_(("queued", "processing")),
                )
                .with_for_update()
            )
            if document is not None:
                document.status = "failed"
                document.processing_error = message[:300]
                document.processing_started_at = None
                db.add(
                    AuditEvent(
                        actor_id=document.owner_id,
                        event_type="reference_document_index_failed",
                        entity_type="dataset_document",
                        entity_id=document.id,
                        meta_json={"attempt": attempt},
                    )
                )
    finally:
        engine.dispose()


def index_document(document_id: str, owner_id: str, attempt: int) -> dict:
    settings = Settings()
    engine = create_db_engine(settings, runtime=True)
    try:
        with Session(engine) as db, db.begin():
            document = db.scalar(
                select(DatasetDocument)
                .where(
                    DatasetDocument.id == UUID(document_id),
                    DatasetDocument.owner_id == UUID(owner_id),
                    DatasetDocument.attempt_count == attempt,
                    DatasetDocument.status == "queued",
                )
                .with_for_update()
            )
            if document is None:
                return {"status": "stale"}
            artifact = db.scalar(
                select(StoredArtifact).where(
                    StoredArtifact.id == document.source_artifact_id,
                    StoredArtifact.owner_id == document.owner_id,
                )
            )
            if artifact is None:
                document.status = "failed"
                document.processing_error = "The source document is unavailable."
                return {"status": "failed"}
            document.status = "processing"
            document.processing_started_at = datetime.now(UTC)
            reference, expected_hash, expected_size, filename = (
                artifact.relative_path,
                artifact.sha256,
                artifact.size_bytes,
                document.source_filename,
            )
    finally:
        engine.dispose()

    try:
        path = ArtifactStore(settings.file_storage_root).resolve(reference)
        if path.stat().st_size != expected_size or expected_size > settings.max_document_bytes:
            raise DocumentProcessingError("The stored document failed integrity verification.")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected_hash:
            raise DocumentProcessingError("The stored document failed integrity verification.")
        file_type, page_count, segments = extract_document(data, filename, settings)
        chunks = chunk_segments(
            segments, settings.document_chunk_chars, settings.document_chunk_overlap
        )
        if not chunks:
            raise DocumentProcessingError("No usable text chunks were produced for this document.")
        vectors = embed_texts(settings, [chunk["content"] for chunk in chunks])
        if len(vectors) != len(chunks):
            raise AppError(
                503, "EMBEDDING_FAILED", "The embedding model returned an incomplete batch."
            )

        engine = create_db_engine(settings, runtime=True)
        try:
            with Session(engine) as db, db.begin():
                document = db.scalar(
                    select(DatasetDocument)
                    .where(
                        DatasetDocument.id == UUID(document_id),
                        DatasetDocument.owner_id == UUID(owner_id),
                        DatasetDocument.attempt_count == attempt,
                        DatasetDocument.status == "processing",
                    )
                    .with_for_update()
                )
                if document is None:
                    return {"status": "stale"}
                db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document.id))
                db.add_all(
                    [
                        DocumentChunk(
                            document_id=document.id,
                            chunk_index=index,
                            content=chunk["content"],
                            embedding=vector,
                            page_number=chunk["page_number"],
                            location=chunk["location"],
                            metadata_json={
                                "source_sha256": expected_hash,
                                "embedding_model": settings.rag_embedding_model,
                                "embedding_dimensions": settings.rag_embedding_dimensions,
                            },
                        )
                        for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True))
                    ]
                )
                document.file_type = file_type
                document.page_count = page_count
                document.chunk_count = len(chunks)
                document.embedding_model = settings.rag_embedding_model
                document.embedding_dimensions = settings.rag_embedding_dimensions
                document.processing_error = None
                document.processing_started_at = None
                document.status = "indexed"
                db.add(
                    AuditEvent(
                        actor_id=document.owner_id,
                        event_type="reference_document_indexed",
                        entity_type="dataset_document",
                        entity_id=document.id,
                        meta_json={"chunk_count": len(chunks), "page_count": page_count},
                    )
                )
        finally:
            engine.dispose()
        return {"status": "indexed", "chunk_count": len(chunks)}
    except DocumentProcessingError as exc:
        message = str(exc)
    except AppError as exc:
        message = (
            "The local embedding model is unavailable. Check Ollama and the configured model."
            if exc.code == "EMBEDDING_UNAVAILABLE"
            else "The local embedding model returned an incompatible vector size."
            if exc.code == "EMBEDDING_DIMENSION_MISMATCH"
            else "Document indexing could not complete safely."
        )
    except Exception:
        message = "Document indexing failed safely. Retry indexing or check service status."
    _set_failed(document_id, owner_id, attempt, message)
    return {"status": "failed"}


def document_failure(job, connection, exc_type, exc_value, traceback):
    if not job or len(job.args or ()) < 3:
        return
    document_id, owner_id, attempt = job.args[:3]
    _set_failed(
        document_id,
        owner_id,
        int(attempt),
        "Document indexing stopped unexpectedly. Retry indexing.",
    )
