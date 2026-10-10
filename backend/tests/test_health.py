from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


@pytest.fixture
def client():
    with TestClient(
        create_app(Settings(_env_file=None, app_env="test", infrastructure_enabled=False))
    ) as client:
        yield client


def test_liveness_only_claims_process_health(client):
    response = client.get("/api/v1/health/live")
    assert response.status_code == 200
    body = response.json()
    assert body["data"]["status"] == "live"
    assert body["data"]["checks"] == {}
    assert body["error"] is None
    assert UUID(body["meta"]["request_id"])
    assert response.headers["cache-control"] == "no-store"


def test_readiness_does_not_claim_unintegrated_dependencies_are_healthy(client, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://unavailable.invalid/autoinsight")
    monkeypatch.setenv("REDIS_URL", "redis://unavailable.invalid:6379")
    response = client.get("/api/v1/health/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["data"]["status"] == "not_ready"
    assert set(body["data"]["checks"]) == {"postgres", "redis", "worker"}
    assert all(check["status"] == "not_configured" for check in body["data"]["checks"].values())
    assert body["error"]["code"] == "DEPENDENCIES_UNAVAILABLE"
    assert response.headers["cache-control"] == "no-store"
    assert "unavailable.invalid" not in response.text


def test_request_ids_are_unique(client):
    first = client.get("/api/v1/health/live").json()
    second = client.get("/api/v1/health/live").json()
    assert first["meta"]["request_id"] != second["meta"]["request_id"]


@pytest.mark.parametrize("path", ["live", "ready"])
def test_allowed_origin_can_read_health(client, path):
    response = client.get(f"/api/v1/health/{path}", headers={"Origin": "http://127.0.0.1:5173"})
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_unapproved_origin_has_no_cors_permission(client):
    response = client.get("/api/v1/health/live", headers={"Origin": "https://example.com"})
    assert "access-control-allow-origin" not in response.headers


def test_openapi_documents_actual_readiness_status(client):
    schema = client.get("/api/v1/openapi.json").json()
    assert "503" in schema["paths"]["/api/v1/health/ready"]["get"]["responses"]
    assert client.get("/api/v1/docs").status_code == 200
