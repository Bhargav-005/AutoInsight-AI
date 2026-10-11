import hashlib
import re
from pathlib import Path
from time import time
from uuid import uuid4

REFERENCE = re.compile(r"[0-9a-f]{32}\.(?:bin|json|txt|csv|xlsx|parquet|pdf|joblib|png)\Z")


class ArtifactStore:
    """Flat, generated references; never accept client paths or filenames."""

    def __init__(self, root: Path):
        self.root = root.resolve(strict=True)
        if not self.root.is_dir():
            raise ValueError("Artifact root must be a directory")

    def resolve(self, reference: str) -> Path:
        if not REFERENCE.fullmatch(reference):
            raise ValueError("Invalid artifact reference")
        candidate = self.root / reference
        if candidate.is_symlink() or candidate.resolve().parent != self.root:
            raise ValueError("Artifact reference escapes storage")
        return candidate

    def write(self, data: bytes, suffix: str = "bin") -> dict[str, str]:
        reference = f"{uuid4().hex}.{suffix}"
        path = self.resolve(reference)
        with path.open("xb") as stream:
            stream.write(data)
        return {"reference": reference, "sha256": hashlib.sha256(data).hexdigest()}

    def read(self, reference: str) -> bytes:
        return self.resolve(reference).read_bytes()

    def delete(self, reference: str) -> None:
        path = self.resolve(reference)
        path.unlink(missing_ok=True)


def cleanup_abandoned_uploads(root: Path, *, older_than_seconds: int = 86_400) -> int:
    """Remove only old partials created by this uploader; never recurse or follow links."""
    cutoff = time() - older_than_seconds
    removed = 0
    for candidate in root.glob(".upload-*.part"):
        try:
            if candidate.is_symlink() or not candidate.is_file():
                continue
            if candidate.stat().st_mtime < cutoff:
                candidate.unlink()
                removed += 1
        except OSError:
            continue
    return removed
