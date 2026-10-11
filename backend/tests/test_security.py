import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.auth import Registration
from app.core.config import Settings
from app.core.security import password_hasher, verify_password
from app.main import create_app


def test_argon2id_is_salted_and_verifies_the_entire_password():
    value = "a long passphrase with unicode 🔐"
    first, second = password_hasher.hash(value), password_hasher.hash(value)
    assert first.startswith("$argon2id$") and first != second
    assert verify_password(first, value)
    assert not verify_password(first, value[:-1])
    assert not verify_password("invalid", value)


@pytest.mark.parametrize(
    "changes",
    [
        {"password": "short"},
        {"password": "a" * 129},
        {"email": "invalid"},
        {"display_name": " "},
        {"display_name": "a" * 81},
        {"owner_id": "untrusted"},
    ],
)
def test_registration_rejects_invalid_or_extra_fields(changes):
    with pytest.raises(ValidationError):
        Registration(
            **(
                {
                    "email": "test@example.com",
                    "password": "a secure passphrase",
                    "display_name": "Analyst",
                }
                | changes
            )
        )


def test_csrf_requires_origin_header_proof_and_bounded_body():
    settings = Settings(_env_file=None, auth_csrf_secret="c" * 64)
    with TestClient(create_app(settings)) as client:
        csrf = client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
        body = {"email": "test@example.com", "password": "a secure passphrase"}
        for headers in [
            {},
            {"Origin": "https://evil.example", "X-CSRF-Token": csrf},
            {"Origin": "http://127.0.0.1:5173", "X-CSRF-Token": "bad"},
            {
                "Origin": "http://127.0.0.1:5173",
                "X-CSRF-Token": csrf,
                "Sec-Fetch-Site": "cross-site",
            },
        ]:
            assert client.post("/api/v1/auth/login", json=body, headers=headers).status_code == 403
        assert client.post("/api/v1/auth/login", content=b"x" * 8193).status_code == 413
        assert client.post("/api/v1/auth/login", content=iter([b"x" * 4096] * 3)).status_code == 413
        assert (
            client.get("/api/v1/auth/csrf", headers={"Origin": "https://evil.example"}).status_code
            == 403
        )


def test_https_cookies_and_production_settings_cannot_be_downgraded():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, app_env="production", auth_csrf_secret="a" * 64)
    settings = Settings(
        _env_file=None,
        app_env="production",
        cors_origins=["https://localhost"],
        auth_csrf_secret="a" * 64,
    )
    with TestClient(create_app(settings), base_url="https://localhost") as client:
        response = client.get("/api/v1/auth/csrf")
        cookie = response.headers["set-cookie"]
        assert "Secure" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
        assert "Path=/api/v1" in cookie and "Max-Age=3600" in cookie
        assert "Domain=" not in cookie
        assert response.headers["cache-control"] == "no-store"
