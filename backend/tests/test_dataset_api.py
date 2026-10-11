import hashlib
import io
import time
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import Dataset, DatasetVersion, StoredArtifact
from app.db.session import create_db_engine
from app.main import create_app

pytestmark = pytest.mark.integration
ORIGIN = "http://127.0.0.1:5173"
PASSWORD = "Phase 4 integration passphrase!"


def register(client, label):
    token = client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
    response = client.post(
        "/api/v1/auth/register",
        json={
            "display_name": label,
            "email": f"phase4-{uuid4()}@example.com",
            "password": PASSWORD,
        },
        headers={"Origin": ORIGIN, "X-CSRF-Token": token},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]["id"]


def upload(client, filename, contents, content_type, **form):
    token = client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
    return client.post(
        "/api/v1/datasets",
        data=form,
        files={"file": (filename, contents, content_type)},
        headers={"Origin": ORIGIN, "X-CSRF-Token": token},
    )


def wait_ready(client, dataset_id):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/datasets/{dataset_id}/status")
        assert response.status_code == 200, response.text
        dataset = response.json()["data"]
        if dataset["status"] in {"ready", "failed"}:
            return dataset
        time.sleep(0.2)
    pytest.fail("Dataset profiling did not finish within 30 seconds")


@pytest.fixture
def api_client():
    settings = Settings(auth_rate_namespace=f"autoinsight:test:dataset:{uuid4().hex}")
    with TestClient(create_app(settings)) as client:
        yield settings, client


def test_csv_upload_profile_preview_versions_immutability_and_owner_isolation(api_client):
    settings, client = api_client
    owner_id = register(client, "Phase 4 CSV test")
    raw = b"value,label\n1,alpha\n2,beta\n2,beta\n,\n"
    response = upload(client, "metrics.csv", raw, "text/csv")
    assert response.status_code == 201, response.text
    dataset_id = response.json()["data"]["id"]
    ready = wait_ready(client, dataset_id)
    assert ready["status"] == "ready"
    assert (ready["row_count"], ready["column_count"]) == (4, 2)

    profile = client.get(f"/api/v1/datasets/{dataset_id}/profile").json()["data"]
    assert profile["duplicate_row_count"] == 1
    assert profile["quality_summary"]["missing_cell_count"] == 2
    first_page = client.get(f"/api/v1/datasets/{dataset_id}/preview?page=1&page_size=2")
    assert first_page.status_code == 200
    assert first_page.json()["data"]["rows"] == [
        {"column_001": "1", "column_002": "alpha"},
        {"column_001": "2", "column_002": "beta"},
    ]
    assert (
        len(
            client.get(f"/api/v1/datasets/{dataset_id}/preview?page=2&page_size=2").json()["data"][
                "rows"
            ]
        )
        == 2
    )

    engine = create_db_engine(settings)
    try:
        with Session(engine) as db:
            dataset = db.get(Dataset, dataset_id)
            version = db.scalar(
                select(DatasetVersion).where(DatasetVersion.dataset_id == dataset.id)
            )
            artifact = db.get(StoredArtifact, version.artifact_id)
            stored = settings.file_storage_root / artifact.relative_path
            before = stored.read_bytes()
            assert before == raw
            assert artifact.sha256 == hashlib.sha256(raw).hexdigest()
            assert dataset.owner_id == UUID(owner_id)
            assert dataset.original_filename == "metrics.csv"
            assert dataset.status == "ready"
            metadata = client.get(f"/api/v1/datasets/{dataset_id}")
            assert metadata.status_code == 200, metadata.text
            assert metadata.json()["data"].get("checksum") == artifact.sha256, metadata.text
    finally:
        engine.dispose()

    with TestClient(create_app(settings)) as restarted:
        restarted.cookies.update(client.cookies)
        assert (
            restarted.get(f"/api/v1/datasets/{dataset_id}/status").json()["data"]["status"]
            == "ready"
        )
        assert (
            restarted.get(f"/api/v1/datasets/{dataset_id}/profile").json()["data"]["row_count"] == 4
        )

    outsider_settings = settings.model_copy(
        update={"auth_rate_namespace": f"autoinsight:test:outsider:{uuid4().hex}"}
    )
    with TestClient(create_app(outsider_settings)) as outsider:
        assert outsider.get("/api/v1/datasets").status_code == 401
        outsider_id = register(outsider, "Phase 4 isolation test")
        assert outsider_id != owner_id
        assert outsider.get("/api/v1/datasets").json()["data"]["total"] == 0
        for suffix in ("", "/status", "/profile", "/preview", "/versions"):
            assert outsider.get(f"/api/v1/datasets/{dataset_id}{suffix}").status_code == 404


def test_xlsx_upload_selects_one_sheet_without_merging(api_client):
    _, client = api_client
    register(client, "Phase 4 XLSX test")
    book = Workbook()
    sales = book.active
    sales.title = "Sales"
    sales.append(["amount", "region"])
    sales.append([3, "East"])
    notes = book.create_sheet("Notes")
    notes.append(["message"])
    notes.append(["separate sheet"])
    stream = io.BytesIO()
    book.save(stream)
    contents = stream.getvalue()

    choice = upload(client, "records.xlsx", contents, "application/octet-stream")
    assert choice.status_code == 422
    assert choice.json()["error"]["code"] == "SHEET_SELECTION_REQUIRED", choice.text
    assert choice.json()["error"]["details"]["sheets"] == ["Sales", "Notes"]

    response = upload(
        client, "records.xlsx", contents, "application/octet-stream", sheet_name="Sales"
    )
    assert response.status_code == 201, response.text
    dataset_id = response.json()["data"]["id"]
    ready = wait_ready(client, dataset_id)
    assert ready["status"] == "ready"
    assert ready["selected_sheet"] == "Sales"
    assert (ready["row_count"], ready["column_count"]) == (1, 2)
    rows = client.get(f"/api/v1/datasets/{dataset_id}/preview").json()["data"]["rows"]
    assert rows == [{"column_001": 3, "column_002": "East"}]


def test_invalid_and_oversized_uploads_are_rejected_without_dataset_records(api_client):
    _, client = api_client
    register(client, "Phase 4 validation test")
    malformed = upload(client, "broken.xlsx", b"not a workbook", "application/octet-stream")
    assert malformed.status_code == 422
    assert malformed.json()["error"]["code"] == "INVALID_FILE"

    token = client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
    too_large = client.post(
        "/api/v1/datasets",
        files={"file": ("large.csv", b"x" * 25_000_001, "text/csv")},
        headers={"Origin": ORIGIN, "X-CSRF-Token": token},
    )
    assert too_large.status_code == 413
    assert too_large.json()["error"]["code"] == "UPLOAD_TOO_LARGE"
    assert client.get("/api/v1/datasets").json()["data"]["total"] == 0


def test_worker_failure_is_sanitized_and_dataset_can_be_retried(api_client):
    _, client = api_client
    register(client, "Phase 4 failure test")
    raw = "id,value\n" + "".join(f"{index},ok\n" for index in range(10))
    raw += "private,secret-value,unexpected-cell\n"
    response = upload(client, "late-error.csv", raw.encode(), "text/csv")
    assert response.status_code == 201, response.text
    dataset_id = response.json()["data"]["id"]
    failed = wait_ready(client, dataset_id)
    assert failed["status"] == "failed"
    assert failed["processing_error"]
    assert "secret-value" not in failed["processing_error"]

    token = client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
    retried = client.post(
        f"/api/v1/datasets/{dataset_id}/retry",
        json={},
        headers={"Origin": ORIGIN, "X-CSRF-Token": token},
    )
    assert retried.status_code == 200, retried.text
    assert wait_ready(client, dataset_id)["status"] == "failed"
