"""Serialized local Ollama embeddings for the configured semantic model."""

from contextlib import contextmanager

import httpx

from app.core.errors import AppError
from worker.connection import redis_connection


@contextmanager
def _model_slot(settings):
    redis = None
    lock = None
    try:
        if settings.infrastructure_enabled:
            redis = redis_connection(settings)
            lock = redis.lock(
                "autoinsight:ollama:inference",
                timeout=settings.ollama_request_timeout_seconds + 20,
                blocking_timeout=settings.ollama_request_timeout_seconds,
            )
            if not lock.acquire():
                raise AppError(503, "OLLAMA_BUSY", "The local model is busy. Try again shortly.")
        yield
    except AppError:
        raise
    except Exception:
        raise AppError(
            503, "EMBEDDING_UNAVAILABLE", "The local embedding model is unavailable."
        ) from None
    finally:
        if lock is not None:
            try:
                lock.release()
            except Exception:
                pass
        if redis is not None:
            redis.close()


def embed_texts(settings, texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    output = []
    for offset in range(0, len(texts), settings.document_embed_batch_size):
        batch = texts[offset : offset + settings.document_embed_batch_size]
        with _model_slot(settings):
            try:
                response = httpx.post(
                    f"{settings.ollama_base_url.rstrip('/')}/api/embed",
                    json={"model": settings.rag_embedding_model, "input": batch},
                    timeout=httpx.Timeout(settings.ollama_request_timeout_seconds, connect=3),
                )
                response.raise_for_status()
                embeddings = response.json().get("embeddings")
            except (httpx.HTTPError, ValueError, AttributeError):
                raise AppError(
                    503,
                    "EMBEDDING_UNAVAILABLE",
                    "The configured local embedding model could not process this request.",
                ) from None
        if (
            not isinstance(embeddings, list)
            or len(embeddings) != len(batch)
            or any(
                not isinstance(vector, list)
                or len(vector) != settings.rag_embedding_dimensions
                or any(not isinstance(value, (int, float)) for value in vector)
                for vector in embeddings
            )
        ):
            raise AppError(
                503,
                "EMBEDDING_DIMENSION_MISMATCH",
                "The configured embedding model returned an unsupported vector size.",
            )
        output.extend([[float(value) for value in vector] for vector in embeddings])
    return output
