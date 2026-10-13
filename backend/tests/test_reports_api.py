import io
import time
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import DatasetVersion, EvidenceItem, ResearchRun
from app.main import create_app

pytestmark = pytest.mark.integration
ORIGIN = "http://127.0.0.1:5173"
PASSWORD = "Phase 8 report integration passphrase!"


def post(client, path, body):
    csrf = client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
    return client.post(path, json=body, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})


def register(client, suffix):
    response = post(
        client,
        "/api/v1/auth/register",
        {
            "display_name": "Report integration",
            "email": f"report-{suffix}-{uuid4()}@example.com",
            "password": PASSWORD,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]["id"]


def test_report_generation_download_and_owner_isolation():
    settings = Settings(auth_rate_namespace=f"autoinsight:test:reports:{uuid4().hex}")
    fixture = Path(__file__).parent / "fixtures" / "phase7_sales.csv"
    with TestClient(create_app(settings)) as owner, TestClient(create_app(settings)) as other:
        owner_id = register(owner, "owner")
        register(other, "other")
        uploaded = owner.post(
            "/api/v1/datasets",
            files={"file": (fixture.name, fixture.read_bytes(), "text/csv")},
            headers={
                "Origin": ORIGIN,
                "X-CSRF-Token": owner.get("/api/v1/auth/csrf").json()["data"]["csrf_token"],
            },
        )
        assert uploaded.status_code == 201, uploaded.text
        dataset_id = uploaded.json()["data"]["id"]
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            version_response = owner.get(f"/api/v1/datasets/{dataset_id}/versions")
            versions = version_response.json()["data"]
            if versions:
                break
            time.sleep(0.25)
        assert versions
        with Session(owner.app.state.engine) as db:
            version = db.scalar(
                select(DatasetVersion).where(DatasetVersion.id == versions[0]["id"])
            )
            run = ResearchRun(
                owner_id=owner_id,
                dataset_version_id=version.id,
                goal="Which region has the highest average profit?",
                plan_json={"steps": []},
                status="completed",
                max_steps=12,
            )
            db.add(run)
            db.flush()
            evidence = EvidenceItem(
                owner_id=owner_id,
                run_id=run.id,
                step_id=None,
                evidence_type="synthesize_evidence",
                payload_json={"verified": True, "result": {}},
                artifact_id=None,
            )
            db.add(evidence)
            db.flush()
            evidence.payload_json = {
                "verified": True,
                "result": {
                    "interpretation": "South leads the recorded average profit.",
                    "findings": [
                        {
                            "claim": "South has the highest average profit: 8,500.",
                            "evidence_id": str(evidence.id),
                            "exact": True,
                        }
                    ],
                    "document_findings": [],
                    "limitations": [],
                },
            }
            db.commit()
            run_id = str(run.id)

        queued = post(owner, "/api/v1/reports", {"research_run_id": run_id})
        assert queued.status_code == 202, queued.text
        report_id = queued.json()["data"]["id"]
        deadline = time.monotonic() + 45
        report = queued.json()["data"]
        while time.monotonic() < deadline and report["status"] in {"queued", "running"}:
            time.sleep(0.25)
            report = owner.get(f"/api/v1/reports/{report_id}").json()["data"]
        assert report["status"] == "completed", report.get("error_message")
        pdf = owner.get(f"/api/v1/reports/{report_id}/download")
        assert pdf.status_code == 200
        assert pdf.headers["content-type"] == "application/pdf"
        text = "\n".join(
            page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf.content)).pages
        )
        assert "South has the highest average profit: 8,500." in text
        assert other.get("/api/v1/reports").json()["data"] == []
        assert other.get(f"/api/v1/reports/{report_id}/download").status_code == 404
