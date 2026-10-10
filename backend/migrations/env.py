from alembic import context

from app.core.config import Settings
from app.db.base import Base
from app.db.session import create_db_engine

settings = Settings()
if not settings.infrastructure_enabled:
    raise RuntimeError("Enable the dedicated AutoInsight infrastructure before migrating")
if context.is_offline_mode():
    raise RuntimeError("Offline migration mode is not supported in Phase 1")

engine = create_db_engine(settings)
try:
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
finally:
    engine.dispose()
