"""Application factory; imports never connect to infrastructure."""

from contextlib import asynccontextmanager
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException

from app.api.auth import router as auth_router
from app.api.datasets import router as datasets_router
from app.api.documents import router as documents_router
from app.api.health import router
from app.api.ml import router as ml_router
from app.api.phase5 import router as phase5_router
from app.api.reports import router as reports_router
from app.api.research import router as research_router
from app.core.config import Settings
from app.core.errors import AppError, app_error, error_response, http_error, validation_error
from app.core.logging import configure_logging, log_event
from app.db.session import create_db_engine
from worker.connection import redis_connection


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    configure_logging()

    @asynccontextmanager
    async def lifespan(app):
        app.state.settings = settings
        app.state.engine = (
            create_db_engine(settings, runtime=True) if settings.infrastructure_enabled else None
        )
        app.state.redis = redis_connection(settings) if settings.infrastructure_enabled else None
        yield
        if app.state.engine is not None:
            app.state.engine.dispose()
        if app.state.redis is not None:
            app.state.redis.close()

    app = FastAPI(
        title="AutoInsight AI",
        version="0.1.0",
        description="Local analytics foundation with database-backed account sessions.",
        lifespan=lifespan,
        docs_url="/api/v1/docs",
        redoc_url=None,
        openapi_url="/api/v1/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Accept", "Content-Type", "X-CSRF-Token"],
    )
    app.include_router(router)
    app.include_router(auth_router)
    app.include_router(datasets_router)
    app.include_router(phase5_router)
    app.include_router(ml_router)
    app.include_router(research_router)
    app.include_router(documents_router)
    app.include_router(reports_router)
    app.add_exception_handler(AppError, app_error)
    app.add_exception_handler(HTTPException, http_error)
    app.add_exception_handler(RequestValidationError, validation_error)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request, exc):
        return error_response(
            request,
            503,
            "DATABASE_UNAVAILABLE",
            "Account data is temporarily unavailable. Please try again.",
        )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request.state.request_id = str(uuid4())
        start = perf_counter()
        try:
            is_auth = request.url.path.startswith("/api/v1/auth/")
            is_ml = request.url.path.startswith("/api/v1/ml-runs")
            if (is_auth or is_ml) and request.method == "POST":
                body_limit = 8192 if is_auth else 65536
                body = bytearray()
                async for chunk in request.stream():
                    if len(body) + len(chunk) > body_limit:
                        response = error_response(
                            request,
                            413,
                            "REQUEST_TOO_LARGE",
                            "Authentication request is too large."
                            if is_auth
                            else "ML request is too large.",
                        )
                        break
                    body.extend(chunk)
                else:
                    # Starlette's cached body is replayed for FastAPI's bounded JSON parsing.
                    request._body = bytes(body)
                    response = await call_next(request)
            else:
                response = await call_next(request)
        except Exception as exc:
            log_event(
                "request_failed", request_id=request.state.request_id, category=type(exc).__name__
            )
            response = error_response(request, 500, "INTERNAL_ERROR", "An internal error occurred")
        response.headers["X-Request-ID"] = request.state.request_id
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        log_event(
            "request",
            request_id=request.state.request_id,
            method=request.method,
            status=response.status_code,
            duration_ms=round((perf_counter() - start) * 1000),
        )
        return response

    return app
