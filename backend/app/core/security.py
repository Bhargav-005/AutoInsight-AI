"""Password, cookie, CSRF and Redis rate-limit primitives; never log credentials."""

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Request, Response
from redis.exceptions import RedisError

from app.core.errors import AppError

# RFC 9106 low-memory profile: Argon2id, 64 MiB, 3 passes, 4 lanes.
password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)
DUMMY_HASH = password_hasher.hash(secrets.token_urlsafe(32))
COOKIE_PATH = "/api/v1"


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def verify_password(encoded: str, password: str) -> bool:
    try:
        return password_hasher.verify(encoded, password)
    except (VerificationError, InvalidHashError):
        return False


def cookie(response: Response, request: Request, name: str, value: str, seconds: int):
    response.set_cookie(
        name,
        value,
        max_age=seconds,
        expires=seconds,
        path=COOKIE_PATH,
        secure=request.app.state.settings.secure_cookies,
        httponly=True,
        samesite="lax",
    )


def check_origin(request: Request):
    settings = request.app.state.settings
    if request.headers.get("origin") not in settings.cors_origins:
        raise AppError(403, "CSRF_REJECTED", "Request origin is not allowed. Reload and try again.")
    if request.headers.get("sec-fetch-site") == "cross-site":
        raise AppError(403, "CSRF_REJECTED", "Cross-site requests are not allowed.")


def csrf_value(request: Request, seed: str) -> str:
    settings = request.app.state.settings
    secret = settings.auth_csrf_secret.get_secret_value()
    if len(secret) < 32:
        raise AppError(503, "AUTH_UNAVAILABLE", "Authentication is not configured.")
    # Bind the public CSRF proof to both the HttpOnly seed and current session.
    session = request.cookies.get(settings.session_cookie, "")
    return hmac.new(secret.encode(), f"csrf:v1:{seed}:{session}".encode(), "sha256").hexdigest()


def require_csrf(request: Request):
    check_origin(request)
    content_type = request.headers.get("content-type", "").split(";")[0].strip()
    if content_type != "application/json":
        raise AppError(415, "JSON_REQUIRED", "Send an application/json request.")
    seed = request.cookies.get(request.app.state.settings.csrf_cookie, "")
    provided = request.headers.get("x-csrf-token", "")
    if (
        len(seed) != 43
        or len(provided) != 64
        or not hmac.compare_digest(provided, csrf_value(request, seed))
    ):
        raise AppError(403, "CSRF_REJECTED", "Security token is invalid. Reload and try again.")


def require_upload_csrf(request: Request):
    check_origin(request)
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
    if content_type != "multipart/form-data":
        raise AppError(415, "MULTIPART_REQUIRED", "Send the dataset as multipart form data.")
    seed = request.cookies.get(request.app.state.settings.csrf_cookie, "")
    provided = request.headers.get("x-csrf-token", "")
    if (
        len(seed) != 43
        or len(provided) != 64
        or not hmac.compare_digest(provided, csrf_value(request, seed))
    ):
        raise AppError(403, "CSRF_REJECTED", "Security token is invalid. Reload and try again.")


def rate_limit(request: Request, action: str, email: str):
    settings = request.app.state.settings
    redis = request.app.state.redis
    if redis is None:
        raise AppError(503, "AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.")
    limit = settings.auth_register_limit if action == "register" else settings.auth_login_limit
    ip = request.client.host if request.client else "unknown"
    # The local server ignores forwarding headers. Dedicated expiring keys never touch RQ data.
    keys = [f"{settings.auth_rate_namespace}:{action}:ip:{digest(ip)}"]
    if action == "login":
        keys.append(f"{settings.auth_rate_namespace}:{action}:email:{digest(email)}")
    script = """
    local blocked = 0
    for _, key in ipairs(KEYS) do
      local n = redis.call('INCR', key)
      if n == 1 then redis.call('EXPIRE', key, 60) end
      if n > tonumber(ARGV[1]) then blocked = 1 end
    end
    return blocked
    """
    try:
        blocked = redis.eval(script, len(keys), *keys, limit)
    except RedisError:
        raise AppError(
            503, "AUTH_UNAVAILABLE", "Authentication is temporarily unavailable."
        ) from None
    if blocked:
        raise AppError(
            429, "RATE_LIMITED", "Too many attempts. Please wait a minute and try again."
        )
