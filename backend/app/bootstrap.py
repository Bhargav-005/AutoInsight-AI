"""Idempotent local environment setup; never print or overwrite existing secrets."""

import secrets
import sys

from psycopg import sql

from app.core.config import PROJECT_ROOT, Settings
from app.db.session import create_db_engine


def provision_role(settings):
    """Grant only the current API's runtime privileges in this project's database."""
    engine = create_db_engine(settings)
    try:
        with engine.begin() as connection:
            cursor = connection.connection.cursor()
            cursor.execute(
                "SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE "
                "rolname = 'autoinsight_app'"
            )
            role = cursor.fetchone()
            if role and any(role):
                raise RuntimeError(
                    "Existing runtime role has unexpected privileges; review required"
                )
            if role is None:
                cursor.execute(
                    "CREATE ROLE autoinsight_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE "
                    "NOINHERIT"
                )
            cursor.execute(
                sql.SQL("ALTER ROLE autoinsight_app PASSWORD {}").format(
                    sql.Literal(settings.app_db_password.get_secret_value())
                )
            )
            cursor.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
            cursor.execute("GRANT CONNECT ON DATABASE autoinsight TO autoinsight_app")
            cursor.execute("GRANT USAGE ON SCHEMA public TO autoinsight_app")
            cursor.execute("GRANT SELECT ON ALL TABLES IN SCHEMA public TO autoinsight_app")
            cursor.execute(
                "GRANT INSERT, UPDATE ON users, sessions, datasets, stored_artifacts, "
                "dataset_versions, dataset_profiles, cleaning_plans, ml_runs TO autoinsight_app"
            )
            cursor.execute("GRANT INSERT ON model_metrics, predictions TO autoinsight_app")
            cursor.execute("GRANT INSERT ON audit_events TO autoinsight_app")
    finally:
        engine.dispose()
    print(
        "Dedicated application role provisioned; no DDL or unrelated domain write "
        "privileges granted."
    )


def main():
    destination = PROJECT_ROOT / ".env"
    if not destination.exists():
        template = (PROJECT_ROOT / ".env.example").read_text(encoding="utf-8")
        template = template.replace("INFRASTRUCTURE_ENABLED=false", "INFRASTRUCTURE_ENABLED=true")
        for key in ("POSTGRES_PASSWORD", "REDIS_PASSWORD"):
            template = template.replace(f"{key}=\n", f"{key}={secrets.token_hex(32)}\n")
        with destination.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(template)
        print("Created ignored local environment with independent secrets.")
    else:
        print("Preserving existing .env.")
    # Upgrade only missing project-local security settings, never rotate existing secrets.
    contents = destination.read_text(encoding="utf-8")
    additions = []
    for key in ("APP_DB_PASSWORD", "AUTH_CSRF_SECRET"):
        existing = next(
            (
                line.partition("=")[2].strip()
                for line in contents.splitlines()
                if line.startswith(f"{key}=")
            ),
            None,
        )
        if existing is None:
            additions.append(f"{key}={secrets.token_hex(32)}")
        elif not existing:
            contents = contents.replace(f"{key}=\n", f"{key}={secrets.token_hex(32)}\n")
    if additions or contents != destination.read_text(encoding="utf-8"):
        destination.write_text(
            contents.rstrip() + "\n" + "\n".join(additions) + "\n", encoding="utf-8"
        )
    settings = Settings()
    settings.file_storage_root.mkdir(parents=True, exist_ok=True)
    print("Configuration validated; artifact directory available.")
    if "--database-role" in sys.argv:
        try:
            provision_role(settings)
        except Exception:
            raise SystemExit(
                "Application role provisioning failed; check the dedicated database and migrations."
            ) from None


if __name__ == "__main__":
    main()
