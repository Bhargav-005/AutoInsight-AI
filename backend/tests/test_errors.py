import io
import logging

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.logging import logger
from app.main import create_app


def test_errors_and_logs_are_sanitized():
    app = create_app(Settings(_env_file=None, infrastructure_enabled=False))

    @app.get("/failure")
    def failure():
        raise RuntimeError("password=DO_NOT_LOG_ME")

    @app.get("/validate/{number}")
    def validation(number: int):
        return number

    output = io.StringIO()
    handler = logging.StreamHandler(output)
    logger.addHandler(handler)
    try:
        with TestClient(app) as client:
            for path, expected in [
                ("/failure?token=DO_NOT_LOG_ME", 500),
                ("/validate/DO_NOT_LOG_ME", 422),
                ("/missing?token=DO_NOT_LOG_ME", 404),
            ]:
                response = client.get(path)
                assert response.status_code == expected
                assert response.json()["data"] is None
                assert response.json()["meta"]["request_id"] == response.headers["x-request-id"]
                assert "DO_NOT_LOG_ME" not in response.text
        assert "DO_NOT_LOG_ME" not in output.getvalue()
        assert "request_failed" in output.getvalue()
    finally:
        logger.removeHandler(handler)
