"""Persist explicit rejection as a distinct research run state."""

from alembic import op

revision = "0006_research_rejection"
down_revision = "0005_ml_engine"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint(op.f("ck_research_runs_status_values"), "research_runs", type_="check")
    op.create_check_constraint(
        op.f("ck_research_runs_status_values"),
        "research_runs",
        "status IN ('draft','awaiting_approval','queued','running','completed','failed',"
        "'cancelled','rejected')",
    )


def downgrade():
    op.execute("UPDATE research_runs SET status = 'cancelled' WHERE status = 'rejected'")
    op.drop_constraint(op.f("ck_research_runs_status_values"), "research_runs", type_="check")
    op.create_check_constraint(
        op.f("ck_research_runs_status_values"),
        "research_runs",
        "status IN ('draft','awaiting_approval','queued','running','completed','failed',"
        "'cancelled')",
    )
