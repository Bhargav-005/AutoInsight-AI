"""Focused real PostgreSQL/RQ training, artifact security and restart verification."""

import hashlib
import subprocess
import time
from pathlib import Path
from unittest.mock import Mock, patch
from uuid import uuid4

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import DatasetVersion, MLRun, ModelMetric, Prediction, StoredArtifact
from app.db.session import create_db_engine
from app.main import create_app
from app.storage.paths import ArtifactStore
from worker.connection import queue, redis_connection

pytestmark = pytest.mark.integration
ORIGIN = "http://127.0.0.1:5173"


def post(client, path, payload):
    token = client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
    return client.post(path, json=payload, headers={"Origin": ORIGIN, "X-CSRF-Token": token})


def register(client):
    response = post(
        client,
        "/api/v1/auth/register",
        {
            "display_name": "ML test",
            "email": f"ml-{uuid4()}@example.com",
            "password": "ML acceptance test passphrase!",
        },
    )
    assert response.status_code == 201, response.text


def wait(client, path, key="status"):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        response = client.get(path)
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        if data[key] in {"ready", "failed", "completed"}:
            return data
        time.sleep(0.3)
    pytest.fail("Job did not finish within 60 seconds")


def test_ml_jobs_security_and_predictions_after_process_restart():
    settings = Settings(auth_rate_namespace=f"autoinsight:test:ml:{uuid4().hex}")
    engine = create_db_engine(settings)
    connection = redis_connection(settings)
    rng = np.random.default_rng(17)
    signal = rng.normal(size=240)
    raw = (
        "signal,category,label,outcome\n"
        + "\n".join(
            f"{x},{'warm' if x > 0 else 'cool'},"
            f"{'positive' if x > 0 else 'negative'},{3 * x + rng.normal(0, 0.1)}"
            for x in signal
        )
        + "\n"
    )
    with TestClient(create_app(settings)) as client:
        register(client)
        token = client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
        uploaded = client.post(
            "/api/v1/datasets",
            files={"file": ("ml-synthetic.csv", raw.encode(), "text/csv")},
            headers={"Origin": ORIGIN, "X-CSRF-Token": token},
        )
        assert uploaded.status_code == 201, uploaded.text
        dataset_id = uploaded.json()["data"]["id"]
        assert wait(client, f"/api/v1/datasets/{dataset_id}/status")["status"] == "ready"
        versions = client.get(f"/api/v1/datasets/{dataset_id}/versions").json()["data"]
        version_id = versions[0]["id"]
        assert (
            client.get(f"/api/v1/datasets/{dataset_id}/versions/{version_id}/ml").status_code == 200
        )
        config = dict(
            dataset_id=dataset_id,
            dataset_version_id=version_id,
            task_type="classification",
            target_column="column_003",
            feature_columns=["column_001", "column_002"],
            algorithm="logistic_regression",
            independent_rows=True,
        )
        assert client.post("/api/v1/ml-runs", json=config).status_code == 403
        invalid = post(client, "/api/v1/ml-runs", config | {"task_type": "regression"})
        assert invalid.status_code == 422
        runs = []
        for override in (
            {},
            {"algorithm": "random_forest_classifier"},
            {"task_type": "regression", "target_column": "column_004", "algorithm": "ridge"},
        ):
            created = post(client, "/api/v1/ml-runs", config | override)
            assert created.status_code == 202, created.text
            run = wait(client, f"/api/v1/ml-runs/{created.json()['data']['id']}")
            assert run["status"] == "completed", run
            assert run["evaluation"]["train_rows"] == 192
            assert run["evaluation"]["test_rows"] == 48
            assert run["model_available"] is True
            runs.append(run)
        print(
            "ACTUAL_ML_METRICS",
            [(r["config"]["algorithm"], r["evaluation"]["metrics"]) for r in runs],
        )
        comparison = post(
            client, "/api/v1/ml-runs/compare", {"run_ids": [r["id"] for r in runs[:2]]}
        )
        assert comparison.status_code == 200, comparison.text
        assert (
            post(
                client, "/api/v1/ml-runs/compare", {"run_ids": [runs[0]["id"], runs[2]["id"]]}
            ).status_code
            == 422
        )
        run_id = runs[0]["id"]
        values = {"column_001": 0.8, "column_002": "unseen"}
        prediction = post(client, f"/api/v1/ml-runs/{run_id}/predict", {"values": values})
        assert prediction.status_code == 200, prediction.text
        expected = prediction.json()["data"]["prediction"]
        assert (
            post(
                client,
                f"/api/v1/ml-runs/{run_id}/predict",
                {"values": {"column_001": "wrong", "column_002": "warm"}},
            ).status_code
            == 422
        )
        assert (
            post(
                client,
                f"/api/v1/ml-runs/{run_id}/predict",
                {"values": values, "path": "../model.joblib"},
            ).status_code
            == 422
        )
        with Session(engine) as db:
            row = db.get(MLRun, run_id)
            artifact = db.get(StoredArtifact, row.model_artifact_id)
            model_artifact_id = artifact.id
            saved_checksum = artifact.sha256
            model_path = ArtifactStore(settings.file_storage_root).resolve(artifact.relative_path)
            assert hashlib.sha256(model_path.read_bytes()).hexdigest() == saved_checksum
            assert artifact.owner_id == row.owner_id
            assert all(
                p.input_json is None
                for p in db.scalars(select(Prediction).where(Prediction.ml_run_id == row.id))
            )
            artifact.sha256 = "0" * 64
            db.commit()
        try:
            assert (
                post(client, f"/api/v1/ml-runs/{run_id}/predict", {"values": values}).status_code
                == 409
            )
        finally:
            with Session(engine) as db, db.begin():
                db.get(StoredArtifact, model_artifact_id).sha256 = saved_checksum
        with pytest.raises(ValueError):
            ArtifactStore(settings.file_storage_root).resolve("../forged.joblib")
        # Delay dispatch solely for this test-owned source to force a real worker integrity failure.
        captured = Mock()
        with patch("app.api.ml.queue", return_value=captured):
            created = post(client, "/api/v1/ml-runs", config)
        assert created.status_code == 202, created.text
        failed_id = created.json()["data"]["id"]
        with Session(engine) as db, db.begin():
            source = db.get(StoredArtifact, db.get(DatasetVersion, version_id).artifact_id)
            source_id, source_checksum = source.id, source.sha256
            source.sha256 = "0" * 64
        try:
            args, kwargs = captured.enqueue.call_args
            queue(settings, connection).enqueue(*args, **kwargs)
            failed = wait(client, f"/api/v1/ml-runs/{failed_id}")
            assert failed["status"] == "failed"
            assert failed["evaluation"] is None and not failed["model_available"]
        finally:
            with Session(engine) as db, db.begin():
                db.get(StoredArtifact, source_id).sha256 = source_checksum
        assert post(client, f"/api/v1/ml-runs/{failed_id}/retry", {}).status_code == 202
        assert wait(client, f"/api/v1/ml-runs/{failed_id}")["status"] == "completed"
        assert post(client, f"/api/v1/ml-runs/{failed_id}/retry", {}).status_code == 409
        with Session(engine) as db:
            row = db.get(MLRun, failed_id)
            metrics = db.scalars(select(ModelMetric).where(ModelMetric.ml_run_id == row.id)).all()
            assert len({(m.dataset_split, m.metric_name) for m in metrics}) == len(metrics)
        assert client.get(f"/api/v1/datasets/{dataset_id}/versions").json()["data"] == versions
        cookies = dict(client.cookies)
    # A fresh OS process proves predictions survive the original API lifetime.
    python = str(Path(__file__).parents[1] / ".venv" / "Scripts" / "python.exe")
    child = subprocess.Popen(
        [
            python,
            "-m",
            "uvicorn",
            "app.main:create_app",
            "--factory",
            "--host",
            "127.0.0.1",
            "--port",
            "8013",
        ],
        cwd=Path(__file__).parents[1],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    try:
        with httpx.Client(base_url="http://127.0.0.1:8013", cookies=cookies) as restarted:
            deadline = time.monotonic() + 20
            while True:
                try:
                    if restarted.get("/api/v1/health/live").status_code == 200:
                        break
                except httpx.ConnectError:
                    pass
                if time.monotonic() > deadline:
                    pytest.fail("Restarted backend did not become live")
                time.sleep(0.2)
            response = post(restarted, f"/api/v1/ml-runs/{run_id}/predict", {"values": values})
            assert response.status_code == 200, response.text
            assert response.json()["data"]["prediction"] == expected
            assert len(restarted.get(f"/api/v1/ml-runs/{run_id}/predictions").json()["data"]) == 2
    finally:
        child.terminate()
        child.wait(timeout=10)
    with TestClient(create_app(settings)) as outsider:
        register(outsider)
        for path in (
            f"/api/v1/ml-runs/{run_id}",
            f"/api/v1/ml-runs/{run_id}/predictions",
            f"/api/v1/datasets/{dataset_id}/versions/{version_id}/ml",
        ):
            assert outsider.get(path).status_code == 404
        assert outsider.get(f"/api/v1/ml-runs?dataset_id={dataset_id}").json()["data"] == []
        assert (
            post(outsider, f"/api/v1/ml-runs/{run_id}/predict", {"values": values}).status_code
            == 404
        )
        assert post(outsider, "/api/v1/ml-runs", config).status_code == 404
        assert (
            post(
                outsider, "/api/v1/ml-runs/compare", {"run_ids": [runs[0]["id"], runs[1]["id"]]}
            ).status_code
            == 404
        )
    runtime = create_db_engine(settings, runtime=True)
    with runtime.connect() as db:
        assert (
            db.scalar(text("SELECT has_schema_privilege(current_user, 'public', 'CREATE')"))
            is False
        )
    runtime.dispose()
    engine.dispose()
    connection.close()
