import time
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.research import ProposedPlan

pytestmark = pytest.mark.integration
ORIGIN = "http://127.0.0.1:5173"
PASSWORD = "Phase 7 integration passphrase!"


def post(client, path, body):
    token = client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
    return client.post(
        path,
        json=body,
        headers={"Origin": ORIGIN, "X-CSRF-Token": token},
    )


def register(client, name):
    response = post(
        client,
        "/api/v1/auth/register",
        {
            "display_name": name,
            "email": f"research-{uuid4()}@example.com",
            "password": PASSWORD,
        },
    )
    assert response.status_code == 201, response.text


def ready_dataset(client):
    fixture = Path(__file__).parent / "fixtures" / "phase7_sales.csv"
    uploaded = client.post(
        "/api/v1/datasets",
        files={"file": (fixture.name, fixture.read_bytes(), "text/csv")},
        headers={
            "Origin": ORIGIN,
            "X-CSRF-Token": client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"],
        },
    )
    assert uploaded.status_code == 201, uploaded.text
    dataset_id = uploaded.json()["data"]["id"]
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        status = client.get(f"/api/v1/datasets/{dataset_id}/status").json()["data"]["status"]
        if status in {"ready", "failed"}:
            break
        time.sleep(0.2)
    assert status == "ready"
    version = client.get(f"/api/v1/datasets/{dataset_id}/versions").json()["data"][0]
    return dataset_id, version["id"]


def fixed_plan(*args):
    return ProposedPlan.model_validate(
        {
            "rationale": "Compute exact profit means by region.",
            "limitations": [],
            "steps": [
                {
                    "agent_role": "analysis",
                    "objective": "Calculate mean profit by region.",
                    "tool_name": "run_grouped_aggregate",
                    "arguments": {
                        "group_by": ["column_001"],
                        "operation": "mean",
                        "metric": "column_002",
                        "direction": "highest",
                    },
                    "expected_evidence": "Exact averages by region",
                }
            ],
        }
    )


def test_research_approval_rejection_and_owner_scope(monkeypatch):
    from app.api import research as research_api

    monkeypatch.setattr(
        research_api,
        "_propose_plan",
        lambda *args, **kwargs: fixed_plan().model_dump(mode="json"),
    )
    settings = Settings(auth_rate_namespace=f"autoinsight:test:research:{uuid4().hex}")
    with TestClient(create_app(settings)) as owner:
        register(owner, "Research owner")
        dataset_id, version_id = ready_dataset(owner)
        create = post(
            owner,
            "/api/v1/research",
            {
                "dataset_id": dataset_id,
                "dataset_version_id": version_id,
                "question": "Which region has the highest average profit?",
            },
        )
        assert create.status_code == 201, create.text
        run = create.json()["data"]
        run_id = run["id"]
        assert run["status"] == "awaiting_approval"
        assert run["steps"] == []
        assert run["dataset_version_id"] == version_id

        assert post(owner, f"/api/v1/research/{run_id}/start", {}).status_code == 409

        with TestClient(create_app(settings)) as other:
            register(other, "Different user")
            assert other.get(f"/api/v1/research/{run_id}").status_code == 404
            for action, body in (
                ("approve", {"confirm": True}),
                ("reject", {"confirm": True}),
                ("revise", {"feedback": "Change this plan."}),
                ("start", {}),
                ("cancel", {}),
            ):
                assert (
                    post(other, f"/api/v1/research/{run_id}/{action}", body).status_code == 404
                )

        rejected = post(owner, f"/api/v1/research/{run_id}/reject", {"confirm": True})
        assert rejected.status_code == 200
        assert rejected.json()["data"]["status"] == "rejected"
        assert rejected.json()["data"]["steps"] == []
        assert post(owner, f"/api/v1/research/{run_id}/start", {}).status_code == 409

        second_plan = post(
            owner,
            "/api/v1/research",
            {
                "dataset_id": dataset_id,
                "dataset_version_id": version_id,
                "question": "Which region has the highest average profit?",
            },
        )
        second_id = second_plan.json()["data"]["id"]
        revised = post(
            owner,
            f"/api/v1/research/{second_id}/revise",
            {"feedback": "Show the group values in the plan."},
        )
        assert revised.status_code == 200, revised.text
        assert revised.json()["data"]["status"] == "awaiting_approval"
        assert revised.json()["data"]["revision_count"] == 1
        assert revised.json()["data"]["approval"]["status"] == "pending"
        assert (
            post(
                owner,
                f"/api/v1/research/{second_id}/revise",
                {"feedback": "Change the comparison again."},
            ).status_code
            == 409
        )

        history = owner.get("/api/v1/research")
        assert history.status_code == 200
        assert {item["id"] for item in history.json()["data"]} >= {run_id, second_id}


def test_plan_approval_is_bound_to_unchanged_hash(monkeypatch):
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.api import research as research_api
    from app.db.models import ResearchRun
    from app.db.session import create_db_engine

    monkeypatch.setattr(
        research_api,
        "_propose_plan",
        lambda *args, **kwargs: fixed_plan().model_dump(mode="json"),
    )
    settings = Settings(auth_rate_namespace=f"autoinsight:test:research-hash:{uuid4().hex}")
    with TestClient(create_app(settings)) as client:
        register(client, "Plan reviewer")
        dataset_id, version_id = ready_dataset(client)
        response = post(
            client,
            "/api/v1/research",
            {
                "dataset_id": dataset_id,
                "dataset_version_id": version_id,
                "question": "Which region has the highest average profit?",
            },
        )
        run_id = response.json()["data"]["id"]
        approved = post(client, f"/api/v1/research/{run_id}/approve", {"confirm": True})
        assert approved.status_code == 200
        assert approved.json()["data"]["approval"]["status"] == "approved"

        engine = create_db_engine(settings)
        try:
            with Session(engine) as db, db.begin():
                run = db.scalar(select(ResearchRun).where(ResearchRun.id == run_id))
                plan = dict(run.plan_json["plan"])
                plan["rationale"] = "silently changed after approval"
                run.plan_json = {**run.plan_json, "plan": plan}
        finally:
            engine.dispose()
        started = post(client, f"/api/v1/research/{run_id}/start", {})
        assert started.status_code == 409
        assert started.json()["error"]["code"] == "PLAN_APPROVAL_REQUIRED"


def test_ollama_outage_is_saved_as_an_honest_planning_failure(monkeypatch):
    from app.api import research as research_api
    from app.core.errors import AppError

    def unavailable(*args, **kwargs):
        raise AppError(
            503, "OLLAMA_UNAVAILABLE", "The configured local Ollama model is unavailable."
        )

    monkeypatch.setattr(research_api, "_propose_plan", unavailable)
    settings = Settings(auth_rate_namespace=f"autoinsight:test:research-outage:{uuid4().hex}")
    with TestClient(create_app(settings)) as client:
        register(client, "Research offline test")
        dataset_id, version_id = ready_dataset(client)
        response = post(
            client,
            "/api/v1/research",
            {
                "dataset_id": dataset_id,
                "dataset_version_id": version_id,
                "question": "Which region has the highest average profit?",
            },
        )
        assert response.status_code == 201
        run = response.json()["data"]
        assert run["status"] == "failed"
        assert "unavailable" in run["failure"].lower()
        assert run["steps"] == []


def test_running_cancellation_is_only_requested_until_worker_boundary(monkeypatch):
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.api import research as research_api
    from app.db.models import ResearchRun
    from app.db.session import create_db_engine

    monkeypatch.setattr(
        research_api,
        "_propose_plan",
        lambda *args, **kwargs: fixed_plan().model_dump(mode="json"),
    )
    settings = Settings(auth_rate_namespace=f"autoinsight:test:research-cancel:{uuid4().hex}")
    with TestClient(create_app(settings)) as client:
        register(client, "Research cancel test")
        dataset_id, version_id = ready_dataset(client)
        created = post(
            client,
            "/api/v1/research",
            {
                "dataset_id": dataset_id,
                "dataset_version_id": version_id,
                "question": "Which region has the highest average profit?",
            },
        )
        run_id = created.json()["data"]["id"]
        engine = create_db_engine(settings)
        try:
            with Session(engine) as db, db.begin():
                run = db.scalar(select(ResearchRun).where(ResearchRun.id == run_id))
                run.status = "running"
        finally:
            engine.dispose()

        cancelled = post(client, f"/api/v1/research/{run_id}/cancel", {})
        assert cancelled.status_code == 200
        state = cancelled.json()["data"]
        assert state["status"] == "running"
        assert state["cancellation_requested"] is True
        assert state["evidence"] == []
        engine = create_db_engine(settings)
        try:
            with Session(engine) as db, db.begin():
                run = db.scalar(select(ResearchRun).where(ResearchRun.id == run_id))
                run.status = "cancelled"
        finally:
            engine.dispose()


def test_saved_steps_and_evidence_survive_api_restart(monkeypatch):
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.api import research as research_api
    from app.db.models import AgentStep, EvidenceItem, ResearchRun
    from app.db.session import create_db_engine

    monkeypatch.setattr(
        research_api,
        "_propose_plan",
        lambda *args, **kwargs: fixed_plan().model_dump(mode="json"),
    )
    settings = Settings(auth_rate_namespace=f"autoinsight:test:research-restart:{uuid4().hex}")
    email = f"research-restart-{uuid4()}@example.com"
    run_id = None
    user_id = None
    with TestClient(create_app(settings)) as first_app:
        assert post(
            first_app,
            "/api/v1/auth/register",
            {"display_name": "Research persistence test", "email": email, "password": PASSWORD},
        ).status_code == 201
        user_id = first_app.get("/api/v1/auth/me").json()["data"]["id"]
        dataset_id, version_id = ready_dataset(first_app)
        created = post(
            first_app,
            "/api/v1/research",
            {
                "dataset_id": dataset_id,
                "dataset_version_id": version_id,
                "question": "Which region has the highest average profit?",
            },
        )
        run_id = created.json()["data"]["id"]
        engine = create_db_engine(settings)
        try:
            with Session(engine) as db, db.begin():
                run = db.scalar(select(ResearchRun).where(ResearchRun.id == run_id))
                run.status = "completed"
                run.plan_json = {
                    **run.plan_json,
                    "approval": {"status": "approved"},
                }
                step = AgentStep(
                    owner_id=user_id,
                    research_run_id=run.id,
                    step_index=0,
                    agent_role="analysis",
                    tool_name="run_grouped_aggregate",
                    status="completed",
                    input_summary={"objective": "Calculate grouped mean."},
                    output_summary={"rows": 1},
                )
                db.add(step)
                db.flush()
                db.add(
                    EvidenceItem(
                        owner_id=user_id,
                        run_id=run.id,
                        step_id=step.id,
                        evidence_type="aggregate",
                        payload_json={
                            "tool_name": "run_grouped_aggregate",
                            "verified": True,
                            "result": {"findings": [{"claim": "Persisted finding"}]},
                        },
                    )
                )
        finally:
            engine.dispose()

    with TestClient(create_app(settings)) as restarted_app:
        logged_in = post(
            restarted_app,
            "/api/v1/auth/login",
            {"email": email, "password": PASSWORD},
        )
        assert logged_in.status_code == 200, logged_in.text
        restored = restarted_app.get(f"/api/v1/research/{run_id}")
        assert restored.status_code == 200
        state = restored.json()["data"]
        assert state["status"] == "completed"
        assert len(state["steps"]) == 1
        assert state["evidence"][0]["payload"]["verified"] is True
        finding = state["evidence"][0]["payload"]["result"]["findings"][0]["claim"]
        assert finding == "Persisted finding"


def test_stale_running_record_without_an_rq_job_is_reconciled(monkeypatch):
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from app.api import research as research_api
    from app.db.models import ResearchRun
    from app.db.session import create_db_engine
    from worker.connection import redis_connection

    monkeypatch.setattr(
        research_api,
        "_propose_plan",
        lambda *args, **kwargs: fixed_plan().model_dump(mode="json"),
    )
    settings = Settings(auth_rate_namespace=f"autoinsight:test:research-recovery:{uuid4().hex}")
    with TestClient(create_app(settings)) as client:
        register(client, "Research recovery test")
        dataset_id, version_id = ready_dataset(client)
        created = post(
            client,
            "/api/v1/research",
            {
                "dataset_id": dataset_id,
                "dataset_version_id": version_id,
                "question": "Which region has the highest average profit?",
            },
        )
        run_id = created.json()["data"]["id"]
        engine = create_db_engine(settings)
        redis = redis_connection(settings)
        try:
            with Session(engine) as db, db.begin():
                run = db.scalar(select(ResearchRun).where(ResearchRun.id == run_id))
                run.status = "running"
                run.created_at = datetime.now(UTC) - timedelta(
                    seconds=settings.max_job_seconds + 120
                )
                run.plan_json = {**run.plan_json, "cancellation_requested": True}
                assert research_api.reconcile_stale_research_runs(db, settings, redis) == 1
            with Session(engine) as db:
                recovered = db.scalar(select(ResearchRun).where(ResearchRun.id == run_id))
                assert recovered.status == "failed"
                assert recovered.plan_json["stale_rq_state"] == "missing"
                assert recovered.plan_json["failure_code"] == "RESEARCH_JOB_ABANDONED"
        finally:
            redis.close()
            engine.dispose()
