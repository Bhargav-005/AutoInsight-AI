from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from redis.exceptions import ConnectionError
from rq.exceptions import NoSuchJobError

from app.services import job_recovery


@pytest.mark.parametrize(
    "status,expected",
    [
        ("queued", False),
        ("deferred", False),
        ("scheduled", False),
        ("started", True),
        ("failed", True),
        ("finished", True),
        ("canceled", True),
        ("unknown", False),
        ("missing", True),
        ("unavailable", False),
    ],
)
def test_abandonment_requires_expired_grace_and_known_dead_job(monkeypatch, status, expected):
    settings = SimpleNamespace(max_job_seconds=30)
    old = datetime.now(UTC) - timedelta(minutes=5)
    monkeypatch.setattr(job_recovery.Worker, "all", lambda **kw: [])

    def fetch(*a, **kw):
        if status == "missing":
            raise NoSuchJobError()
        if status == "unavailable":
            raise ConnectionError()
        return SimpleNamespace(get_status=lambda **kw: SimpleNamespace(value=status))

    monkeypatch.setattr(job_recovery.Job, "fetch", fetch)
    assert job_recovery.abandoned_job("test-job", old, settings, object()) is expected
    assert not job_recovery.abandoned_job("test-job", datetime.now(UTC), settings, object())
    assert not job_recovery.abandoned_job("test-job", old, settings, None)
    worker = SimpleNamespace(get_state=lambda: "busy", get_current_job_id=lambda: "test-job")
    monkeypatch.setattr(job_recovery.Worker, "all", lambda **kw: [worker])
    assert not job_recovery.abandoned_job("test-job", old, settings, object())
