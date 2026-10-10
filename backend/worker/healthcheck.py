from datetime import UTC, datetime
from pathlib import Path

from rq import Worker
from rq.serializers import JSONSerializer

from app.core.config import Settings
from worker.connection import redis_connection

if __name__ == "__main__":
    settings = Settings()
    connection = redis_connection(settings)
    expected = Path("/tmp/autoinsight-worker-name").read_text(encoding="utf-8")
    ok = any(
        worker.name == expected
        and worker.last_heartbeat is not None
        and (datetime.now(UTC) - worker.last_heartbeat).total_seconds() < 90
        for worker in Worker.all(connection=connection, serializer=JSONSerializer)
    )
    raise SystemExit(0 if ok else 1)
