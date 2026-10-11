from sqlalchemy import URL, create_engine

from app.core.config import Settings


def create_db_engine(settings: Settings, *, runtime: bool = False):
    if runtime and len(settings.app_db_password.get_secret_value()) < 24:
        raise RuntimeError("Provision the dedicated application database role first")
    return create_engine(
        URL.create(
            "postgresql+psycopg",
            username="autoinsight_app" if runtime else settings.postgres_user,
            password=(
                settings.app_db_password if runtime else settings.postgres_password
            ).get_secret_value(),
            host=settings.postgres_host,
            port=settings.postgres_port,
            database=settings.postgres_db,
        ),
        pool_pre_ping=True,
        pool_size=2,
        max_overflow=2,
        pool_timeout=2,
        connect_args={"connect_timeout": 2, "options": "-c statement_timeout=2000"},
        hide_parameters=True,
    )
