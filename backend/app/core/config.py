"""Validated local API, infrastructure and worker settings for Phase 1."""

from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
        hide_input_in_errors=True,
    )

    app_env: Literal["development", "test", "production"] = "development"
    api_host: Literal["127.0.0.1", "localhost", "::1"] = "127.0.0.1"
    api_port: int = Field(default=8000, ge=1024, le=65535)
    cors_origins: list[str] = ["http://127.0.0.1:5173", "http://localhost:5173"]
    infrastructure_enabled: bool = False
    postgres_host: str = "127.0.0.1"
    postgres_port: int = Field(default=5433, ge=1, le=65535)
    postgres_db: str = "autoinsight"
    postgres_user: str = "autoinsight"
    postgres_password: SecretStr = SecretStr("")
    redis_host: str = "127.0.0.1"
    redis_port: int = Field(default=6380, ge=1, le=65535)
    redis_password: SecretStr = SecretStr("")
    rq_queue: str = "autoinsight"
    file_storage_root: Path = PROJECT_ROOT / "storage" / "artifacts"
    max_job_seconds: int = Field(default=900, ge=1, le=900)
    max_upload_bytes: int = Field(default=25_000_000, ge=1, le=25_000_000)
    max_dataset_rows: int = Field(default=100_000, ge=1, le=100_000)
    max_dataset_columns: int = Field(default=100, ge=1, le=100)
    app_db_password: SecretStr = SecretStr("")
    auth_csrf_secret: SecretStr = SecretStr("")
    session_hours: int = Field(default=24, ge=1, le=168)
    auth_rate_namespace: str = "autoinsight:auth"
    auth_login_limit: int = Field(default=10, ge=1, le=100)
    auth_register_limit: int = Field(default=5, ge=1, le=100)
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen3.5:4b-q4_K_M"
    ollama_request_timeout_seconds: int = Field(default=120, ge=10, le=300)
    ollama_temperature: float = Field(default=0.0, ge=0.0, le=0.5)
    ollama_max_output_tokens: int = Field(default=1200, ge=128, le=4096)
    llm_context_tokens: int = Field(default=4096, ge=1024, le=8192)
    llm_thinking: bool = False
    max_concurrent_research_runs: int = Field(default=1, ge=1, le=2)
    max_research_steps: int = Field(default=12, ge=1, le=12)

    @property
    def secure_cookies(self) -> bool:
        return self.app_env == "production"

    @property
    def session_cookie(self) -> str:
        return "__Secure-autoinsight_session" if self.secure_cookies else "autoinsight_session"

    @property
    def csrf_cookie(self) -> str:
        return "__Secure-autoinsight_csrf" if self.secure_cookies else "autoinsight_csrf"

    @model_validator(mode="after")
    def validate_infrastructure(self):
        ollama = urlsplit(self.ollama_base_url)
        if (
            ollama.scheme != "http"
            or ollama.hostname not in {"127.0.0.1", "localhost", "::1", "host.docker.internal"}
            or ollama.username is not None
            or ollama.password is not None
            or ollama.path not in {"", "/"}
            or ollama.query
            or ollama.fragment
        ):
            raise ValueError("Ollama must use an explicit local HTTP endpoint")
        _ = ollama.port
        if not self.ollama_model.strip() or len(self.ollama_model) > 100:
            raise ValueError("Configure a valid local Ollama model name")
        if self.app_env == "production":
            if len(self.auth_csrf_secret.get_secret_value()) < 32:
                raise ValueError("Production requires a persistent CSRF secret")
            if any(not origin.startswith("https://") for origin in self.cors_origins):
                raise ValueError("Production origins must use HTTPS")
        if self.infrastructure_enabled:
            if any(
                len(secret.get_secret_value()) < 24
                for secret in (self.postgres_password, self.redis_password)
            ):
                raise ValueError(
                    "Infrastructure requires independent secrets of at least 24 characters"
                )
            if self.postgres_db != "autoinsight" or self.postgres_user != "autoinsight":
                raise ValueError(
                    "Phase 1 infrastructure must use the dedicated autoinsight database/user"
                )
        return self

    @field_validator("cors_origins")
    @classmethod
    def validate_origins(cls, origins: list[str]) -> list[str]:
        for origin in origins:
            parsed = urlsplit(origin)
            if (
                parsed.scheme not in {"http", "https"}
                or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError("Scaffold CORS origins must be explicit loopback origins")
            # Access validates malformed and out-of-range port strings.
            _ = parsed.port
        return origins
