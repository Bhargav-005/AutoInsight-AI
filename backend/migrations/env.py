from alembic import context

from app.core.config import Settings
from app.db import models  # noqa: F401
from app.db.base import Base
from app.db.session import create_db_engine

settings = Settings()
if not settings.infrastructure_enabled:
    raise RuntimeError("Enable the dedicated AutoInsight infrastructure before migrating")
if context.is_offline_mode():
    raise RuntimeError("Offline migration mode is not supported in Phase 1")


def migrate(connection):
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        version_table_schema=context.config.attributes.get("migration_schema"),
    )
    with context.begin_transaction():
        context.run_migrations()


supplied = context.config.attributes.get("connection")
if supplied is not None:
    migrate(supplied)
else:
    engine = create_db_engine(settings)
    try:
        with engine.connect() as connection:
            migrate(connection)
    finally:
        engine.dispose()
