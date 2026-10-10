from sqlalchemy import URL, create_engine

from app.core.config import Settings


def create_db_engine(settings: Settings):
    return create_engine(
        URL.create(
            "postgresql+psycopg",
            username=settings.postgres_user,
            password=settings.postgres_password.get_secret_value(),
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
