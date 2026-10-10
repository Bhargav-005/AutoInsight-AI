"""Enable infrastructure extensions only; no application domain tables."""

from alembic import op

revision = "0001_extensions"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    for extension in ("pgcrypto", "citext", "vector"):
        op.execute(f'CREATE EXTENSION IF NOT EXISTS "{extension}"')


def downgrade():
    raise RuntimeError("Dropping extensions requires explicit review and approval")
