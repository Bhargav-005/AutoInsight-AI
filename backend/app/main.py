"""Application factory; imports never connect to infrastructure."""

from contextlib import asynccontextmanager
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException

from app.api.health import router
from app.core.config import Settings
from app.core.errors import error_response, http_error, validation_error
from app.core.logging import configure_logging, log_event
from app.db.session import create_db_engine
from worker.connection import redis_connection


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging()

    @asynccontextmanager
    async def lifespan(app):
        app.state.settings = settings
        app.state.engine = create_db_engine(settings) if settings.infrastructure_enabled else None
        app.state.redis = redis_connection(settings) if settings.infrastructure_enabled else None
        yield
        if app.state.engine is not None:
            app.state.engine.dispose()
        if app.state.redis is not None:
            app.state.redis.close()

    app = FastAPI(
        title="AutoInsight AI",
        version="0.1.0",
        description="Phase 1: local foundation with measured infrastructure readiness.",
        lifespan=lifespan,
        docs_url="/api/v1/docs",
        redoc_url=None,
        openapi_url="/api/v1/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Accept"],
    )
    app.include_router(router)
    app.add_exception_handler(HTTPException, http_error)
    app.add_exception_handler(RequestValidationError, validation_error)

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = str(uuid4())
        start = perf_counter()
        try:
            response = await call_next(request)
        except Exception as exc:
            log_event(
                "request_failed", request_id=request.state.request_id, category=type(exc).__name__
            )
            response = error_response(request, 500, "INTERNAL_ERROR", "An internal error occurred")
        response.headers["X-Request-ID"] = request.state.request_id
        log_event(
            "request",
            request_id=request.state.request_id,
            method=request.method,
            status=response.status_code,
            duration_ms=round((perf_counter() - start) * 1000),
        )
        return response

    return app
