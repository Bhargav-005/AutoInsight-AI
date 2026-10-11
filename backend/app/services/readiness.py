from datetime import UTC, datetime

from rq import Worker
from rq.serializers import JSONSerializer
from sqlalchemy import text


def inspect_dependencies(engine, redis, settings) -> dict[str, dict[str, str]]:
    if not settings.infrastructure_enabled:
        return {
            name: {"status": "not_configured", "message": "Infrastructure is disabled."}
            for name in ("postgres", "redis", "worker")
        }
    checks = {}
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            extensions = set(connection.execute(text("SELECT extname FROM pg_extension")).scalars())
            revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
            if not {"vector", "pgcrypto", "citext"} <= extensions or revision != "0002_domain_auth":
                raise RuntimeError("Migrations required")
        checks["postgres"] = {"status": "healthy", "message": "Connection and extensions verified."}
    except Exception:
        checks["postgres"] = {
            "status": "unhealthy",
            "message": "Database or migrations unavailable.",
        }
    try:
        redis.ping()
        checks["redis"] = {"status": "healthy", "message": "Authenticated Redis ping succeeded."}
        active = any(
            settings.rq_queue in worker.queue_names()
            and worker.last_heartbeat is not None
            and (datetime.now(UTC) - worker.last_heartbeat).total_seconds() < 90
            for worker in Worker.all(connection=redis, serializer=JSONSerializer)
        )
        checks["worker"] = {
            "status": "healthy" if active else "unhealthy",
            "message": "Recent queue worker heartbeat."
            if active
            else "No recent queue worker heartbeat.",
        }
    except Exception:
        checks["redis"] = {
            "status": "unhealthy",
            "message": "Redis or worker registry unavailable.",
        }
        checks["worker"] = {"status": "unhealthy", "message": "Worker status cannot be verified."}
    return checks
