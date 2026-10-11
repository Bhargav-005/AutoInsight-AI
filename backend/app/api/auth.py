"""Cookie authentication and owner-scoped, read-only Phase 3 resource APIs."""

import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security import (
    COOKIE_PATH,
    DUMMY_HASH,
    check_origin,
    cookie,
    csrf_value,
    digest,
    password_hasher,
    rate_limit,
    require_csrf,
    verify_password,
)
from app.db.models import AuditEvent, AuthSession, Dataset, MLRun, Report, ResearchRun, User

router = APIRouter(prefix="/api/v1", tags=["account"])


class Meta(BaseModel):
    request_id: str
    version: str = "v1"


class Envelope[T](BaseModel):
    data: T
    meta: Meta
    error: None = None


def result(request: Request, data):
    return {
        "data": data,
        "meta": {"request_id": request.state.request_id, "version": "v1"},
        "error": None,
    }


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    email: EmailStr = Field(max_length=254)
    password: SecretStr = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return value.casefold()


class Registration(Credentials):
    password: SecretStr = Field(min_length=12, max_length=128)
    display_name: str = Field(min_length=1, max_length=80)

    @field_validator("display_name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value or any(ord(char) < 32 for char in value):
            raise ValueError("Use a readable display name")
        return value


class UserView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: str
    display_name: str
    created_at: datetime


class CsrfView(BaseModel):
    csrf_token: str


class Overview(BaseModel):
    datasets: int
    research_runs: int
    ml_experiments: int
    reports: int


def database(request: Request):
    if request.app.state.engine is None:
        raise AppError(503, "AUTH_UNAVAILABLE", "Account services are temporarily unavailable.")
    with Session(request.app.state.engine) as db:
        yield db


DB = Annotated[Session, Depends(database)]


def active_session(request: Request, db: DB) -> AuthSession:
    raw = request.cookies.get(request.app.state.settings.session_cookie, "")
    session = None
    if len(raw) == 43:
        session = db.scalar(
            select(AuthSession)
            .join(User, User.id == AuthSession.user_id)
            .where(
                AuthSession.token_hash == digest(raw),
                AuthSession.revoked_at.is_(None),
                AuthSession.expires_at > func.now(),
                User.is_active.is_(True),
            )
        )
    if session is None:
        raise AppError(
            401, "SESSION_REQUIRED", "Your session is missing or expired. Please sign in."
        )
    return session


CurrentSession = Annotated[AuthSession, Depends(active_session)]


def current_user(db: DB, session: CurrentSession) -> User:
    return db.get(User, session.user_id)


CurrentUser = Annotated[User, Depends(current_user)]


def audit(db: Session, event: str, actor: UUID | None, entity: UUID | None = None):
    db.add(
        AuditEvent(
            actor_id=actor,
            event_type=event,
            entity_type="session" if entity else "user",
            entity_id=entity or actor,
            meta_json={},
        )
    )


def issue_session(request: Request, response: Response, db: Session, user: User):
    settings = request.app.state.settings
    old = request.cookies.get(settings.session_cookie, "")
    if len(old) == 43:
        previous = db.scalar(select(AuthSession).where(AuthSession.token_hash == digest(old)))
        if previous and previous.revoked_at is None:
            previous.revoked_at = datetime.now(UTC)
            audit(db, "session_revoked", previous.user_id, previous.id)
    raw = secrets.token_urlsafe(32)
    seconds = settings.session_hours * 3600
    session = AuthSession(
        user_id=user.id,
        token_hash=digest(raw),
        expires_at=datetime.now(UTC) + timedelta(seconds=seconds),
    )
    db.add(session)
    cookie(response, request, settings.session_cookie, raw, seconds)
    # A changed session invalidates earlier CSRF proofs without exposing the session token.


@router.get("/auth/csrf", response_model=Envelope[CsrfView])
def csrf(request: Request, response: Response):
    if request.headers.get("origin") or request.headers.get("sec-fetch-site") == "cross-site":
        check_origin(request)
    seed = request.cookies.get(request.app.state.settings.csrf_cookie, "")
    if len(seed) != 43:
        seed = secrets.token_urlsafe(32)
    value = csrf_value(request, seed)
    cookie(response, request, request.app.state.settings.csrf_cookie, seed, 3600)
    return result(request, {"csrf_token": value})


@router.post(
    "/auth/register",
    status_code=201,
    response_model=Envelope[UserView],
    dependencies=[Depends(require_csrf)],
)
def register(payload: Registration, request: Request, response: Response, db: DB):
    rate_limit(request, "register", payload.email)
    user = User(
        email=payload.email,
        display_name=payload.display_name,
        password_hash=password_hasher.hash(payload.password.get_secret_value()),
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise AppError(
            409, "EMAIL_UNAVAILABLE", "An account with that email already exists. Please sign in."
        ) from None
    issue_session(request, response, db, user)
    audit(db, "registration", user.id)
    db.commit()
    return result(request, UserView.model_validate(user))


@router.post("/auth/login", response_model=Envelope[UserView], dependencies=[Depends(require_csrf)])
def login(payload: Credentials, request: Request, response: Response, db: DB):
    rate_limit(request, "login", payload.email)
    user = db.scalar(select(User).where(User.email == payload.email))
    password = payload.password.get_secret_value()
    valid = verify_password(user.password_hash if user else DUMMY_HASH, password)
    if not valid or user is None or not user.is_active:
        audit(db, "login_failed", None)
        db.commit()
        raise AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.")
    if password_hasher.check_needs_rehash(user.password_hash):
        user.password_hash = password_hasher.hash(password)
    issue_session(request, response, db, user)
    audit(db, "login_succeeded", user.id)
    db.commit()
    return result(request, UserView.model_validate(user))


@router.get("/auth/me", response_model=Envelope[UserView])
def me(request: Request, user: CurrentUser):
    return result(request, UserView.model_validate(user))


@router.post(
    "/auth/logout", response_model=Envelope[dict[str, bool]], dependencies=[Depends(require_csrf)]
)
def logout(request: Request, response: Response, db: DB, session: CurrentSession):
    session.revoked_at = datetime.now(UTC)
    audit(db, "logout", session.user_id, session.id)
    audit(db, "session_revoked", session.user_id, session.id)
    db.commit()
    settings = request.app.state.settings
    for name in (settings.session_cookie, settings.csrf_cookie):
        response.delete_cookie(
            name, path=COOKIE_PATH, secure=settings.secure_cookies, httponly=True, samesite="lax"
        )
    return result(request, {"logged_out": True})


@router.get("/dashboard/overview", response_model=Envelope[Overview])
def overview(request: Request, db: DB, user: CurrentUser):
    counts = {
        name: select(func.count())
        .select_from(model)
        .where(model.owner_id == user.id)
        .scalar_subquery()
        for name, model in [
            ("datasets", Dataset),
            ("research_runs", ResearchRun),
            ("ml_experiments", MLRun),
            ("reports", Report),
        ]
    }
    row = (
        db.execute(select(*(query.label(name) for name, query in counts.items()))).mappings().one()
    )
    return result(request, dict(row))
