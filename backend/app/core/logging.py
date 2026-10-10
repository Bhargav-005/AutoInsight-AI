"""Structured allowlisted events: no URLs, query strings, payloads or exception text."""

import json
import logging

logger = logging.getLogger("autoinsight")
ALLOWED = {"request_id", "method", "status", "duration_ms", "category", "job_id"}


def configure_logging() -> None:
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


def log_event(event: str, **fields) -> None:
    logger.info(json.dumps({"event": event, **{k: v for k, v in fields.items() if k in ALLOWED}}))
