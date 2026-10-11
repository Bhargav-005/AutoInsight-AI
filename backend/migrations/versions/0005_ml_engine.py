"""Durable supervised ML execution and held-out results."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005_ml_engine"
down_revision = "0004_cleaning_plans"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("ml_runs", sa.Column("job_id", sa.String(120), nullable=True))
    op.add_column(
        "ml_runs", sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False)
    )
    op.add_column("ml_runs", sa.Column("result_json", postgresql.JSONB(), nullable=True))
    op.add_column("ml_runs", sa.Column("error_message", sa.Text(), nullable=True))
    op.add_column("ml_runs", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("ml_runs", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint("uq_ml_runs_job_id", "ml_runs", ["job_id"])
    op.create_check_constraint(
        op.f("ck_ml_runs_nonnegative_attempt_count"), "ml_runs", "attempt_count >= 0"
    )
    op.drop_constraint(op.f("ck_ml_runs_status_values"), "ml_runs", type_="check")
    op.create_check_constraint(
        op.f("ck_ml_runs_status_values"),
        "ml_runs",
        "status IN "
        "('created','queued','running','training','evaluating','completed','failed','cancelled')",
    )


def downgrade():
    raise RuntimeError("Destructive migration requires explicit review and approval")
