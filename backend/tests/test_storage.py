import os
import time
from pathlib import Path

import pytest

from app.storage.paths import ArtifactStore, cleanup_abandoned_uploads


@pytest.mark.parametrize(
    "reference",
    [
        "../secret",
        "..\\secret",
        "/etc/passwd",
        "C:\\secret",
        "a/b.txt",
        "file.csv",
        "a" * 32 + ".exe",
        "a" * 32 + ".txt:stream",
        "%2e%2e%2fsecret",
        "\\\\server\\share",
        "",
        "a" * 32 + ".txt\n",
    ],
)
def test_rejects_untrusted_paths(tmp_path, reference):
    with pytest.raises(ValueError):
        ArtifactStore(tmp_path).resolve(reference)


def test_generated_artifact_is_immutable_and_relative(tmp_path):
    store = ArtifactStore(tmp_path)
    first = store.write(b"evidence")
    second = store.write(b"evidence")
    assert first["reference"] != second["reference"]
    assert first["sha256"] == second["sha256"]
    assert not Path(first["reference"]).is_absolute()
    assert store.read(first["reference"]) == b"evidence"


def test_rejects_symlink(tmp_path):
    outside = tmp_path.parent / "outside-phase1-test.txt"
    outside.write_text("private")
    link = tmp_path / ("a" * 32 + ".txt")
    try:
        link.symlink_to(outside)
    except OSError:
        pytest.skip("Windows symlink creation requires developer mode or privilege")
    with pytest.raises(ValueError):
        ArtifactStore(tmp_path).read(link.name)


def test_abandoned_upload_cleanup_only_removes_old_partial_files(tmp_path):
    stale = tmp_path / ".upload-old.part"
    fresh = tmp_path / ".upload-new.part"
    unrelated = tmp_path / "user-file.part"
    for path in (stale, fresh, unrelated):
        path.write_bytes(b"temporary")
    stale.touch()
    os.utime(stale, (time.time() - 200, time.time() - 200))
    assert cleanup_abandoned_uploads(tmp_path, older_than_seconds=100) == 1
    assert not stale.exists()
    assert fresh.exists()
    assert unrelated.exists()
