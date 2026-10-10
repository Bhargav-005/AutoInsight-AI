import pytest
from pydantic import ValidationError

from app.core.config import Settings


@pytest.mark.parametrize(
    "origin", ["*", "https://example.com", "http://localhost/path", "http://localhost:99999"]
)
def test_invalid_cors_origins_fail(origin):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, cors_origins=[origin])


@pytest.mark.parametrize("port", [0, 80, 65536])
def test_invalid_api_port_fails(port):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, api_port=port)


def test_template_loads_with_future_settings_ignored():
    from app.core.config import PROJECT_ROOT

    settings = Settings(_env_file=PROJECT_ROOT / ".env.example")
    assert settings.api_host == "127.0.0.1"
    assert settings.api_port == 8000


def test_process_environment_overrides_dotenv(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("API_PORT=8001\n", encoding="utf-8")
    monkeypatch.setenv("API_PORT", "8002")
    assert Settings(_env_file=env_file).api_port == 8002


def test_public_binding_is_not_supported_in_local_scaffold():
    with pytest.raises(ValidationError):
        Settings(_env_file=None, api_host="0.0.0.0")
