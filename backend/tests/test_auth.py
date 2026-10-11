from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.api.auth import database
from app.core.config import Settings
from app.core.security import digest, verify_password
from app.db.base import Base
from app.db.models import (
    AuditEvent,
    AuthSession,
    Dataset,
    DatasetVersion,
    MLRun,
    Report,
    ResearchRun,
    StoredArtifact,
    User,
)
from app.db.session import create_db_engine
from app.main import create_app

pytestmark = pytest.mark.integration
ORIGIN = "http://127.0.0.1:5173"
PASSWORD = "Test-only long passphrase!"


@pytest.fixture
def account_api():
    settings = Settings(auth_rate_namespace=f"autoinsight:test:auth:{uuid4().hex}")
    engine = create_db_engine(settings)
    with engine.connect() as connection:
        transaction = connection.begin()
        db = Session(bind=connection, join_transaction_mode="create_savepoint")
        app = create_app(settings)
        app.dependency_overrides[database] = lambda: db
        with TestClient(app) as client:
            yield client, db, settings
        db.close()
        transaction.rollback()
    engine.dispose()


def post(client, path, data=None, **headers):
    token = client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
    return client.post(
        f"/api/v1/auth/{path}",
        json=data or {},
        headers={"Origin": ORIGIN, "X-CSRF-Token": token, **headers},
    )


def register(client, email="test@example.com"):
    return post(
        client, "register", {"display_name": "Test Analyst", "email": email, "password": PASSWORD}
    )


def test_registration_storage_cookie_duplicates_and_validation(account_api):
    client, db, settings = account_api
    response = register(client)
    assert response.status_code == 201, response.text
    user = db.scalar(select(User).where(User.email == "test@example.com"))
    assert verify_password(user.password_hash, PASSWORD)
    assert "password" not in response.text and "token" not in response.text
    session = db.scalar(select(AuthSession).where(AuthSession.user_id == user.id))
    raw = client.cookies[settings.session_cookie]
    assert session.token_hash == digest(raw) and session.token_hash != raw
    assert (
        "HttpOnly" in response.headers["set-cookie"]
        and "SameSite=lax" in response.headers["set-cookie"]
    )
    assert (
        "Path=/api/v1" in response.headers["set-cookie"]
        and "Max-Age=86400" in response.headers["set-cookie"]
    )
    assert register(client, "TEST@example.com").status_code == 409
    assert (
        post(
            client, "register", {"email": "bad", "password": PASSWORD, "display_name": "Test"}
        ).status_code
        == 422
    )
    assert client.get("/api/v1/auth/me").json()["data"]["id"] == str(user.id)


def test_login_logout_revocation_and_generic_errors(account_api):
    client, db, settings = account_api
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/dashboard/overview").status_code == 401
    register(client)
    old = client.cookies[settings.session_cookie]
    assert post(client, "logout").status_code == 200
    assert settings.session_cookie not in client.cookies
    assert client.get("/api/v1/auth/me").status_code == 401
    client.cookies.set(settings.session_cookie, old, path="/api/v1")
    assert client.get("/api/v1/auth/me").status_code == 401
    client.cookies.clear()
    messages = []
    for email in ["test@example.com", "missing@example.com"]:
        result = post(client, "login", {"email": email, "password": "Wrong password"})
        assert result.status_code == 401
        messages.append(result.json()["error"])
    assert messages[0] == messages[1]
    assert (
        post(client, "login", {"email": "TEST@example.com", "password": PASSWORD}).status_code
        == 200
    )
    assert client.cookies[settings.session_cookie] != old
    assert client.get("/api/v1/auth/me").status_code == 200
    events = set(db.scalars(select(AuditEvent.event_type)))
    assert {
        "registration",
        "login_succeeded",
        "login_failed",
        "logout",
        "session_revoked",
    } <= events
    for event in db.scalars(select(AuditEvent)):
        assert event.meta_json == {}


@pytest.mark.parametrize("reason", ["expired", "revoked", "inactive"])
def test_invalid_sessions_are_rejected(account_api, reason):
    client, db, _ = account_api
    user_id = UUID(register(client).json()["data"]["id"])
    session = db.scalar(select(AuthSession).where(AuthSession.user_id == user_id))
    if reason == "expired":
        session.created_at = datetime.now(UTC) - timedelta(hours=2)
        session.expires_at = datetime.now(UTC) - timedelta(hours=1)
    elif reason == "revoked":
        session.revoked_at = datetime.now(UTC)
    else:
        db.get(User, user_id).is_active = False
    db.commit()
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/dashboard/overview").status_code == 401


def test_csrf_is_bound_to_the_session_and_logout_requires_it(account_api):
    client, _, _ = account_api
    before = client.get("/api/v1/auth/csrf").json()["data"]["csrf_token"]
    register(client)
    assert (
        client.post(
            "/api/v1/auth/logout", json={}, headers={"Origin": ORIGIN, "X-CSRF-Token": before}
        ).status_code
        == 403
    )
    assert post(client, "logout", Origin="https://evil.example").status_code == 403
    assert client.get("/api/v1/auth/me").status_code == 200
    assert post(client, "logout").status_code == 200


def test_rate_limit_is_bounded_and_namespaced(account_api):
    client, _, settings = account_api
    for _ in range(settings.auth_login_limit):
        assert (
            post(
                client, "login", {"email": "unknown@example.com", "password": PASSWORD}
            ).status_code
            == 401
        )
    response = post(client, "login", {"email": "unknown@example.com", "password": PASSWORD})
    assert response.status_code == 429 and response.headers["retry-after"] == "60"
    assert client.get("/api/v1/health/live").status_code == 200
    assert register(client).status_code == 201


def test_user_owned_overview_and_cross_user_metadata(account_api):
    client, db, _ = account_api
    a = UUID(register(client, "a@example.com").json()["data"]["id"])
    data = Dataset(owner_id=a, display_name="Private test dataset", source_format="csv")
    db.add(data)
    db.flush()
    artifact = StoredArtifact(
        owner_id=a,
        relative_path=f"tests/{uuid4()}.csv",
        mime_type="text/csv",
        size_bytes=0,
        sha256="a" * 64,
    )
    db.add(artifact)
    db.flush()
    version = DatasetVersion(
        owner_id=a, dataset_id=data.id, artifact_id=artifact.id, version_no=1, kind="raw"
    )
    db.add(version)
    db.flush()
    research = ResearchRun(
        owner_id=a,
        dataset_version_id=version.id,
        goal="Synthetic authorization fixture",
        status="draft",
    )
    db.add(research)
    db.flush()
    db.add_all(
        [
            MLRun(
                owner_id=a,
                dataset_version_id=version.id,
                task_type="regression",
                target_column="test",
                status="queued",
                config_json={},
            ),
            Report(owner_id=a, research_run_id=research.id, status="queued"),
        ]
    )
    db.commit()
    assert client.get("/api/v1/dashboard/overview").json()["data"] == {
        "datasets": 1,
        "research_runs": 1,
        "ml_experiments": 1,
        "reports": 1,
    }
    assert client.get(f"/api/v1/datasets/{data.id}").status_code == 200
    register(client, "b@example.com")
    assert set(client.get("/api/v1/dashboard/overview").json()["data"].values()) == {0}
    assert client.get(f"/api/v1/datasets/{data.id}").status_code == 404
    assert client.get(f"/api/v1/datasets/{uuid4()}").status_code == 404
    assert "Private" not in client.get(f"/api/v1/datasets/{data.id}").text


def test_https_session_cookie_rotation_and_replay_denial(account_api):
    _, db, settings = account_api
    app = create_app(
        settings.model_copy(update={"app_env": "production", "cors_origins": ["https://localhost"]})
    )
    app.dependency_overrides[database] = lambda: db
    with TestClient(app, base_url="https://localhost") as client:
        response = post(
            client,
            "register",
            {"email": "secure@example.com", "password": PASSWORD, "display_name": "Secure Test"},
            Origin="https://localhost",
        )
        assert response.status_code == 201
        header = response.headers["set-cookie"]
        assert (
            "__Secure-autoinsight_session=" in header
            and "Secure" in header
            and "HttpOnly" in header
        )
        raw = client.cookies["__Secure-autoinsight_session"]
        assert (
            post(
                client,
                "login",
                {"email": "secure@example.com", "password": PASSWORD},
                Origin="https://localhost",
            ).status_code
            == 200
        )
        assert client.cookies["__Secure-autoinsight_session"] != raw
        assert (
            client.get(
                "/api/v1/auth/me", headers={"Cookie": f"__Secure-autoinsight_session={raw}"}
            ).status_code
            == 401
        )


def test_database_ownership_lineage_paths_and_uniqueness(account_api):
    client, db, _ = account_api
    a = UUID(register(client, "a@example.com").json()["data"]["id"])
    b = UUID(register(client, "b@example.com").json()["data"]["id"])
    dataset = Dataset(owner_id=a, display_name="Schema test", source_format="csv")
    artifact = StoredArtifact(
        owner_id=a,
        relative_path=f"tests/{uuid4()}.csv",
        mime_type="text/csv",
        size_bytes=0,
        sha256="a" * 64,
    )
    db.add_all([dataset, artifact])
    db.flush()
    version = DatasetVersion(
        owner_id=a, dataset_id=dataset.id, artifact_id=artifact.id, kind="raw", version_no=1
    )
    db.add(version)
    db.commit()
    bad_rows = [
        DatasetVersion(
            owner_id=b, dataset_id=dataset.id, artifact_id=artifact.id, kind="raw", version_no=2
        ),
        DatasetVersion(
            owner_id=a, dataset_id=dataset.id, artifact_id=artifact.id, kind="raw", version_no=1
        ),
        DatasetVersion(
            owner_id=a, dataset_id=dataset.id, artifact_id=artifact.id, kind="cleaned", version_no=2
        ),
    ]
    bad_rows += [
        StoredArtifact(
            owner_id=a, relative_path=path, mime_type="text/csv", size_bytes=0, sha256="a" * 64
        )
        for path in ["../escape", "x/../../escape", "/absolute", "C:\\escape", "x//y"]
    ]
    for row in bad_rows:
        with pytest.raises(IntegrityError), db.begin_nested():
            db.add(row)
            db.flush()
    assert (
        db.scalar(
            select(func.count())
            .select_from(DatasetVersion)
            .where(DatasetVersion.dataset_id == dataset.id)
        )
        == 1
    )


def test_runtime_role_is_not_admin_and_cannot_mutate_future_domain():
    engine = create_db_engine(Settings(), runtime=True)
    try:
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT current_user")) == "autoinsight_app"
            assert not connection.scalar(
                text("SELECT rolsuper FROM pg_roles WHERE rolname = current_user")
            )
            for query in [
                "CREATE TABLE phase3_should_not_exist(id int)",
                "DELETE FROM datasets WHERE false",
                "UPDATE audit_events SET event_type='changed' WHERE false",
            ]:
                with pytest.raises(DBAPIError), connection.begin_nested():
                    connection.execute(text(query))
    finally:
        engine.dispose()


def test_migrations_reproduce_all_tables_in_an_empty_transactional_schema():
    engine = create_db_engine(Settings())
    schema = f"phase3_test_{uuid4().hex}"
    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            try:
                connection.execute(text(f'CREATE SCHEMA "{schema}"'))
                connection.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
                config = Config("alembic.ini")
                config.attributes.update(connection=connection, migration_schema=schema)
                command.upgrade(config, "head")
                assert set(inspect(connection).get_table_names(schema=schema)) == {
                    "alembic_version",
                    *Base.metadata.tables,
                }
                assert (
                    connection.scalar(text(f'SELECT version_num FROM "{schema}".alembic_version'))
                    == "0002_domain_auth"
                )
                command.upgrade(config, "head")
            finally:
                transaction.rollback()  # Only this test's uncommitted schema and rows.
    finally:
        engine.dispose()
