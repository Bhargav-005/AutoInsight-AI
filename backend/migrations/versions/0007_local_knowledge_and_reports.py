"""Enable local document indexing, citations and report job status."""

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision = "0007_local_knowledge_and_reports"
down_revision = "0006_research_rejection"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("dataset_documents", sa.Column("source_filename", sa.String(255)))
    op.add_column("dataset_documents", sa.Column("file_type", sa.Text()))
    op.add_column(
        "dataset_documents",
        sa.Column("status", sa.Text(), nullable=False, server_default="failed"),
    )
    op.add_column("dataset_documents", sa.Column("page_count", sa.Integer()))
    op.add_column(
        "dataset_documents",
        sa.Column("chunk_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("dataset_documents", sa.Column("processing_error", sa.Text()))
    op.add_column("dataset_documents", sa.Column("embedding_model", sa.Text()))
    op.add_column("dataset_documents", sa.Column("embedding_dimensions", sa.Integer()))
    op.add_column("dataset_documents", sa.Column("job_id", sa.String(120), unique=True))
    op.add_column(
        "dataset_documents",
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "dataset_documents", sa.Column("processing_started_at", sa.DateTime(timezone=True))
    )
    op.execute(
        "UPDATE dataset_documents d SET source_filename = left(d.title, 255), "
        "file_type = COALESCE((SELECT a.mime_type FROM stored_artifacts a "
        "WHERE a.id = d.source_artifact_id), 'application/octet-stream'), "
        "processing_error = 'Re-index this document to enable semantic search.'"
    )
    op.alter_column("dataset_documents", "source_filename", nullable=False)
    op.alter_column("dataset_documents", "file_type", nullable=False, server_default="text/plain")
    op.alter_column("dataset_documents", "status", server_default="queued")
    op.alter_column("dataset_documents", "chunk_count", server_default=None)
    op.create_check_constraint(
        op.f("ck_dataset_documents_status_values"),
        "dataset_documents",
        "status IN ('queued','processing','indexed','failed','removed')",
    )
    op.create_check_constraint(
        op.f("ck_dataset_documents_nonnegative_chunk_count"),
        "dataset_documents",
        "chunk_count >= 0",
    )
    op.create_check_constraint(
        op.f("ck_dataset_documents_positive_page_count"),
        "dataset_documents",
        "page_count IS NULL OR page_count > 0",
    )
    op.create_check_constraint(
        op.f("ck_dataset_documents_supported_embedding_dimensions"),
        "dataset_documents",
        "embedding_dimensions IS NULL OR embedding_dimensions = 384",
    )
    op.create_index(
        op.f("ix_dataset_documents_owner_id_status"),
        "dataset_documents",
        ["owner_id", "status"],
    )

    op.drop_constraint(
        op.f("ck_document_chunks_embedding_model_not_configured"),
        "document_chunks",
        type_="check",
    )
    op.alter_column(
        "document_chunks",
        "embedding",
        type_=Vector(384),
        postgresql_using="embedding::vector(384)",
    )
    op.add_column("document_chunks", sa.Column("page_number", sa.Integer()))
    op.add_column("document_chunks", sa.Column("location", sa.Text()))
    op.create_check_constraint(
        op.f("ck_document_chunks_positive_page_number"),
        "document_chunks",
        "page_number IS NULL OR page_number > 0",
    )
    op.add_column("reports", sa.Column("error_message", sa.Text()))
    op.add_column("reports", sa.Column("job_id", sa.String(120), unique=True))
    op.add_column(
        "reports",
        sa.Column(
            "source_json",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade():
    raise RuntimeError("Destructive migration requires explicit review and approval")
