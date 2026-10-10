from unittest.mock import Mock

from app.core.config import Settings
from app.services.readiness import inspect_dependencies


def test_dependency_failures_are_real_and_sanitized():
    settings = Settings(
        _env_file=None,
        infrastructure_enabled=True,
        postgres_password="a" * 32,
        redis_password="b" * 32,
    )
    engine, redis = Mock(), Mock()
    engine.connect.side_effect = RuntimeError("secret database URL")
    redis.ping.side_effect = RuntimeError("secret redis URL")
    checks = inspect_dependencies(engine, redis, settings)
    assert all(check["status"] == "unhealthy" for check in checks.values())
    assert "secret" not in str(checks)
    engine.connect.assert_called_once()
    redis.ping.assert_called_once()
