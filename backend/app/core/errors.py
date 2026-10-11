from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


async def app_error(request: Request, exc: AppError):
    response = error_response(request, exc.status, exc.code, exc.message)
    if exc.status == 429:
        response.headers["Retry-After"] = "60"
    return response


def error_response(request: Request, status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={
            "data": None,
            "meta": {"request_id": request.state.request_id, "version": "v1"},
            "error": {"code": code, "message": message},
        },
    )


async def http_error(request: Request, exc: HTTPException):
    return error_response(
        request,
        exc.status_code,
        f"HTTP_{exc.status_code}",
        "Resource not found" if exc.status_code == 404 else "Request rejected",
    )


async def validation_error(request: Request, exc: RequestValidationError):
    return error_response(request, 422, "VALIDATION_ERROR", "Request validation failed")
