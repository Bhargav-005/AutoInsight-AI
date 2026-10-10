"""Idempotent local environment setup; never print or overwrite existing secrets."""

import secrets

from app.core.config import PROJECT_ROOT, Settings


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
    settings = Settings()
    settings.file_storage_root.mkdir(parents=True, exist_ok=True)
    print("Configuration validated; artifact directory available.")


if __name__ == "__main__":
    main()
