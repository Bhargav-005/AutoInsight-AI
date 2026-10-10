"""Process liveness and conservative platform readiness, with no network probes."""

from typing import Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from app.services.readiness import inspect_dependencies

router = APIRouter(prefix="/api/v1/health", tags=["health"])


class DependencyCheck(BaseModel):
    status: Literal["not_configured", "healthy", "unhealthy"] = "not_configured"
    message: str


class HealthData(BaseModel):
    service: Literal["AutoInsight AI"] = "AutoInsight AI"
    status: Literal["live", "ready", "not_ready"]
    checks: dict[str, DependencyCheck] = Field(default_factory=dict)


class Metadata(BaseModel):
    request_id: UUID = Field(default_factory=uuid4)
    version: Literal["v1"] = "v1"


class HealthError(BaseModel):
    code: Literal["DEPENDENCIES_UNAVAILABLE"] = "DEPENDENCIES_UNAVAILABLE"
    message: str


class HealthResponse(BaseModel):
    data: HealthData
    meta: Metadata = Field(default_factory=Metadata)
    error: HealthError | None = None


@router.get("/live", response_model=HealthResponse)
def live(request: Request, response: Response) -> HealthResponse:
    """A response proves this API process can serve a request, not that dependencies work."""
    response.headers["Cache-Control"] = "no-store"
    return HealthResponse(
        data=HealthData(status="live"), meta=Metadata(request_id=request.state.request_id)
    )


@router.get("/ready", response_model=HealthResponse, responses={503: {"model": HealthResponse}})
def ready(request: Request, response: Response) -> HealthResponse:
    """Report measured connectivity, migration state and a recent worker heartbeat."""
    response.headers["Cache-Control"] = "no-store"
    checks = inspect_dependencies(
        request.app.state.engine, request.app.state.redis, request.app.state.settings
    )
    is_ready = all(check["status"] == "healthy" for check in checks.values())
    response.status_code = 200 if is_ready else 503
    return HealthResponse(
        data=HealthData(status="ready" if is_ready else "not_ready", checks=checks),
        meta=Metadata(request_id=request.state.request_id),
        error=None if is_ready else HealthError(message="Required services are unavailable."),
    )
