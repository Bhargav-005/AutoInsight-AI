"""Persist approved cleaning jobs and immutable results."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004_cleaning_plans"
down_revision = "0003_dataset_ingestion"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE cleaning_plans SET state='draft' WHERE state='pending'")
    op.execute("UPDATE cleaning_plans SET state='completed' WHERE state='applied'")
    op.drop_constraint(op.f("ck_cleaning_plans_state_values"), "cleaning_plans", type_="check")
    op.drop_constraint(op.f("ck_cleaning_plans_approval_required"), "cleaning_plans", type_="check")
    op.create_check_constraint(
        op.f("ck_cleaning_plans_state_values"),
        "cleaning_plans",
        (
            "state IN ('draft','previewed','approved','queued','running','completed',"
            "'rejected','failed')"
        ),
    )
    op.create_check_constraint(
        op.f("ck_cleaning_plans_approval_required"),
        "cleaning_plans",
        "state NOT IN ('approved','queued','running','completed') OR approved_by IS NOT NULL",
    )
    op.add_column("cleaning_plans", sa.Column("preview_json", postgresql.JSONB(), nullable=True))
    op.add_column("cleaning_plans", sa.Column("job_id", sa.String(120), nullable=True))
    op.add_column(
        "cleaning_plans",
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column("cleaning_plans", sa.Column("result_version_id", sa.Uuid(), nullable=True))
    op.add_column("cleaning_plans", sa.Column("error_message", sa.Text(), nullable=True))
    op.create_unique_constraint("uq_cleaning_plans_job_id", "cleaning_plans", ["job_id"])
    op.create_unique_constraint(
        "uq_cleaning_plans_result_version_id", "cleaning_plans", ["result_version_id"]
    )
    op.create_foreign_key(
        "fk_cleaning_plans_result_version_id_dataset_versions",
        "cleaning_plans",
        "dataset_versions",
        ["result_version_id", "owner_id"],
        ["id", "owner_id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        op.f("ck_cleaning_plans_nonnegative_attempt_count"),
        "cleaning_plans",
        "attempt_count >= 0",
    )


def downgrade():
    raise RuntimeError("Destructive migration requires explicit review and approval")
