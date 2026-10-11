"""Reference schema plus session security and composite ownership constraints.

Only authentication and read-only overview queries execute business logic in Phase 3.
"""

from datetime import datetime
from uuid import UUID, uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Double,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import CITEXT, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Identity:
    id: Mapped[UUID] = mapped_column(
        primary_key=True, default=uuid4, server_default=func.gen_random_uuid()
    )


class Created:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Owned:
    owner_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)


def owned(*constraints):
    return (UniqueConstraint("id", "owner_id"), *constraints)


def parent(column, table, *, delete="RESTRICT"):
    return ForeignKeyConstraint(
        [column, "owner_id"], [f"{table}.id", f"{table}.owner_id"], ondelete=delete
    )


def choices(column, values):
    return CheckConstraint(
        f"{column} IN ({','.join(repr(value) for value in values.split())})",
        name=f"{column}_values",
    )


class User(Identity, Created, Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(CITEXT(), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    display_name: Mapped[str] = mapped_column(String(80))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AuthSession(Identity, Created, Base):
    __tablename__ = "sessions"
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (CheckConstraint("expires_at > created_at", name="expiry_after_creation"),)


class StoredArtifact(Identity, Created, Owned, Base):
    __tablename__ = "stored_artifacts"
    relative_path: Mapped[str] = mapped_column(Text, unique=True)
    mime_type: Mapped[str] = mapped_column(Text)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))
    __table_args__ = owned(
        CheckConstraint("size_bytes >= 0", name="nonnegative_size"),
        CheckConstraint("sha256 ~ '^[0-9a-f]{64}$'", name="checksum"),
        CheckConstraint(
            "relative_path ~ '^[a-zA-Z0-9][a-zA-Z0-9_./-]*$' AND relative_path !~ "
            "'(^|/)\\.\\.?(/|$)' AND relative_path NOT LIKE '%//%'",
            name="safe_relative_path",
        ),
    )


class Dataset(Identity, Created, Owned, Base):
    __tablename__ = "datasets"
    display_name: Mapped[str] = mapped_column(Text)
    source_format: Mapped[str] = mapped_column(Text)
    original_filename: Mapped[str] = mapped_column(Text, server_default="")
    media_type: Mapped[str] = mapped_column(Text, server_default="")
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, server_default="0")
    status: Mapped[str] = mapped_column(Text, server_default="ready", index=True)
    selected_sheet: Mapped[str | None] = mapped_column(Text)
    processing_error: Mapped[str | None] = mapped_column(Text)
    __table_args__ = owned(
        choices("source_format", "csv xlsx"),
        CheckConstraint("file_size_bytes >= 0", name="nonnegative_file_size"),
        choices("status", "queued processing ready failed"),
    )


class DatasetVersion(Identity, Created, Owned, Base):
    __tablename__ = "dataset_versions"
    dataset_id: Mapped[UUID] = mapped_column(index=True)
    parent_version_id: Mapped[UUID | None]
    artifact_id: Mapped[UUID]
    version_no: Mapped[int]
    kind: Mapped[str] = mapped_column(Text)
    __table_args__ = owned(
        parent("dataset_id", "datasets", delete="CASCADE"),
        parent("artifact_id", "stored_artifacts"),
        UniqueConstraint("dataset_id", "version_no"),
        UniqueConstraint("id", "dataset_id", name="uq_dataset_versions_id_dataset"),
        ForeignKeyConstraint(
            ["parent_version_id", "dataset_id"],
            ["dataset_versions.id", "dataset_versions.dataset_id"],
        ),
        CheckConstraint("version_no > 0", name="positive_version"),
        CheckConstraint(
            "parent_version_id IS NULL OR parent_version_id <> id", name="no_self_parent"
        ),
        choices("kind", "raw cleaned"),
        CheckConstraint(
            "(kind = 'raw' AND parent_version_id IS NULL) OR (kind = 'cleaned' AND "
            "parent_version_id IS NOT NULL)",
            name="lineage",
        ),
    )


class DatasetProfile(Identity, Base):
    __tablename__ = "dataset_profiles"
    dataset_version_id: Mapped[UUID] = mapped_column(
        ForeignKey("dataset_versions.id", ondelete="CASCADE"), unique=True
    )
    row_count: Mapped[int] = mapped_column(BigInteger)
    column_count: Mapped[int]
    profile_json: Mapped[dict] = mapped_column(JSONB)
    profiled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    __table_args__ = (
        CheckConstraint("row_count >= 0 AND column_count >= 0", name="nonnegative_dimensions"),
    )


class CleaningPlan(Identity, Created, Owned, Base):
    __tablename__ = "cleaning_plans"
    dataset_version_id: Mapped[UUID] = mapped_column(index=True)
    state: Mapped[str] = mapped_column(Text)
    operations_json: Mapped[list] = mapped_column(JSONB)
    approved_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"))
    preview_json: Mapped[dict | None] = mapped_column(JSONB)
    job_id: Mapped[str | None] = mapped_column(String(120), unique=True)
    attempt_count: Mapped[int] = mapped_column(Integer, server_default="0")
    result_version_id: Mapped[UUID | None]
    error_message: Mapped[str | None] = mapped_column(Text)
    __table_args__ = owned(
        parent("dataset_version_id", "dataset_versions", delete="CASCADE"),
        parent("result_version_id", "dataset_versions", delete="RESTRICT"),
        UniqueConstraint("result_version_id"),
        choices("state", "draft previewed approved queued running completed rejected failed"),
        CheckConstraint("approved_by IS NULL OR approved_by = owner_id", name="owner_approval"),
        CheckConstraint(
            "state NOT IN ('approved','queued','running','completed') OR approved_by IS NOT NULL",
            name="approval_required",
        ),
        CheckConstraint("attempt_count >= 0", name="nonnegative_attempt_count"),
    )


class ResearchRun(Identity, Created, Owned, Base):
    __tablename__ = "research_runs"
    dataset_version_id: Mapped[UUID] = mapped_column(index=True)
    goal: Mapped[str] = mapped_column(Text)
    plan_json: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    status: Mapped[str] = mapped_column(Text)
    max_steps: Mapped[int] = mapped_column(Integer, server_default="12")
    __table_args__ = owned(
        parent("dataset_version_id", "dataset_versions"),
        choices("status", "draft awaiting_approval queued running completed failed cancelled"),
        CheckConstraint("max_steps BETWEEN 1 AND 50", name="step_budget"),
    )


class AgentStep(Identity, Owned, Base):
    __tablename__ = "agent_steps"
    research_run_id: Mapped[UUID] = mapped_column(index=True)
    step_index: Mapped[int]
    agent_role: Mapped[str] = mapped_column(Text)
    tool_name: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    input_summary: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    output_summary: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = owned(
        parent("research_run_id", "research_runs", delete="CASCADE"),
        UniqueConstraint("research_run_id", "step_index"),
        UniqueConstraint("id", "research_run_id", name="uq_agent_steps_id_run"),
        CheckConstraint("step_index >= 0", name="nonnegative_step"),
        choices("status", "queued running completed failed cancelled"),
        choices("agent_role", "understand clean analysis ml research knowledge report"),
    )


class EvidenceItem(Identity, Owned, Base):
    __tablename__ = "evidence_items"
    run_id: Mapped[UUID] = mapped_column(index=True)
    step_id: Mapped[UUID | None]
    evidence_type: Mapped[str] = mapped_column(Text)
    payload_json: Mapped[dict] = mapped_column(JSONB)
    artifact_id: Mapped[UUID | None]
    __table_args__ = owned(
        parent("run_id", "research_runs", delete="CASCADE"),
        parent("artifact_id", "stored_artifacts"),
        ForeignKeyConstraint(
            ["step_id", "run_id"], ["agent_steps.id", "agent_steps.research_run_id"]
        ),
    )


class MLRun(Identity, Created, Owned, Base):
    __tablename__ = "ml_runs"
    dataset_version_id: Mapped[UUID] = mapped_column(index=True)
    research_run_id: Mapped[UUID | None] = mapped_column(index=True)
    task_type: Mapped[str] = mapped_column(Text)
    target_column: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text)
    config_json: Mapped[dict] = mapped_column(JSONB)
    model_artifact_id: Mapped[UUID | None]
    job_id: Mapped[str | None] = mapped_column(String(120), unique=True)
    attempt_count: Mapped[int] = mapped_column(Integer, server_default="0")
    result_json: Mapped[dict | None] = mapped_column(JSONB)
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = owned(
        parent("dataset_version_id", "dataset_versions"),
        parent("research_run_id", "research_runs"),
        parent("model_artifact_id", "stored_artifacts"),
        choices("task_type", "classification regression"),
        choices("status", "created queued running training evaluating completed failed cancelled"),
        CheckConstraint("attempt_count >= 0", name="nonnegative_attempt_count"),
    )


class ModelMetric(Identity, Base):
    __tablename__ = "model_metrics"
    ml_run_id: Mapped[UUID] = mapped_column(ForeignKey("ml_runs.id", ondelete="CASCADE"))
    dataset_split: Mapped[str] = mapped_column(Text)
    metric_name: Mapped[str] = mapped_column(Text)
    metric_value: Mapped[float] = mapped_column(Double)
    metadata_json: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    __table_args__ = (UniqueConstraint("ml_run_id", "dataset_split", "metric_name"),)


class Prediction(Identity, Created, Owned, Base):
    __tablename__ = "predictions"
    ml_run_id: Mapped[UUID] = mapped_column(index=True)
    input_json: Mapped[dict | None] = mapped_column(JSONB)
    output_json: Mapped[dict] = mapped_column(JSONB)
    __table_args__ = owned(parent("ml_run_id", "ml_runs", delete="CASCADE"))


class Report(Identity, Created, Owned, Base):
    __tablename__ = "reports"
    research_run_id: Mapped[UUID] = mapped_column(index=True)
    artifact_id: Mapped[UUID | None]
    status: Mapped[str] = mapped_column(Text)
    __table_args__ = owned(
        parent("research_run_id", "research_runs"),
        parent("artifact_id", "stored_artifacts"),
        choices("status", "queued running completed failed cancelled"),
    )


class DatasetDocument(Identity, Created, Owned, Base):
    __tablename__ = "dataset_documents"
    dataset_id: Mapped[UUID | None] = mapped_column(index=True)
    title: Mapped[str] = mapped_column(Text)
    source_artifact_id: Mapped[UUID | None]
    __table_args__ = owned(
        parent("dataset_id", "datasets", delete="CASCADE"),
        parent("source_artifact_id", "stored_artifacts"),
    )


class DocumentChunk(Identity, Base):
    __tablename__ = "document_chunks"
    document_id: Mapped[UUID] = mapped_column(
        ForeignKey("dataset_documents.id", ondelete="CASCADE")
    )
    chunk_index: Mapped[int]
    content: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list | None] = mapped_column(Vector())
    metadata_json: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index"),
        CheckConstraint("chunk_index >= 0", name="nonnegative_chunk"),
        CheckConstraint("embedding IS NULL", name="embedding_model_not_configured"),
    )


class AuditEvent(Identity, Created, Base):
    __tablename__ = "audit_events"
    actor_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    event_type: Mapped[str] = mapped_column(Text)
    entity_type: Mapped[str] = mapped_column(Text)
    entity_id: Mapped[UUID | None]
    meta_json: Mapped[dict] = mapped_column(JSONB, server_default="{}")
