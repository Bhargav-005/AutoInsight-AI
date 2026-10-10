"""Bounded internal verification jobs, never selected by an LLM or HTTP caller."""

import hashlib
import time

from rq import get_current_job

from app.core.config import Settings
from app.storage.paths import ArtifactStore


def echo(value: str) -> dict[str, str]:
    return {"value": value}


def artifact_roundtrip(reference: str, checksum: str) -> dict[str, str]:
    store = ArtifactStore(Settings().file_storage_root)
    data = store.read(reference)
    if hashlib.sha256(data).hexdigest() != checksum:
        raise ValueError("Artifact checksum mismatch")
    return store.write(data, "bin")


def fail() -> None:
    raise ValueError("Intentional Phase 1 failure test")


def slow() -> None:
    time.sleep(10)


def retry_once() -> str:
    job = get_current_job()
    attempts = job.meta.get("attempts", 0) + 1
    job.meta["attempts"] = attempts
    job.save_meta()
    if attempts == 1:
        raise ValueError("Intentional transient failure")
    return "recovered"
