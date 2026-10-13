"""Owner-scoped cosine search over persisted document chunk vectors."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models import DatasetDocument, DocumentChunk, StoredArtifact
from app.services.embeddings import embed_texts


def search_documents(
    db: Session,
    settings,
    owner_id: UUID,
    query: str,
    document_ids: list[UUID] | None = None,
    top_k: int = 5,
) -> list[dict]:
    query = " ".join(query.split())
    if not 3 <= len(query) <= 500:
        raise AppError(422, "INVALID_SEARCH_QUERY", "Enter a search question under 500 characters.")
    if not 1 <= top_k <= 10:
        raise AppError(422, "INVALID_TOP_K", "Search can return between 1 and 10 passages.")
    if document_ids is not None and not 1 <= len(document_ids) <= 20:
        raise AppError(422, "INVALID_DOCUMENT_SCOPE", "Select between 1 and 20 documents.")

    vector = embed_texts(settings, [query])[0]
    distance = DocumentChunk.embedding.cosine_distance(vector).label("distance")
    statement = (
        select(DocumentChunk, DatasetDocument, StoredArtifact, distance)
        .join(DatasetDocument, DatasetDocument.id == DocumentChunk.document_id)
        .outerjoin(StoredArtifact, StoredArtifact.id == DatasetDocument.source_artifact_id)
        .where(
            DatasetDocument.owner_id == owner_id,
            DatasetDocument.status == "indexed",
            DatasetDocument.embedding_model == settings.rag_embedding_model,
            DatasetDocument.embedding_dimensions == settings.rag_embedding_dimensions,
            DocumentChunk.embedding.is_not(None),
        )
    )
    if document_ids is not None:
        statement = statement.where(DatasetDocument.id.in_(document_ids))
    statement = statement.order_by(distance, DocumentChunk.id).limit(top_k)
    matches = []
    for chunk, document, artifact, chunk_distance in db.execute(statement):
        similarity = max(0.0, min(1.0, 1.0 - float(chunk_distance)))
        if similarity < settings.rag_min_similarity:
            continue
        matches.append(
            {
                "chunk_id": str(chunk.id),
                "document_id": str(document.id),
                "source_filename": document.source_filename,
                "file_type": document.file_type,
                "page_number": chunk.page_number,
                "location": chunk.location,
                "excerpt": chunk.content[:1200],
                "similarity": round(similarity, 6),
                "source_sha256": artifact.sha256 if artifact else None,
            }
        )
    return matches
