"""Add immutable upload metadata and profiling lifecycle to Phase 3 tables."""

import sqlalchemy as sa
from alembic import op

revision = "0003_dataset_ingestion"
down_revision = "0002_domain_auth"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "datasets", sa.Column("original_filename", sa.Text(), server_default="", nullable=False)
    )
    op.add_column("datasets", sa.Column("media_type", sa.Text(), server_default="", nullable=False))
    op.add_column(
        "datasets",
        sa.Column("file_size_bytes", sa.BigInteger(), server_default="0", nullable=False),
    )
    op.add_column(
        "datasets", sa.Column("status", sa.Text(), server_default="ready", nullable=False)
    )
    op.add_column("datasets", sa.Column("selected_sheet", sa.Text(), nullable=True))
    op.add_column("datasets", sa.Column("processing_error", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_datasets_nonnegative_file_size", "datasets", "file_size_bytes >= 0"
    )
    op.create_check_constraint(
        "ck_datasets_status_values",
        "datasets",
        "status IN ('queued','processing','ready','failed')",
    )
    op.create_index("ix_datasets_status", "datasets", ["status"])


def downgrade():
    raise RuntimeError("Destructive migration requires explicit review and approval")
