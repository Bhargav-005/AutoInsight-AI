import hashlib
import time
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import CleaningPlan, DatasetVersion, StoredArtifact
from app.db.session import create_db_engine
from app.main import create_app

pytestmark = pytest.mark.integration
ORIGIN = "http://127.0.0.1:5173"
PASSWORD = "Phase 5 integration passphrase!"
FIXTURE = Path(__file__).parent / "fixtures" / "phase5_null_duplicates.csv"


def csrf(client):
    return client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]


def post(client, path, body):
    return client.post(
        path,
        json=body,
        headers={"Origin": ORIGIN, "X-CSRF-Token": csrf(client)},
    )


def register(client, suffix):
    response = post(
        client,
        "/api/v1/auth/register",
        {
            "display_name": "Phase 5 test",
            "email": f"phase5-{suffix}-{uuid4()}@example.com",
            "password": PASSWORD,
        },
    )
    assert response.status_code == 201, response.text


def wait_plan(client, plan_id):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/cleaning/plans/{plan_id}")
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        if data["state"] in {"completed", "failed"}:
            return data
        time.sleep(0.2)
    pytest.fail("Cleaning job did not finish within 30 seconds")


def test_cleaning_approval_lineage_real_analytics_and_owner_isolation():
    settings = Settings(auth_rate_namespace=f"autoinsight:test:phase5:{uuid4().hex}")
    with TestClient(create_app(settings)) as client:
        register(client, "owner")
        raw = FIXTURE.read_bytes()
        uploaded = client.post(
            "/api/v1/datasets",
            files={"file": ("phase5-null-duplicates.csv", raw, "text/csv")},
            headers={"Origin": ORIGIN, "X-CSRF-Token": csrf(client)},
        )
        assert uploaded.status_code == 201, uploaded.text
        dataset_id = uploaded.json()["data"]["id"]
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            status = client.get(f"/api/v1/datasets/{dataset_id}/status").json()["data"]
            if status["status"] in {"ready", "failed"}:
                break
            time.sleep(0.2)
        assert status["status"] == "ready"
        raw_version = client.get(f"/api/v1/datasets/{dataset_id}/versions").json()["data"][0]
        version_id = raw_version["id"]
        raw_checksum = raw_version["checksum"]

        suggestions = client.get(
            f"/api/v1/datasets/{dataset_id}/versions/{version_id}/cleaning/suggestions"
        )
        assert suggestions.status_code == 200
        assert suggestions.json()["data"]["missing_cells"] == 2
        assert suggestions.json()["data"]["duplicate_rows"] == 1

        create = post(
            client,
            f"/api/v1/datasets/{dataset_id}/cleaning/plans",
            {
                "dataset_version_id": version_id,
                "operations": [
                    {"op": "fill_missing", "column": "column_004", "strategy": "mean"},
                    {"op": "fill_missing", "column": "column_005", "strategy": "mean"},
                    {"op": "drop_duplicates"},
                ],
            },
        )
        assert create.status_code == 200, create.text
        plan = create.json()["data"]
        assert plan["state"] == "draft"
        plan_id = plan["id"]
        previewed = post(client, f"/api/v1/cleaning/plans/{plan_id}/preview", {})
        assert previewed.status_code == 200, previewed.text
        preview_data = previewed.json()["data"]
        assert preview_data["state"] == "previewed"
        assert preview_data["preview"]["source_rows"] == 6
        assert preview_data["preview"]["result_rows"] == 5
        assert "read-only" in preview_data["preview"]["warnings"][0]
        assert len(client.get(f"/api/v1/datasets/{dataset_id}/versions").json()["data"]) == 1
        rejected = post(
            client, f"/api/v1/cleaning/plans/{plan_id}/approve", {"confirm_apply": False}
        )
        assert rejected.status_code == 422
        accepted = post(
            client, f"/api/v1/cleaning/plans/{plan_id}/approve", {"confirm_apply": True}
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["data"]["state"] == "queued"
        completed = wait_plan(client, plan_id)
        assert completed["state"] == "completed"
        cleaned_version_id = completed["result_version_id"]
        versions = client.get(f"/api/v1/datasets/{dataset_id}/versions").json()["data"]
        assert len(versions) == 2
        cleaned_version = versions[1]
        assert cleaned_version["id"] == cleaned_version_id
        assert cleaned_version["kind"] == "cleaned"
        assert cleaned_version["checksum"] != raw_checksum
        cleaned_profile = client.get(
            f"/api/v1/datasets/{dataset_id}/profile?version_id={cleaned_version_id}"
        ).json()["data"]
        assert cleaned_profile["row_count"] == 5
        assert cleaned_profile["duplicate_row_count"] == 0
        assert cleaned_profile["quality_summary"]["missing_cell_count"] == 0
        cleaned_preview = client.get(
            f"/api/v1/datasets/{dataset_id}/preview?version_id={cleaned_version_id}"
        ).json()["data"]
        assert cleaned_preview["total_rows"] == 5
        assert (
            client.get(
                f"/api/v1/datasets/{dataset_id}/compare?left_version_id={version_id}&right_version_id={cleaned_version_id}"
            ).status_code
            == 200
        )

        engine = create_db_engine(settings)
        try:
            with Session(engine) as db:
                plan_row = db.get(CleaningPlan, plan_id)
                versions_for_dataset = db.scalars(
                    select(DatasetVersion).where(DatasetVersion.dataset_id == dataset_id)
                ).all()
                raw_version_row = db.get(DatasetVersion, version_id)
                original = db.get(StoredArtifact, raw_version_row.artifact_id)
                original_path = settings.file_storage_root / original.relative_path
                assert plan_row.result_version_id == versions_for_dataset[1].id
                assert original.sha256 == raw_checksum
                assert hashlib.sha256(original_path.read_bytes()).hexdigest() == raw_checksum
        finally:
            engine.dispose()

        failed_create = post(
            client,
            f"/api/v1/datasets/{dataset_id}/cleaning/plans",
            {
                "dataset_version_id": version_id,
                "operations": [{"op": "trim_whitespace", "column": "column_003"}],
            },
        )
        assert failed_create.status_code == 200, failed_create.text
        failed_plan_id = failed_create.json()["data"]["id"]
        assert (
            post(client, f"/api/v1/cleaning/plans/{failed_plan_id}/preview", {}).status_code == 200
        )
        failure_engine = create_db_engine(settings)
        try:
            with Session(failure_engine) as db, db.begin():
                raw_version_row = db.get(DatasetVersion, version_id)
                original_artifact = db.get(StoredArtifact, raw_version_row.artifact_id)
                original_checksum = original_artifact.sha256
                original_artifact.sha256 = "0" * 64
        finally:
            failure_engine.dispose()
        try:
            failed_approval = post(
                client,
                f"/api/v1/cleaning/plans/{failed_plan_id}/approve",
                {"confirm_apply": True},
            )
            assert failed_approval.status_code == 200, failed_approval.text
            failed_plan = wait_plan(client, failed_plan_id)
            assert failed_plan["state"] == "failed"
            assert "Cleaning failed safely" in failed_plan["error_message"]
            assert len(client.get(f"/api/v1/datasets/{dataset_id}/versions").json()["data"]) == 2
        finally:
            failure_engine = create_db_engine(settings)
            try:
                with Session(failure_engine) as db, db.begin():
                    raw_version_row = db.get(DatasetVersion, version_id)
                    original_artifact = db.get(StoredArtifact, raw_version_row.artifact_id)
                    original_artifact.sha256 = original_checksum
            finally:
                failure_engine.dispose()
        retry = post(client, f"/api/v1/cleaning/plans/{failed_plan_id}/retry", {})
        assert retry.status_code == 200, retry.text
        retried_plan = wait_plan(client, failed_plan_id)
        assert retried_plan["state"] == "completed"
        final_versions = client.get(f"/api/v1/datasets/{dataset_id}/versions").json()["data"]
        assert len(final_versions) == 3
        assert final_versions[2]["kind"] == "cleaned"
        assert final_versions[2]["id"] not in {version["id"] for version in final_versions[:2]}
        # This second operation is a no-op on the fixture, so identical content has the same hash.
        assert final_versions[2]["checksum"] == raw_checksum

        summary = client.get(
            f"/api/v1/datasets/{dataset_id}/analytics/summary?version_id={cleaned_version_id}"
        )
        assert summary.status_code == 200, summary.text
        assert summary.json()["data"]["rows_analyzed"] == 5
        assert summary.json()["data"]["exact"] is True
        total_sales = post(
            client,
            f"/api/v1/datasets/{dataset_id}/analytics/grouped",
            {
                "version_id": cleaned_version_id,
                "group_by": ["column_002"],
                "operation": "sum",
                "column": "column_004",
            },
        )
        assert total_sales.status_code == 200, total_sales.text
        assert {row["column_002"]: row["value"] for row in total_sales.json()["data"]["rows"]} == {
            "East": 450,
            "West": 160,
        }
        average_profit = post(
            client,
            f"/api/v1/datasets/{dataset_id}/analytics/grouped",
            {
                "version_id": cleaned_version_id,
                "group_by": ["column_002"],
                "operation": "mean",
                "column": "column_005",
            },
        )
        assert {
            row["column_002"]: row["value"] for row in average_profit.json()["data"]["rows"]
        } == pytest.approx({"East": 27.333333333333332, "West": 20})
        corr = post(
            client,
            f"/api/v1/datasets/{dataset_id}/analytics/correlation",
            {"version_id": cleaned_version_id, "columns": ["column_004", "column_005"]},
        )
        assert corr.status_code == 200 and corr.json()["data"]["rows_analyzed"] == 5
        distribution = post(
            client,
            f"/api/v1/datasets/{dataset_id}/analytics/chart",
            {"version_id": cleaned_version_id, "chart_type": "category", "x": "column_003"},
        )
        assert distribution.status_code == 200
        assert sum(row["value"] for row in distribution.json()["data"]["rows"]) == 5

        assert post(client, f"/api/v1/cleaning/plans/{plan_id}/retry", {}).status_code == 409
        assert len(client.get(f"/api/v1/datasets/{dataset_id}/versions").json()["data"]) == 3

    outsider_settings = settings.model_copy(
        update={"auth_rate_namespace": f"autoinsight:test:phase5:outsider:{uuid4().hex}"}
    )
    with TestClient(create_app(outsider_settings)) as outsider:
        register(outsider, "outsider")
        for path in (
            f"/api/v1/cleaning/plans/{plan_id}",
            f"/api/v1/datasets/{dataset_id}/versions/{version_id}/cleaning/suggestions",
            f"/api/v1/datasets/{dataset_id}/analytics/summary?version_id={version_id}",
        ):
            assert outsider.get(path).status_code == 404
        denied = post(
            outsider,
            f"/api/v1/datasets/{dataset_id}/analytics/grouped",
            {"version_id": version_id, "group_by": ["column_002"], "operation": "count"},
        )
        assert denied.status_code == 404
