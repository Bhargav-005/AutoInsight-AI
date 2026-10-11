import subprocess
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from rq import Retry
from sqlalchemy import text

from app.core.config import PROJECT_ROOT, Settings
from app.db import models  # noqa: F401
from app.db.base import Base
from app.db.session import create_db_engine
from app.main import create_app
from app.storage.paths import ArtifactStore
from worker.connection import queue, redis_connection
from worker.smoke import artifact_roundtrip, echo, fail, retry_once, slow

pytestmark = pytest.mark.integration


@pytest.fixture
def infra():
    settings = Settings()
    assert settings.infrastructure_enabled, "Run Setup-Dev and Start-Infrastructure first"
    connection = redis_connection(settings)
    yield settings, connection, queue(settings, connection)
    connection.close()


def wait_for_job(job, expected, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        status = job.get_status(refresh=True).value
        if status == expected:
            return
        if status == "failed" and expected != "failed":
            pytest.fail(f"Job {job.id} failed unexpectedly")
        time.sleep(0.2)
    pytest.fail(f"Job did not reach {expected} within {timeout} seconds")


def test_postgres_extensions_and_migrations(infra):
    settings, _, _ = infra
    engine = create_db_engine(settings)
    try:
        with engine.connect() as connection:
            assert connection.execute(text("SELECT current_database()")).scalar() == "autoinsight"
            assert {"vector", "pgcrypto", "citext"} <= set(
                connection.execute(text("SELECT extname FROM pg_extension")).scalars()
            )
            assert (
                connection.execute(text("SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector")).scalar()
                == 1
            )
            assert (
                connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
                == "0005_ml_engine"
            )
            assert set(
                connection.execute(
                    text("SELECT tablename FROM pg_tables WHERE schemaname='public'")
                ).scalars()
            ) == {"alembic_version", *Base.metadata.tables}
    finally:
        engine.dispose()


def test_actual_readiness(infra):
    with TestClient(create_app(infra[0])) as client:
        response = client.get("/api/v1/health/ready")
        assert response.status_code == 200, response.text
        assert response.json()["data"]["status"] == "ready"
        assert all(
            check["status"] == "healthy" for check in response.json()["data"]["checks"].values()
        )


def test_redis_and_real_worker(infra):
    _, connection, jobs = infra
    assert connection.ping()
    value = uuid4().hex
    job = jobs.enqueue(echo, value, job_timeout=5, result_ttl=600)
    wait_for_job(job, "finished")
    assert job.return_value() == {"value": value}


def test_shared_artifacts(infra):
    settings, _, jobs = infra
    store = ArtifactStore(settings.file_storage_root)
    source = store.write(b"autoinsight-phase1-shared-artifact")
    job = jobs.enqueue(artifact_roundtrip, source["reference"], source["sha256"], job_timeout=10)
    wait_for_job(job, "finished")
    result = job.return_value()
    assert result["sha256"] == source["sha256"]
    assert result["reference"] != source["reference"]
    assert store.read(result["reference"]) == store.read(source["reference"])


def test_failed_job_retries_are_bounded(infra):
    job = infra[2].enqueue(fail, job_timeout=5, retry=Retry(max=1), failure_ttl=600)
    wait_for_job(job, "failed")
    job.refresh()
    assert job.retries_left == 0
    assert job.latest_result().exc_string == "ValueError"


def test_timeout_is_enforced(infra):
    job = infra[2].enqueue(slow, job_timeout=1, failure_ttl=600)
    wait_for_job(job, "failed")
    assert job.latest_result().exc_string == "JobTimeoutException"


def test_transient_retry_recovers(infra):
    job = infra[2].enqueue(retry_once, job_timeout=5, retry=Retry(max=1))
    wait_for_job(job, "finished")
    job.refresh()
    assert job.meta["attempts"] == 2
    assert job.return_value() == "recovered"


def test_persistence_and_real_outage(infra):
    """Restart only this project's services; preserve all data and verify existing state."""
    settings, redis, jobs = infra
    engine = create_db_engine(settings)
    with engine.connect() as connection:
        revision = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
        database_id = connection.execute(
            text("SELECT system_identifier FROM pg_control_system()")
        ).scalar()
    engine.dispose()
    marker = uuid4().hex
    marker_key = f"autoinsight:test:persistence:{marker}"
    redis.set(marker_key, marker, ex=600)
    store = ArtifactStore(settings.file_storage_root)
    artifact = store.write(marker.encode())
    compose = [
        "docker",
        "compose",
        "--project-name",
        "autoinsight",
        "--env-file",
        str(PROJECT_ROOT / ".env"),
        "--file",
        str(PROJECT_ROOT / "infra/compose.yaml"),
    ]
    try:
        subprocess.run(
            [*compose, "stop", "worker", "redis", "postgres"],
            check=True,
            capture_output=True,
            timeout=60,
        )
        with TestClient(create_app(settings)) as client:
            assert client.get("/api/v1/health/live").status_code == 200
            started = time.monotonic()
            unavailable = client.get("/api/v1/health/ready")
            assert time.monotonic() - started < 6, "Outage reporting exceeded its time budget"
            assert unavailable.status_code == 503
            assert unavailable.json()["data"]["checks"]["postgres"]["status"] == "unhealthy"
            assert unavailable.json()["data"]["checks"]["redis"]["status"] == "unhealthy"
    finally:
        subprocess.run(
            [
                *compose,
                "up",
                "--no-build",
                "--no-recreate",
                "--detach",
                "--wait",
                "--wait-timeout",
                "90",
            ],
            check=True,
            capture_output=True,
            timeout=100,
        )
    engine = create_db_engine(settings)
    try:
        with engine.connect() as connection:
            assert (
                connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
                == revision
            )
            assert (
                connection.execute(
                    text("SELECT system_identifier FROM pg_control_system()")
                ).scalar()
                == database_id
            )
        assert redis.get(marker_key).decode() == marker
        assert store.read(artifact["reference"]) == marker.encode()
        job = jobs.enqueue(
            artifact_roundtrip, artifact["reference"], artifact["sha256"], job_timeout=10
        )
        wait_for_job(job, "finished")
        assert store.read(job.return_value()["reference"]) == marker.encode()
        with TestClient(create_app(settings)) as client:
            assert client.get("/api/v1/health/ready").status_code == 200
    finally:
        engine.dispose()
