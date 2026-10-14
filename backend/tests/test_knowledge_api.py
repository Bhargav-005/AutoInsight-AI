import time
from datetime import UTC, datetime, timedelta
from io import BytesIO
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import DatasetDocument
from app.main import create_app
from app.services.retrieval import search_documents

pytestmark = pytest.mark.integration
ORIGIN = "http://127.0.0.1:5173"
PASSWORD = "Phase 8 integration passphrase!"


def post(client, path, body):
    csrf = client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
    return client.post(path, json=body, headers={"Origin": ORIGIN, "X-CSRF-Token": csrf})


def register(client, name):
    response = post(
        client,
        "/api/v1/auth/register",
        {
            "display_name": name,
            "email": f"knowledge-{uuid4()}@example.com",
            "password": PASSWORD,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]["id"]


def test_document_indexing_retrieval_and_cross_owner_isolation():
    settings = Settings(auth_rate_namespace=f"autoinsight:test:knowledge:{uuid4().hex}")
    with TestClient(create_app(settings)) as owner, TestClient(create_app(settings)) as other:
        owner_id = register(owner, "Knowledge owner")
        other_id = register(other, "Other workspace")
        text = (
            "The southern region led annual profit growth because its customer retention "
            "and repeat purchase rate increased. This report recommends continued investment "
            "in the South region. "
        ) * 18
        csrf = owner.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
        uploaded = owner.post(
            "/api/v1/documents",
            files={"file": ("regional-report.txt", text.encode(), "text/plain")},
            headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
        )
        assert uploaded.status_code == 201, uploaded.text
        document_id = uploaded.json()["data"]["id"]

        csrf = owner.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
        corrupt = owner.post(
            "/api/v1/documents",
            files={"file": ("corrupt.pdf", b"not a PDF", "application/pdf")},
            headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
        )
        assert corrupt.status_code == 422

        pdf_buffer = BytesIO()
        pdf = canvas.Canvas(pdf_buffer)
        pdf.drawString(
            72, 720, "The regional target is recorded on the first page of this reference."
        )
        pdf.showPage()
        pdf.drawString(72, 720, "The second page provides additional business context for review.")
        pdf.save()
        uploaded_pdf = owner.post(
            "/api/v1/documents",
            files={"file": ("regional-report.pdf", pdf_buffer.getvalue(), "application/pdf")},
            headers={"Origin": ORIGIN, "X-CSRF-Token": csrf},
        )
        assert uploaded_pdf.status_code == 201, uploaded_pdf.text
        pdf_document_id = uploaded_pdf.json()["data"]["id"]

        deadline = time.monotonic() + 90
        document = uploaded.json()["data"]
        while time.monotonic() < deadline and document["status"] in {"queued", "processing"}:
            time.sleep(0.5)
            response = owner.get("/api/v1/documents")
            assert response.status_code == 200
            document = next(item for item in response.json()["data"] if item["id"] == document_id)
        assert document["status"] == "indexed", document.get("processing_error")
        assert document["chunk_count"] > 0
        deadline = time.monotonic() + 90
        pdf_document = uploaded_pdf.json()["data"]
        while time.monotonic() < deadline and pdf_document["status"] in {
            "queued",
            "processing",
        }:
            time.sleep(0.5)
            response = owner.get("/api/v1/documents")
            assert response.status_code == 200
            pdf_document = next(
                item for item in response.json()["data"] if item["id"] == pdf_document_id
            )
        assert pdf_document["status"] == "indexed", pdf_document.get("processing_error")
        assert pdf_document["page_count"] == 2
        assert pdf_document["chunk_count"] > 0
        assert len(other.get("/api/v1/documents").json()["data"]) == 0

        with Session(owner.app.state.engine) as db:
            results = search_documents(
                db,
                settings,
                UUID(owner_id),
                "What explains profit growth in the South region?",
                [UUID(document_id)],
            )
            hidden = search_documents(
                db,
                settings,
                UUID(other_id),
                "What explains profit growth in the South region?",
            )
        assert results
        assert results[0]["source_filename"] == "regional-report.txt"
        assert results[0]["document_id"] == document_id
        assert hidden == []
        assert post(other, f"/api/v1/documents/{document_id}/remove", {}).status_code == 404
        assert post(other, f"/api/v1/documents/{document_id}/reindex", {}).status_code == 404
        assert post(owner, f"/api/v1/documents/{document_id}/remove", {}).status_code == 200
        with Session(owner.app.state.engine) as db:
            assert (
                search_documents(db, settings, UUID(owner_id), "South profit", [UUID(document_id)])
                == []
            )
            # An interrupted test-owned job has no RQ mapping. Existing indexed chunks
            # of other documents and other owners remain intact.
            record = db.get(DatasetDocument, document_id)
            record.status = "processing"
            record.job_id = f"phase9-missing-{uuid4()}"
            record.processing_started_at = datetime.now(UTC) - timedelta(hours=1)
            db.commit()
        recovered = next(
            item
            for item in owner.get("/api/v1/documents").json()["data"]
            if item["id"] == document_id
        )
        assert recovered["status"] == "failed"
        assert "interrupted" in recovered["processing_error"]
